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
| `mods/alp-files/` | the Files panel with a minimal editor: click a file to edit it, `ctrl-s` saves, edits survive switching files, and a file another program changed asks before it's overwritten (Herdr's `files`, cloned) |
| `mods/alp-chrome/` | sidebar brand row and footer: Herdr's `workspace-chrome`, with a 60px rail whose unfold button sits at the top |
| `mods/alp-spaces/` | sidebar spaces list: Herdr's `spaces`, with each space's avatar on the folded rail |
| `mods/alp-agents/` | sidebar agents list: grouped or priority views, sub-agents under their parent, each Space shown by its avatar |
| `mods/alpmeister/` | Alp, a team lead's start-of-day tab: an Overview of all your repos or one workspace (bugs by priority, triage, customer issues, nightly, priorities, milestone, team in flight), a Board, Herds (sessions and their agents), Daypack (Today, Waiting for your review, Your open PRs, Your issues) and Settings |
| `mods/basecamp/` | Basecamp (Today and Run): the right column beside the terminals, shown or hidden from its button at the end of the tab bar |
| `mods/daypack/` | Today: Basecamp's tab with the Today list, the same one as on Alp's Daypack |
| `mods/alp-runs/` | Runs: Basecamp's Run tab (the runs in Alp's config, `.herdr/alp.json` and your own, each with a play button, and an import from VS Code) and the bottom panel with each run's output and the Runs list |
| `mods/alp-status/` | the status bar: Herdr's, with a Runs button that shows or hides the bottom panel |
| `mods/alp-tabs/` | the tab bar: an Alp tab pinned before the space's tabs, then the tabs, then icon buttons in two groups, Files and Changes, then Basecamp |
| `plugins/alp/` | Claude Code plugin that writes the status files the mods read |
| `schema/alp.schema.json` | the JSON schema for Alp's config files |
| `RECIPE.md` | the brief to rebuild it from scratch (herdr.dev format) |
| `icon.png` | Alp's logo |
| `sync.sh` | copy the layout and mods into Herdr's home, or pull live edits back |
| `setup.sh` | one-step install: checks `gh`, syncs, installs the plugin and opens Alp's Settings |

## Install

### Quick setup

```sh
git clone https://github.com/ido-galili/herdr-alp && cd herdr-alp
./setup.sh
```

It walks through the steps below, then opens Alp's [Settings](#settings). To do
it by hand instead:

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

Update it later with `/plugin marketplace update herdr-alp`.

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

It has four views: Overview, Board, Herds and Daypack, as tabs after its name, and a Settings
button that shows its settings in place of the view. It works before you set anything:
the Overview starts on all your repositories.

- **Overview:** your GitHub as a whole, or one workspace, picked from the Workspace dropdown on
  top, with what the workspace covers beside it. Each tile ends in what a click opens ("See all
  7 →"); a missing nightly or customer label opens Settings on that workspace instead.
  - **All repos:** four tiles (review requests, your open PRs, your assigned issues, red
    checks), then every repository in scope with its open issues and PRs, the default branch's
    checks, and when it was last pushed. With open work hides the rest, and stays as you left it.
  - **A workspace** is a repository, a project board, or both. With a repository: four tiles
    (open bugs by priority, triage bugs, open customer issues, the last nightly run), the
    spotlight on the next two milestones, and the next milestone (X of Y closed, due date,
    status strip, flags). With a board: the issues in flight, by status, the longest in their
    status first; All milestones switches to the next milestone's only, and each workspace keeps
    its choice. A repository with no board lists its open PRs instead.
- **Daypack:** Today (rows you Pin to Today and todos you type, carried over the next day),
  Waiting for your review with a Review button, Your open PRs, and Your issues with a Start
  button, from every repository in scope. Both buttons open a Claude Code tab running the prompt set in
  Settings, in that repository's local clone, and show only when the prompt is set.
- **Board:** a workspace's board items, a column per status, with each card's assignee avatars.
  Its filter field takes the board's own syntax, such as `type:Bug iteration:@current`: Enter
  applies and saves it, Esc puts the saved one back. The avatars on top pick whose items show,
  several at once. A card names its iteration, unless the filter already asks for that one.
  Settings holds an On Board tick per status that picks the columns. Drag a card
  to another column to move it to that status; right-click it to change its iteration or
  milestone. Both write to GitHub at once, so `gh` needs the `project` scope.
- **Herds:** your Claude Code sessions and their agents, and how they are linked. A session that messaged others
  (`SendMessage`) or made their worktrees is a herdsman, marked with a crook: drawn on top, with a line down to each
  of its herd, labelled `msg 12:36` for its latest message or dotted `worktree`. Who and when
  only: no message text is shown. Sessions with no link are grazing (sessions on their own): a card each, in space order, with a
  stripe in the space's color and its avatar in the corner. Every box and card ends with
  the session's git branch. A session that started agents (the Agent tool, forks included) leads
  them too: a smaller box per agent, a lamb for a fork and a herding dog for any other agent, with what it is for and how long it has run (or when it
  finished), on a line labelled with its type, dotted for a background agent. An agent started
  by an agent sits under it. Agents that finished over 30 minutes ago fold into "+ N finished
  earlier". A click opens
  a session's tab. A background session is shown in the tab titled with its name, or in the
  tab picked with Link a tab. It reads Claude Code's files (`~/.claude/sessions`, the
  sessions' transcripts and agent files) and redraws when a session starts, ends or changes
  status, and every few seconds while its agents work. Open it
  directly with `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"herds"}}'`.
- **Settings:** everything below, as a form (see [Settings](#settings)), shown in place of the
  view, with "Back to Overview" (or the view you came from). Edits you haven't saved stay while Alp
  is open, and the button says so: "Settings · 2 unsaved". After a save, Back fetches again, and
  every other Alp tab fetches too.
- **Refresh:** Overview and Daypack fetch when the tab opens, when it shows data over 2 hours
  old, and from "Updated 3h ago · Refresh", which turns orange after 2 hours.
- **Pinned:** shown in place of the terminals (the Alp layout's pinned tab), the header ends in
  "Back to terminals".
- **Today** shows each pinned issue's board status and each pinned PR's review
  decision, as of the last refresh.
- **Open on a tab or workspace:** `props.tab` (`dashboard` or `overview` for the Overview,
  `board`, `herds`, `today`, `settings`) and
  `props.workspace` (a workspace's name, `""` for All repos):
  `herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","workspace":"Team"}}'`.
- **Demo:** `props.demo` fills every tab with made-up data, for demos and screenshots: an
  org with three workspaces (a repository and a board, a repository only, a board only), every
  bug priority, a failing nightly, cards in every status, PRs in every review state, a Today list
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
rest of Alp only reads. Nothing is saved until Save, which keeps the previous
file as `alpmeister.json.bak`.

| Part | What you set |
|---|---|
| Repos in scope | all your repositories (new ones join on their own; archived ones optional), or only the ones you check |
| Local folders | each repository's clone, where its Claude buttons open; clones found under `~/projects`, `~/code` and the like are offered |
| Claude buttons | what they type into the new Claude tab. `{repo}` and `{number}` are filled in; a `/command` works too |
| Daypack searches | the searches behind Waiting for your review, Your open PRs and Your issues |
| Workspaces | as many as you like, each with a name, a repository and/or a project board |
| A workspace's board | its status and iteration fields, and per status: not started, in flight or other; hidden from Your issues; on hold |
| A workspace's repository | the nightly workflow, its branch and the runs that count; the bugs, triage, spotlight and customer issue settings |

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
- **Show or hide:** the terminal button at the right end of the status bar, after the commands hint.
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

## Working on it

Herdr hot-reloads its home, so the quickest loop is to edit there and pull back:

```sh
./sync.sh pull      # ~/.config/herdr-app -> repo
./sync.sh install   # repo -> ~/.config/herdr-app
herdr-app check ~/.config/herdr-app/mods/pane-agent
```

## Planned

- A browser tab.
- **senn**, the Alp's herdsman: a mod that steers the agents.

## License

[MIT](LICENSE)
