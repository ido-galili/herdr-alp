<p align="center"><img src="icon.png" width="160" alt="Alp: a llama in circuit goggles"></p>

# herdr-alp

A layout for the [Herdr](https://herdr.dev) desktop app, plus the Claude Code plugin that feeds it.

An *Alp* is the high summer pasture of the Swiss Alps: the herd roams the open slopes, unfenced, and the herdsman is up there with it, in charge. This layout is that for coding agents: a sidebar with your account's usage limits, spaces and agents, and a header on every pane with the agent's model, effort, context fill, worktree, branch and status. It comes in [Dracula](https://draculatheme.com) colors.

> [!NOTE]
> **Claude Code only, for now.** The usage limits and the model, effort and context chips come from the `alp` Claude Code plugin. Other agents and shells still get the pane header (name, folder, worktree, status) but no chips. The status files are agent-neutral, so other agents can be added later (see [Status files](#status-files)).

![Alp](preview.png)

What's inside:

| Path | What it is |
|---|---|
| `layouts/alp.json` | the Herdr layout |
| `themes/alp.json` | its built-in theme: Dracula |
| `mods/usage-limits/` | sidebar block: session (5h) and weekly (7d) usage, with time to reset |
| `mods/pane-agent/` | pane header: icon, name, folder, model/effort/context chips, worktree, branch, status, split/zoom/close |
| `mods/alp-files/` | Files: Basecamp's file tree, and the editor a file opens in, as a pane beside the terminals: `ctrl-s` saves, edits survive switching files, and a file another program changed asks before it's overwritten (Herdr's `files`, cloned) |
| `mods/alp-chrome/` | sidebar brand row and footer: Herdr's `workspace-chrome`, with a 60px rail whose unfold button sits at the top |
| `mods/alp-spaces/` | sidebar spaces list: Herdr's `spaces`, with each space's avatar on the folded rail |
| `mods/alp-agents/` | sidebar agents list: grouped or priority views, sub-agents under their parent, each Space shown by its avatar |
| `mods/alpmeister/` | Alp, a team lead's start-of-day tab: an Overview of all your repos or one workspace (bugs by priority, triage, customer issues, nightly, Waiting for your review, Your open PRs, Your issues, milestone, team in flight), a Board, Herds (sessions and their agents) and Settings |
| `mods/basecamp/` | Basecamp (Files, Changes, Today and Run): the one dock on the right, beside the terminals; its tab strip. Shown or hidden from its button at the end of the tab bar, and remembered per space |
| `mods/daypack/` | Today: Basecamp's tab with the Today list (the issues and PRs you Pin to Today in Alp, and the todos you type there), grouped or filtered by repo |
| `mods/alp-runs/` | Runs: Basecamp's Run tab (the runs in Alp's config, `.herdr/alp.json` and your own, each with a play button, and an import from VS Code) and the bottom panel with each run's output and the Runs list |
| `mods/alp-status/` | the status bar: Herdr's, with a Runs button that shows or hides the bottom panel |
| `mods/alp-tabs/` | the tab bar: an Alp tab pinned before the space's tabs, then the tabs, +, and the Basecamp button |
| `plugins/alp/` | Claude Code plugin that writes the status files the mods read |
| `schema/alp.schema.json` | the JSON schema for Alp's config files |
| `RECIPE.md` | the brief to rebuild it from scratch (herdr.dev format) |
| `icon.png` | Alp's logo |
| `sync.sh` | copy the layout and mods into Herdr's home (and record what it installed, for Updates), or pull live edits back |
| `CHANGELOG.md`, `cliff.toml` | every release's notes, made by git-cliff from merged PR titles |
| `.github/workflows/` | checks on each PR; Prepare release (the release PR), and its GitHub Release on merge |
| `package.json` | dev tools only (oxlint, oxfmt, git-cliff); nothing in it ships to Herdr |
| `setup.sh` | one-step install: checks `gh`, syncs, installs the plugin and switches to the alp layout |

## Install

### Quick setup

```sh
git clone https://github.com/ido-galili/herdr-alp && cd herdr-alp
./setup.sh
```

It walks through the steps below, then switches Herdr to the alp layout. Alp opens on the
Overview of all your repositories, with a card that offers to add a workspace in its
[Settings](#settings). To do it by hand instead:

### 1. Herdr layout and mods

```sh
git clone https://github.com/ido-galili/herdr-alp && cd herdr-alp
./sync.sh install                                   # copies layout, theme and mods into ~/.config/herdr-app
herdr-app do layout.switch '{"name":"alp"}'
```

`ctrl-shift-l` switches back to your previous layout. Alp opens in its own Dracula theme (`alp` in the theme picker, offered only on this layout); picking another theme there overrides it.

Or ask your agent to add `herdr.dev/layouts/ido-galili/herdr-alp`: Herdr's `AGENTS.md` tells it how.

### 2. Claude Code plugin

Without it the layout works, but the usage limits show `–` and the pane headers show no chips. This repository is also a Claude Code plugin marketplace, so in a Claude Code session:

```
/plugin marketplace add ido-galili/herdr-alp
/plugin install alp@herdr-alp
```

Pick a scope when asked (user scope loads it in every session). Or from a shell:

```sh
claude plugin marketplace add ido-galili/herdr-alp
claude plugin install alp@herdr-alp
```

Update it later from Alp's [Settings › Updates](#updates), or with `/plugin marketplace update herdr-alp`.

**While developing**, load it straight from this folder instead, in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/projects/herdr-alp/plugins/alp" } }
```

Restart running Claude sessions after installing or changing the plugin.

## Alp

In an alp cooperative, the Alpmeister plans the season and oversees the alp, while the senn
works the herd. The `alpmeister` mod is that view for a team lead; it shows as **Alp**. Its tab is
pinned first in the tab bar, before the space's tabs, and belongs to no space. Click it and Alp
takes the whole work area in place of the terminals. Click it again, pick a tab, open one or
switch spaces to get the terminals back. It can also open as a tab of its own in a space:

```sh
herdr-app do tab.new '{"mod":"alpmeister","name":"Alp"}'
```

It has three views: Overview, Board and Herds, as tabs after its name (each with its icon: a
grid, columns, three linked dots), and a Settings button that shows its settings in place of
the view. It works before you set anything:
the Overview starts on all your repositories, with a card that offers to add a workspace
("Not now" hides it for good).

- **Overview:** your GitHub as a whole, or one workspace, picked from the Workspace dropdown on
  top (each row in its list says what that workspace covers). A tile or card that opens GitHub has the GitHub
  mark at the right end of its top-right icons (its tooltip says where: "See all 7 on GitHub",
  "Open the run on GitHub"); the tile itself takes no click. The Customer issues and Nightly
  tiles also have a gear that opens Settings on that section (also the way in when no
  customer label or nightly is set). Every tile and card that lists a
  GitHub search (open bugs, triage bugs, customer issues, Waiting for your review, Your open PRs
  and Your issues) has a small filter icon in its top-right corner, with a dot when its
  saved filter isn't the default; hovering says the filter in words. The
  icon opens the filter dialog: chips, the GitHub search, a live "Shows 3 issues · now 0" count,
  and Reset to default, Cancel and "Save for this card", which writes the setting Settings › Card
  filters edits. Cancel, Esc or a click outside drops the edit; the card only ever shows the
  saved filter.
  - **Your lists:** Waiting for your review (with a Review button), Your open PRs, and Your
    issues (with a Start button), each row with its pin ("Pin to Today", which adds it to
    Basecamp's Today tab). Both buttons open a Claude Code tab running the prompt set in
    Settings, in that repository's local clone; a dashed mark means the prompt isn't set yet and
    opens Settings. The icons say what they do in their tooltips.
  - **All repos:** the Red checks tile (default branches and your PRs whose checks fail), then
    your lists from every repository in scope: Waiting for your review, then Your open PRs beside
    Your issues, then every repository in scope
    with its open issues and PRs, the default branch's checks, and when it was last pushed. With
    open work hides the rest, and stays as you left it.
  - **A workspace** is a repository, a project board, or both. Top to bottom: four tiles (open
    bugs by priority, triage bugs, open customer issues, the last nightly run), the Milestone
    card beside Waiting for your review, the issues in flight, then Your open PRs beside Your
    issues (your lists narrowed to the workspace: its repository; for a workspace with only a
    board, the repositories its board's items are in, and your issues on its board). A card the
    workspace has no part for is left out: without a board no issues in flight; with only a
    board no tiles and no Milestone card. On a narrow tab every card stacks, in the same order.
    The Milestone card shows one milestone, picked in its header ("v2.4 · next ▾": Next, which moves on
    by itself, any open milestone by due date with overdue ones in red, or No milestone). It
    shows two bars: Progress (the share closed, orange at none closed blending to green at
    all, with today's tick on the time from the start to the due date, and the due date and
    days left over its right
    end) and By status (the board statuses, a chip each). Under them, Issues (the open issues
    with a priority, a prioritizing label or a feature type) and those on hold. A milestone
    picked by hand outlines the card and offers "Back to next"; each workspace keeps its pick,
    and one that closes goes back to Next. The GitHub mark opens the milestone (or the open
    issues without one) on GitHub. With a board: the issues in flight, by status, the
    longest in their status first, narrowed by the card's filter (its filter icon opens the
    same dialog as the other cards): the next milestone by default, which moves on by itself
    when that milestone closes, or one milestone, no milestone or any, and who they're assigned
    to. The header says it in words ("next milestone · v2.4"); each workspace keeps its own.
- **Board:** a workspace's board items, a column per status, with each card's assignee avatars.
  The filter in words on the header ("Filter: current iteration · 5 columns") opens the same
  filter dialog: chips for Type, Columns and People, and the board filter in the board's own
  syntax, such as `type:Bug iteration:@current`, with a count of the cards it shows. The board
  keeps the saved filter until "Save for this board", which writes the filter and the columns
  (the Show on board ticks in Settings); a filter GitHub refuses shows its error in the dialog and
  isn't saved. People are remembered on this computer only; an avatar row above the board picks them in one click too. A card names its iteration, unless the filter already asks for that one. Drag a card to
  another column to move it to that status; its ⋯ (always shown; or a right click) opens a menu
  where you pressed that moves it or changes its iteration or milestone. Board cards have no
  Claude button. These write to GitHub at once, so `gh` needs the `project` scope; after
  a move, a toast at the board's bottom left offers Undo.
- **Herds:** your Claude Code sessions and their agents, and how they are linked. A session that messaged others
  (`SendMessage`) or made their worktrees is a herdsman, marked with a crook: drawn on top, with a line down to each
  of its herd, labelled `msg 12:36` for its latest message or dotted `worktree`. Who and when
  only: no message text is shown. Sessions with no link are grazing (sessions on their own): a card each, in space order, with a
  stripe in the space's color and its avatar in the corner. Every box and card ends with
  the session's git branch. A session that started agents (the Agent tool, forks included) leads
  them too: a smaller box per agent, a lamb for a fork and a herding dog for any other agent, with what it is for and how long it has run (or when it
  finished), on a solid line labelled with its type; a background agent is tagged "bg". An agent started
  by an agent sits under it. Agents that finished over 30 minutes ago fold into "+ N finished
  earlier". A click opens
  a session's tab. A background session is shown in the tab titled with its name, or in the
  tab picked with Link a tab. It reads Claude Code's files (`~/.claude/sessions`, the
  sessions' transcripts and agent files) and redraws when a session starts, ends or changes
  status, and every few seconds while its agents work. Open it
  directly with `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"herds"}}'`.
- **Settings:** everything below, as a form (see [Settings](#settings)), shown in place of the
  view, with "Back to Overview" (or the view you came from). A side list picks the page, and the
  save bar stays at the bottom: "2 unsaved changes · Revert · Save". Edits you haven't saved stay
  while Alp is open, and the button says so: "Settings · 2 unsaved". After a save, Back fetches
  again, and every other Alp tab fetches too.
- **Refresh:** Alp fetches when the tab opens, when it shows data over 2 hours
  old, and from "Updated 3h ago · Refresh", which turns orange after 2 hours.
- **Pinned:** shown in place of the terminals (the Alp layout's pinned tab), the header ends in
  "Back to terminals".
- **Today** lives in Basecamp's Today tab (the `daypack` mod), its open count on the tab: the
  rows you Pin to Today here and the todos you type there ("Add a todo and press Enter"),
  carried over the next day. A key says what the Claude mark and the pin do ("set it in
  Settings" opens Alp's Settings while a prompt is missing; "Hide key" is remembered). Each row
  has its checkbox; a pin unpins, a todo has Edit (or a double-click) and Remove. "All repos ▾"
  narrows the list to one repository (or the todos without one), and "Group by repo" gives each
  repository its own heading, the todos without one under "Todos"; both are remembered. A todo
  typed while the list shows one repository belongs to it. A refresh here keeps each pin's
  board status and PR review decision up to date there.
- **Open on a tab or workspace:** `props.tab` (`dashboard` or `overview` for the Overview,
  `board`, `herds`, `settings`; the old `today` opens the Overview) and
  `props.workspace` (a workspace's name, `""` for All repos):
  `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","workspace":"Team"}}'`.
- **Demo:** `props.demo` fills every tab with made-up data, for demos and screenshots: an
  org with three workspaces (a repository and a board, a repository only, a board only), every
  bug priority, a failing nightly, cards in every status, PRs in every review state, pins
  and a herd on Herds. It calls no GitHub and writes nothing: not the settings, the cache or the
  Today list, and Board moves only change what it shows. Its Settings button shows demo settings whose Save
  writes nothing:
  `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","workspace":"Website","demo":true}}'`.
- **State:** `~/.local/state/alp/focus.json` holds the Today list and
  `~/.local/state/alp/alpmeister-cache.json` the last result.

### Settings

The settings tab edits `~/.config/alp/alpmeister.json`. Its choices come from GitHub through
the `gh` CLI (your repositories, your account's and organizations' project boards, a board's
statuses and fields, a repository's workflows) and from your disk (local clones). Only the Board
writes to GitHub: a card's status, its place in the column, its iteration and its milestone; the
rest of Alp only reads. Nothing is saved until Save, in the bar at the bottom, which keeps the
previous file as `alpmeister.json.bak`; Revert drops the unsaved changes.

A side list picks the page: **You** (GitHub, Local folders, Claude buttons, Card filters, Files),
then a page per workspace and "+ Add workspace", then **Alp** › [Updates](#updates).

| Page | What you set |
|---|---|
| GitHub | the repos in scope: all your repositories (new ones join on their own; archived ones optional), or only the ones you pick |
| Local folders | each repository's clone, where its Claude buttons open; clones found under `~/projects`, `~/code` and the like are offered |
| Claude buttons | what they type into the new Claude tab. `{repo}` and `{number}` are filled in; a `/command` works too |
| Card filters | every card's filter in one list, each with an Edit button that opens the same filter dialog the Overview's cards open (its Save writes that one filter at once, not through the Save bar): Waiting for your review, Your open PRs and Your issues, then each workspace's Open bugs, Triage bugs and Open PRs (`queries.prs`, `is:pr is:open` by default; the repository and a sort are added). "Save for this card" on an Overview card writes the same setting |
| Workspace: *name* | its name, repository and project board, then sections that fold, each with a line saying what it is set to: Board columns (per status: what it means and whether the Board shows it; "More per-status options" adds hidden from Your issues and on hold; the status and iteration fields), Nightly (the workflow, its branch and the runs that count), Bugs and triage, Milestone issues (what the Milestone card lists under Issues) and Customer issues |

Nightly checks (one row per job or step) are edited in the file: see
`mods/alpmeister/alpmeister.example.json` for every key. A file in the earlier one-repo shape
(top-level `repo` and `project`) still works: it reads as one workspace, and Save writes it in
the new shape.

## Runs

Basecamp's **Run** tab lists what the focused workspace can run: the runs in Alp's config. The
workspace is the focused terminal's git checkout, or the repo the space's terminals are in.

- **Run:** the play button starts the run. What it `dependsOn` starts first, and a group starts
  each of its runs. A `${input:...}` asks first, with the last answer filled in.
- **Watch:** the bottom panel opens with the run's live output. Its bar shows the run's state,
  stop (Ctrl-C, then terminate on a second press) and restart. The Runs list beside it holds
  every run: running, exited 0 or failed. The output stays after the command ends.
- **Show or hide:** Output in the Run tab, beside the workspace's name, or the terminal button at
  the right end of the status bar, after the commands hint.
- **Add, edit, delete:** **+** adds a run; right-click a run to edit it, delete it from the file
  it's in, or hide it for yourself.
- **Not runnable here:** runs that use `${file}` and other editor-only variables fold away under
  "can't run here", with the reason on each.

### Where runs live

Three files, deep-merged. Later ones win:

| File | Whose | |
|---|---|---|
| `~/.config/alp/alp.json` | yours, in every repo | |
| `.herdr/alp.json` | the repo's | commit it to share the runs with everyone who clones the repo |
| `.herdr/alp.local.json` | yours, in this repo only | Git ignores it (Alp adds it to `.git/info/exclude`); every worktree of the repo shares the main checkout's |

Objects merge key by key, anything else is replaced, and `null` removes a key. Runs are keyed by
name, so your local file can change one field of the team's run, or hide it with `null`. A run from
`.herdr/alp.local.json` is marked *just me* in the list, and one from your own Alp config
(`~/.config/alp/alp.json`) *me everywhere*.

```jsonc
// .herdr/alp.json
{
  "$schema": "https://raw.githubusercontent.com/ido-galili/herdr-alp/main/schema/alp.schema.json",
  "runs": {
    "Dev server": { "section": "Launch", "command": "npm run dev", "cwd": "web", "background": true },
    "API": { "section": "Launch", "command": ["node", "server/index.js"], "envFile": "server/.env", "dependsOn": ["Build"] },
    "Build": { "section": "Tasks", "command": "npm run build", "macos": { "command": "npm run build:mac" } },
    "Migrate": { "section": "Tasks", "command": "npm run migrate -- ${input:target}" },
    "Full stack": { "section": "Launch", "runs": ["API", "Dev server"] }
  },
  "inputs": {
    "target": { "type": "pickString", "options": ["latest", "previous"], "default": "latest" }
  }
}
```

```jsonc
// .herdr/alp.local.json: my own port, and no Migrate for me
{ "runs": { "Dev server": { "env": { "PORT": "5180" } }, "Migrate": null } }
```

- `command`: a string runs in the shell, a list runs the program directly.
- `cwd` and `envFile` are relative to the repo root. `env` adds variables.
- `dependsOn` (with `order`: `parallel` by default, or `sequence`) starts first. One that isn't
  `background` must exit 0 before the run starts.
- `runs` makes a group. `section` is the heading it's listed under (`Runs` by default).
- `macos`, `linux` and `windows` hold fields used on that platform instead.
- Variables are VS Code's: `${workspaceFolder}`, `${env:NAME}`, `${userHome}`, `${input:id}`.
  `inputs` are `promptString` or `pickString`.

The schema in `schema/alp.schema.json` gives completion in VS Code. Import and Save edit only the
keys they change, so comments and formatting stay.

### Import from VS Code

When the repo has `.vscode/launch.json` or `tasks.json`, the Run tab offers **Import from VS
Code…**. It lists every launch config, compound and task with a checkbox. Ticking one ticks what
it depends on. Ones that can't run outside VS Code (debugger attach, browser launches, extension
tasks, `${file}`) are greyed with the reason, and names already in the config stay unticked unless
you tick them to replace. The picked runs go into This repo (`.herdr/alp.json`) or Just me here
(`.herdr/alp.local.json`), with the inputs they use. After that the Run tab reads only Alp's
files.

Saved commands from the earlier `~/.config/alp/commands.json` move into Alp's config the first
time the Run tab loads (ones kept for one workspace go to that repo's local file), and the old
file is kept as `commands.json.bak`.

### For agents

Each run is a herdr-core terminal with a name and labels, so an agent can read a running server
instead of starting another:

```sh
hc ls --label alp.workspace="$(git rev-parse --show-toplevel)" --json
hc read <name> --lines 200
```

The labels are `alp.run` (the entry's name), `alp.run.kind` (launch, task or saved),
`alp.workspace` (the repo root) and, once the command ends, `alp.run.exit`. The `alp` plugin's
`alp-runs` skill tells Claude this.

## Status files

The plugin and the mods talk through files in `~/.local/state/herdr-agents/`. They are written per agent, so other agents can report later without changing the mods:

- `<herdr terminal>.json`: `{ "agent": "claude", "model", "effort", "context_pct", "ts" }`. Empty when the agent has exited. The pane header shows the chips only when `agent` matches the program running in the pane.
- `limits.json`: `{ "<agent>": { "five_hour": { "used_percentage", "resets_at" }, "seven_day": {…}, "ts" } }`. Each agent replaces only its own key. `usage-limits` takes `props: { "agent": "…" }` (default `claude`).

To add another agent: make it write these files, then add its program key to `REPORTING` in `mods/pane-agent/main.js`.

## Updates

Alp's Settings › Updates shows the installed version of herdr-alp and of the alp plugin.
**Check for updates** reads the [releases](https://github.com/ido-galili/herdr-alp/releases) on
GitHub; nothing checks on its own. When one is newer, **Notes** shows what changed and
**Update** installs it:

- **herdr-alp:** downloads that release's source, runs its `sync.sh install` into Herdr's home and
  reloads Alp. Your clone is never touched. Files you edited in Herdr's home are listed before
  they're overwritten: run `./sync.sh pull` first to keep them. An install from a clone with
  `./sync.sh install` shows as a dev build, and Update replaces it with the release.
- **Plugin:** `claude plugin marketplace update herdr-alp`, then `claude plugin update
  alp@herdr-alp`. Restart running Claude sessions to load it. A plugin loaded from a folder
  (`CLAUDE_CODE_PLUGIN_DIRS`) runs that folder, so it has nothing to update.

herdr-alp and the plugin share one version.

## Working on it

Herdr hot-reloads its home, so the quickest loop is to edit there and pull back:

```sh
./sync.sh pull      # ~/.config/herdr-app -> repo
./sync.sh install   # repo -> ~/.config/herdr-app
herdr-app check ~/.config/herdr-app/mods/pane-agent
```

`npm install` sets up the dev tools and a pre-commit hook that runs oxlint and oxfmt on the
files you commit (`npm run lint`, `npm run format` for the whole repo).

### Pull requests and releases

PRs are squash-merged, and the title becomes the commit, so it follows
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and is written for the
person using Alp: it becomes a line in the changelog word for word.

```
type(scope): what changed, for the person using Alp
type(scope)!: a breaking change
```

- **Types:** a change to shipped code (`mods/`, `layouts/`, `themes/`, `plugins/`, `sync.sh`,
  `setup.sh`) is `feat` (Added), `fix` (Fixed), `perf` (Faster) or `refactor` (Changed). `docs`,
  `test`, `ci` and `chore` stay out of the changelog. `release` is the release PR's own.
- **Scopes:** a mod folder (`alpmeister`, `alp-runs`, …), a part people know by name (`overview`,
  `board`, `herds`, `today`, `settings`, `updates`, `files`, `runs`, `tabs`, `sidebar`,
  `filters`, `pane-header`, `demo`, `alp`), or `plugin`, `layout`, `theme`, `setup`, `deps`.
  Several are comma-separated; none is fine too.
- **The text after the colon starts with a lowercase letter**, even before a name: "pin Alp
  before the tabs", not "Alp pinned before the tabs".

A PR check ([action-semantic-pull-request](https://github.com/amannn/action-semantic-pull-request),
as Vite uses) checks the title, and again when you edit it.

The PR checks (title, lint and format) must pass before a PR can merge.

**Releases**, the way Vite does them: when you want one, open **Actions › Prepare release › Run
workflow** (or `gh workflow run prepare-release.yml -f release=auto`). It opens a
`release: vX.Y.Z` PR that writes `CHANGELOG.md` and the plugin's version with git-cliff, from the
titles merged since the last release. `auto` picks the version (below 1.0, a feat or breaking
change bumps the minor, anything else the patch); `patch`, `minor` or `major` set it. Running it
again while that PR is open updates it. Merging it tags the merge and creates the GitHub Release
from its `CHANGELOG.md` section, which is what Settings › Updates offers.

## Planned

- A browser tab.
- **senn**, the Alp's herdsman: a mod that steers the agents.

## License

[MIT](LICENSE)
