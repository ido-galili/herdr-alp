"""Builds your Alpmeister settings by asking, with defaults read from GitHub through gh.

    python3 -I setup/settings.py SETTINGS_PATH [START_FOLDER]

Each question shows a default in brackets: Enter keeps it. The defaults come from the settings
already at SETTINGS_PATH, else from what gh finds: the repository of your local clone, its
project boards, the board's status names and iteration field, a nightly workflow. Keys it does
not ask about (queries, bugs, spotlight, customer, nightly checks) are kept as they are, or left
to Alpmeister's own defaults. The previous file is kept as SETTINGS_PATH.bak.
"""

import json
import os
import re
import subprocess
import sys

DEFAULT_ISSUE = "Work on GitHub issue #{number}: read it, plan, then implement."
DEFAULT_PR = "Review GitHub PR #{number} and summarize what needs attention."

REPO_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef { name }
    projectsV2(first: 20) {
      nodes { number title closed items { totalCount } owner { ... on Organization { login } ... on User { login } } }
    }
  }
}"""

FIELDS_QUERY = """
query($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField { name options { name } }
            ... on ProjectV2IterationField { name }
          }
        }
      }
    }
  }
}"""


# --- asking -----------------------------------------------------------------------------------


def read_line(prompt):
    """One answer, stripped. End of input counts as Enter."""
    try:
        return input(prompt).strip()
    except EOFError:
        print()
        return ""


def ask(label, default=""):
    """A free-text answer; Enter keeps the default."""
    shown = " [%s]" % default if default else ""
    return read_line("%s%s: " % (label, shown)) or default


def ask_list(label, default):
    """A comma-separated list; Enter keeps the default."""
    answer = read_line("%s [%s]: " % (label, ", ".join(default)))
    return [part.strip() for part in answer.split(",") if part.strip()] if answer else list(default)


def yes(label, default=True):
    answer = read_line("%s [%s]: " % (label, "Y/n" if default else "y/N")).lower()
    return default if not answer else answer.startswith("y")


def choose(label, options, default_index, none_label=None):
    """Picks one of `options` by number; Enter keeps the default. With `none_label`, 0 picks none."""
    print(label)
    if none_label:
        print("   0) %s" % none_label)
    for index, option in enumerate(options, 1):
        print("  %2d) %s" % (index, option))
    default = default_index + 1 if default_index is not None else 0
    while True:
        answer = read_line("Choice [%d]: " % default)
        if not answer:
            return default_index
        if answer.isdigit():
            number = int(answer)
            if number == 0 and none_label:
                return None
            if 1 <= number <= len(options):
                return number - 1
        print("  Type a number from the list.")


# --- GitHub -----------------------------------------------------------------------------------


def gh(args, cwd=None):
    """Runs gh; its stdout, or None when it fails."""
    try:
        result = subprocess.run(["gh"] + args, cwd=cwd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


def graphql(query, **variables):
    args = ["api", "graphql", "-f", "query=" + query]
    for key, value in variables.items():
        args += ["-F" if isinstance(value, int) else "-f", "%s=%s" % (key, value)]
    out = gh(args)
    if out is None:
        return None
    body = json.loads(out)
    return None if body.get("errors") else body.get("data")


def repo_of_folder(folder):
    """The owner/name of the GitHub repository a local clone belongs to, or ""."""
    if not folder or not os.path.isdir(folder):
        return ""
    out = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd=folder)
    return out.strip() if out else ""


# --- helpers ----------------------------------------------------------------------------------

HOME = os.path.expanduser("~")


def expand(path):
    return os.path.expanduser(path) if path else path


def tilde(path):
    """A path under the home folder written with ~, as the example settings do."""
    path = os.path.abspath(expand(path)).rstrip("/")
    return "~" + path[len(HOME):] if path == HOME or path.startswith(HOME + "/") else path


def matching(statuses, pattern):
    return [status for status in statuses if re.search(pattern, status, re.I)]


def load(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}
    except ValueError as error:
        print("Your settings at %s are not valid JSON (%s); starting fresh." % (path, error))
        return {}


# --- the questions ----------------------------------------------------------------------------


def ask_folder(old, start, herdr_alp):
    """The local clone the Claude buttons open in."""
    default = (old.get("launch") or {}).get("folder") or ""
    if not default and start and os.path.isdir(os.path.join(start, ".git")) and os.path.abspath(start) != herdr_alp:
        default = tilde(start)
    print("\nYour project's local clone: the Claude buttons open their tab there (or in a worktree")
    print("of it). Leave empty to open in the current space's folder.")
    while True:
        folder = ask("Folder", default)
        if not folder or os.path.isdir(expand(folder)):
            return tilde(folder) if folder else ""
        print("  No such folder: %s" % folder)


def ask_repo(old, folder):
    """The repository, checked through gh; returns (owner/name, repository data)."""
    default = old.get("repo") or repo_of_folder(expand(folder))
    print("\nThe GitHub repository Alpmeister reads.")
    while True:
        repo = ask("Repository (owner/name)", default)
        if "/" in repo:
            owner, name = repo.split("/", 1)
            data = graphql(REPO_QUERY, owner=owner, name=name)
            if data and data.get("repository"):
                return data["repository"]["nameWithOwner"], data["repository"]
        print("  gh cannot read %r. Check the name, or your access to it (gh auth status)." % repo)


def ask_project(old, repository):
    """The project board: (owner, number)."""
    boards = [board for board in repository["projectsV2"]["nodes"] if board and not board.get("closed")]
    old_project = old.get("project") or {}
    print("\nThe project board with the issues' Status and Iteration.")
    if boards:
        labels = [
            "#%d %s (%s, %d items)" % (b["number"], b["title"], b["owner"]["login"], b["items"]["totalCount"])
            for b in boards
        ]
        labels.append("Another board, by owner and number")
        # Your current board, else the busiest one: usually the team's main board.
        busiest = max(range(len(boards)), key=lambda i: boards[i]["items"]["totalCount"])
        default = next(
            (i for i, b in enumerate(boards) if b["number"] == old_project.get("number")
             and b["owner"]["login"] == old_project.get("owner")),
            busiest,
        )
        picked = choose("Boards linked to %s:" % repository["nameWithOwner"], labels, default)
        if picked < len(boards):
            return boards[picked]["owner"]["login"], boards[picked]["number"]
    else:
        print("No board is linked to %s." % repository["nameWithOwner"])
    owner = ask("Board owner (organization)", old_project.get("owner") or repository["nameWithOwner"].split("/")[0])
    while True:
        number = ask("Board number (from its URL: .../projects/N)", str(old_project.get("number") or ""))
        if number.isdigit():
            return owner, int(number)
        print("  A number, please.")


def ask_board_fields(old, owner, number):
    """Status field, its statuses in board order, and the iteration field."""
    data = graphql(FIELDS_QUERY, login=owner, number=number)
    board = ((data or {}).get("repositoryOwner") or {}).get("projectV2")
    old_project = old.get("project") or {}
    same_board = old_project.get("owner") == owner and old_project.get("number") == number
    if not board:
        print("  gh cannot read board %s #%d: keeping the field names as they are." % (owner, number))
        print("  The board needs the read:project scope: gh auth refresh -s read:project")
        return (
            old_project.get("statusField", "Status"),
            old.get("statuses") or ["New", "Todo", "In Progress", "In Review", "Done"],
            old_project.get("iterationField", "Iteration"),
        )
    fields = board["fields"]["nodes"]
    selects = [f for f in fields if f.get("__typename") == "ProjectV2SingleSelectField"]
    iterations = [f["name"] for f in fields if f.get("__typename") == "ProjectV2IterationField"]

    status_names = [f["name"] for f in selects]
    wanted = old_project.get("statusField") or "Status"
    status_index = status_names.index(wanted) if wanted in status_names else 0
    if len(selects) > 1 and wanted not in status_names:
        status_index = choose("\nWhich field holds the issue status?", status_names, 0)
    status_field = selects[status_index]["name"] if selects else "Status"
    board_statuses = [option["name"] for option in selects[status_index]["options"]] if selects else []

    print("\nStatuses on %s, in the order Alpmeister groups by." % board["title"])
    default = old.get("statuses") if same_board and old.get("statuses") else board_statuses
    statuses = ask_list("Statuses", default)

    iteration_field = old_project.get("iterationField") or "Iteration"
    if iterations and iteration_field not in iterations:
        iteration_field = iterations[0] if len(iterations) == 1 else iterations[
            choose("\nWhich field holds the iteration?", iterations, 0)]
    elif not iterations:
        print("  The board has no iteration field: the current-iteration filters show every issue.")
    return status_field, statuses, iteration_field


def ask_status_groups(old, statuses, same_board):
    """Which statuses count as not started, in flight, and hidden from your issues."""
    keep = lambda key, default: old_value(old, key) if same_board and old_value(old, key) else default
    not_started = keep("notStarted", matching(statuses, r"new|todo|to do|backlog|triage|ready") or statuses[:1])
    late = r"done|closed|hold|block|invalid|tested|cancel|won.?t"
    in_flight = keep("inFlight.statuses", [s for s in statuses if s not in not_started and not re.search(late, s, re.I)])
    hidden = keep("mineHidden", not_started[:1] + matching(statuses, r"done|hold|invalid"))
    print("\nHow Alpmeister reads the statuses (comma-separated):")
    return (
        ask_list("Not started", not_started),
        ask_list("In flight (the team's work in progress)", in_flight),
        ask_list("Hidden from Your issues", hidden),
    )


def old_value(old, dotted):
    value = old
    for key in dotted.split("."):
        value = (value or {}).get(key) if isinstance(value, dict) else None
    return value


def ask_nightly(old, repo, default_branch):
    """The nightly workflow, or None."""
    out = gh(["workflow", "list", "-R", repo, "--json", "name,path", "--limit", "100"])
    workflows = [w for w in json.loads(out) if w["path"].startswith(".github/")] if out else []
    old_nightly = old.get("nightly") or {}
    files = [os.path.basename(w["path"]) for w in workflows]
    if not workflows:
        return old_nightly or None
    if old_nightly.get("workflow") in files:
        default = files.index(old_nightly["workflow"])
    elif "nightly" in old and old["nightly"] is None:
        default = None
    else:
        default = next((i for i, w in enumerate(workflows) if re.search(r"nightly", w["name"] + w["path"], re.I)), None)
    picked = choose(
        "\nThe nightly workflow, for the Dashboard's nightly tile:",
        ["%s (%s)" % (w["name"], f) for w, f in zip(workflows, files)],
        default,
        none_label="No nightly tile",
    )
    if picked is None:
        return None
    workflow = files[picked]
    same = old_nightly.get("workflow") == workflow
    branch = ask("Branch it runs on", (same and old_nightly.get("branch")) or default_branch or "main")
    nightly = {
        "workflow": workflow,
        "branch": branch,
        "events": (same and old_nightly.get("events")) or ["schedule", "workflow_dispatch"],
        "checks": (same and old_nightly.get("checks")) or [],
    }
    if not nightly["checks"]:
        print("  Its checks (one row per job or step) can be added later: see alpmeister.example.json.")
    return nightly


def ask_launch(old):
    """What the Claude buttons type into the new Claude tab."""
    launch = old.get("launch") or {}
    print("\nThe Claude buttons open a Claude tab and type this into it. Enter keeps it; type your")
    print("own prompt or a /command instead. {number} is the issue or PR number.")
    return ask("Issue button", launch.get("issue") or DEFAULT_ISSUE), ask("PR button", launch.get("pr") or DEFAULT_PR)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    start = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    herdr_alp = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    old = load(path)
    if old:
        print("Your current settings (%s) are the defaults: Enter keeps each one." % tilde(path))

    folder = ask_folder(old, start, herdr_alp)
    repo, repository = ask_repo(old, folder)
    owner, number = ask_project(old, repository)
    same_board = (old.get("project") or {}).get("owner") == owner and (old.get("project") or {}).get("number") == number
    status_field, statuses, iteration_field = ask_board_fields(old, owner, number)
    not_started, in_flight, hidden = ask_status_groups(old, statuses, same_board)
    nightly = ask_nightly(old, repo, (repository.get("defaultBranchRef") or {}).get("name"))
    issue_command, pr_command = ask_launch(old)

    settings = {
        "repo": repo,
        "project": {
            **(old.get("project") or {}),
            "owner": owner,
            "number": number,
            "statusField": status_field,
            "iterationField": iteration_field,
        },
        "statuses": statuses,
        "notStarted": not_started,
        "inFlight": {**(old.get("inFlight") or {}), "statuses": in_flight},
        "mineHidden": hidden,
        "nightly": nightly,
        "launch": {**(old.get("launch") or {}), "folder": folder, "issue": issue_command, "pr": pr_command},
    }
    for key, value in old.items():
        settings.setdefault(key, value)
    text = json.dumps(settings, indent=2) + "\n"

    if old == settings:
        print("\nNo changes: %s stays as it is." % tilde(path))
        return
    print("\n" + text)
    if not yes("Write these settings to %s?" % tilde(path)):
        sys.exit("Nothing written.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.replace(path, path + ".bak")
        print("Kept the previous settings as %s.bak" % tilde(path))
    with open(path, "w") as handle:
        handle.write(text)
    print("Wrote %s" % tilde(path))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nCancelled: nothing written.")
