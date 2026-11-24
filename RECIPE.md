# Alp

A calm, dark Herdr window for running coding agents, where you watch over the herd rather than fence it. A sidebar on the left holds your agent account's usage limits (session and weekly, with how close each reset is), your spaces and your agents. On the right the active tab's panes sit as rounded cards, each with a header showing what runs there: the agent, its folder, its model, reasoning effort and context fill, its worktree and branch, and whether it is working, needs you, or is done.

![Alp](preview.png)

## What you see

Left to right:

- **Sidebar**, 268px wide (min 44, max 480, not draggable), on the theme's `chrome` background:
  - **Brand row**, 46px: the shipped `workspace-chrome` header (app name, search, sidebar toggle). Drags the window.
  - **Usage limits**, 96px: two rows, `Session` (5-hour window) and `Weekly` (7-day window). Each row: the label (11.5px, `foreground`, medium), the used percentage right after it (semibold, colored by level), and `resets 4h 11m` / `resets 5d 16h` right-aligned in `dim`. Under it an 8px bar with 4px rounding: `border` track, fill in the level color, and a 2×12px `foreground` tick at how far through the window time is (the right end is the reset). Level colors: `accent` below 70%, `working` from 70%, `blocked` from 90%, `dim` with no data (`–`). A 1px `border` line closes the block.
  - **Spaces** and **Agents**: the shipped lists, sharing the rest equally (each at least 90px).
  - **Footer**, 69px: `workspace-chrome` in footer mode (Settings, Add machine).
- **Work area**:
  - **Tabs**, 42px: Alp's tab bar (`alp-tabs`, the shipped `tabs` with two buttons added). Drags the window. Left to right: the tabs, +, the sheep (Alpmeister), Files, Changes, the Basecamp button, then the window buttons where the platform draws none.
  - **Body**, 8px padding and gap: the active tab's panes, each a card with `background` fill, 1px `border` outline (1px `accent` when focused), 10px radius, 8px between cards, framed even when alone. To the right a hidden 368px panel (280–900) stacking Alp's Files panel (`alp-files`, see Files, below) and the shipped `changes` panel, opened from the tab bar.
  - **Runs panel**, 280px (140–720), hidden at first, between the body and the status bar: a 34px bar, then the selected run's terminal beside a 220px sessions list (see Runs, below).
  - **Status bar**, 28px: `alp-status`, the shipped `workspace-status` with a Runs button after the commands hint, at the right end.
- **Basecamp**, 300px (220–520), hidden at first, the root row's last child, on `chrome`: a 42px header (`basecamp`) over a stack of the Daypack and the Run tab (see Basecamp, below).
- Theme: Dracula, shipped as the layout's own theme `themes/alp.json` (background `#282a36`, chrome `#21222c`, border `#44475a`, hover `#343746`, dim `#6272a4`, accent `#bd93f9`, working `#f1fa8c`, blocked `#ff5555`, done `#50fa7b`) and set as the root's `theme`. Every color below is a theme name, so another theme from the picker restyles it all.
- Window: `canvas` background, no title bar (traffic lights at 12,16), 1px `border` dividers, terminal padding 14×12.

**Pane header**, 30px, always shown, at the top of each card, 12px text on `background` with a 1px `border` bottom line. Left to right:

1. The program's icon (14px; tinted `dim` when the program table marks it tintable).
2. Its name (`Claude Code`, the shell, or the terminal's title), medium weight, `foreground`, truncated at 260px.
3. The folder, `~`-shortened, in `dim`, taking the free space.
4. Chips (18px high, 5px radius, `hover` fill, 10.5px text), only for an agent that reports status: the model (`claude-opus-5-5` → `Opus 5.5`) in `foreground`; the reasoning effort, capitalized, in `accent`; the context fill as a 44×5px bar plus percentage, colored by the same levels as the limits.
5. A worktree chip in `working` color with a branching icon and the worktree's name, when the folder is a linked git worktree.
6. A branch chip `⎇ main` in `muted`, for reporting agents.
7. Status: a 12px spinner in `working` color while working; a `Needs you` chip (semibold, `blocked` text on `blocked` at 15% opacity) when blocked; a 7px `done` dot when done; nothing when idle.
8. Four 14px icon buttons in `dim` (hover: `hover` fill, `foreground`): split right, split down, zoom/unzoom, close.

## How it behaves

- **working**: spinner turning once every 900ms in the pane header; the shipped agents list and tabs show their own state.
- **blocked**: `Needs you` chip in the header.
- **done**: a small `done`-colored dot.
- **idle**: no status mark.
- Clicking a pane header focuses that pane. The four buttons split it right or down, zoom/unzoom it, or close it; their clicks don't also focus.
- The chips follow the agent live: a `/model` or `/effort` change shows on the next prompt, the context bar after each answer. After `/clear` the context bar disappears until the next answer; when the agent exits, all its chips disappear.
- If something else runs in the terminal later, stale chips stay hidden: they show only when the status file's `agent` matches the program in the pane.
- The limits refresh every 5 seconds and the "resets in" text every 30 seconds. With the sidebar folded under 160px the block becomes a 32px rail cell: a gauge icon, the session percentage, a 24×3px bar and a clock with the time to reset (`4h`, `12m`); the full text is its tooltip. The cell has the same 10px top padding as the unfolded rows, and the block shrinks from 96px to 82px so the space under it matches too; unfolding restores 96px.

## Built from

- **Layout** `layouts/alp.json`, cloned from the shipped `main` (0.1.14): `root` row with `"theme": "alp"` → `sidebar` column (`brand` block, `sidebar-lists` column of `limits` / `spaces` / `agents` blocks, `sidebar-footer` block) and `work` column (`tabs` block showing `alp-tabs`, `work-body` row of `main` block + hidden `panel` column with a `panel-body` stack of `files` (showing `alp-files`) / `changes`, hidden `bottom-panel` column, `status` block showing `alp-status`) and the hidden `basecamp` column. `main` shows `{ "tab": "active" }` with a `pane` frame whose `header` is `{ "content": { "mod": "pane-agent" }, "reveal": "always", "height": 30, "position": "top" }`.
- **Shipped mods used**: `workspace-chrome` (brand, and footer with `props: { footer: true }`), `spaces`, `agents`, `changes`. Art borrowed from them: `mods/workspace-chrome/clock.svg`, `mods/workspace-chrome/spinner.svg`.
- **`mods/alp-tabs`**, cloned from the shipped `tabs` (0.1.16) with `mod.clone`, which rewrote its own art paths. Added, marked at the top of `main.js`:
  - The sheep, after +: a 26px button like +, with `sheep.svg` (Alp's own: a fleece outline, a solid face, two legs) at 16px. A click goes to the tab of the space's Alpmeister pane (`panes()` with `mod: "alpmeister"`) or runs `tab.new {mod: "alpmeister", name: "Alpmeister"}`. `selected` while that tab shows. Tooltip "Open Alpmeister" or "Go to Alpmeister".
  - The Basecamp button, after Changes, only when the layout has a `basecamp` node: the tent (`mods/basecamp/tent.svg`) alone in a 26px square, `selected` while the column shows, the icon `accent` while any trail item is open (counted from `~/.local/state/alp/focus.json`, again whenever `shared("alp.focusStamp")` changes) or any run is running (a live terminal with an `alp.run` label and no `alp.run.exit`). It runs `layout.toggle {id: "basecamp"}`.
- **`mods/usage-limits`**: a `View` reading `~/.local/state/herdr-agents/limits.json` with `readTextFile(home() + …)`, picking the entry for `props.agent` (default `"claude"`). Uses `theme()` and `layout()` (sidebar width for the rail), and `run("layout.resize", { id: "limits", px })` when the fold state changes. Props: `agent`, `block` (default `"limits"`), `height` (96), `foldedHeight` (82). Art: `gauge.svg`.
- **`mods/pane-agent`**, cloned from the shipped `pane` (0.1.14): `panes()` + `props().pane` for its pane; `readTextFile` of `~/.local/state/herdr-agents/<terminal>.json` every 3 seconds; `exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])` in the pane's folder (a worktree when the two differ; the worktree name is the git dir's last part); `run("pane.focus" | "pane.split" | "pane.zoom" | "pane.close")`. Art: `close`, `split-down`, `split-right`, `zoom`, `unzoom`, `worktree` SVGs.
- **`plugins/alp`**: a Claude Code plugin (hooks module) that writes the status files; nothing in Claude's own status line. Inside a Herdr terminal (`HC_TERMINAL_ID` set) it writes `<terminal>.json` as `{ agent: "claude", model, effort, context_pct, ts }` on `session.start`, on each main-thread `turn.step` (model, effort) and on `session.measure` (context); on `session.end` it empties the file, or after `/clear` only drops `context_pct`. On `session.measure` with rate limits it rewrites only its own entry in `limits.json`: `{ "claude": { five_hour: { used_percentage, resets_at }, seven_day: {…}, ts } }`.

## Watch out

- The theme is named like the layout (`themes/alp.json`) so it is Alp's own and can't clash with a `dracula.json` the person already has; Settings offers it only on this layout. Picking a theme in the picker rewrites the layout's root `theme`.
- Mod art paths are relative to Herdr's home (`mods/pane-agent/zoom.svg`): renaming a mod means renaming its paths too.
- `pane-agent` compares the file's `agent` along with model, effort and context before redrawing; leave `agent` out and a file from another agent keeps showing the old chips.
- `limits.json` is shared by every agent that reports: read it, change your own key, write it back; never overwrite the whole file.
- Context fill is absent right after `/compact` until the next answer; show nothing rather than 0%.
- A Claude Code session keeps the plugin it started with: after installing or changing the plugin, restart running sessions before expecting chips.
- Only Claude Code reports today: the program keys that get chips are the `REPORTING` set at the top of `pane-agent/main.js`.
- The model name shortening only knows `claude-<family>-<major>[-<minor>]`; other ids show as they are.
- Usage limits show `–` until the first answer of any Claude session after the plugin is installed.
- A layout block has no content-fit size: padding alone can't remove the empty space under the folded cell, so `usage-limits` resizes its own block. It does so only when the fold state changes (render re-runs on every layout change), and the block id in the layout must match its `block` prop.

## Alpmeister

A tab mod, `mods/alpmeister`, for a team lead's start of day. It is not placed by the layout:
open it with `tab.new {mod: "alpmeister"}`.

- **Settings** live in `~/.config/alp/alpmeister.json`, written by the settings tab, in two parts:
  - `account`: your GitHub as a whole. `repos` is `"all"` (every repository you own,
    collaborate on or reach through an organization, archived ones only with `archived`, less
    `exclude`) or a list of `owner/name`. Also the Claude prompts (`launch.issue`, `launch.pr`,
    with `{repo}` and `{number}`), each repository's local clone (`folders`), and the @me
    searches the Daypack lists (`queries.review`, `queries.mine`, `queries.myPrs`).
  - `workspaces`: each a `repo`, a project `board` (`owner`, `number`, `statusField`,
    `iterationField`, on a user or an organization), or both, with its own `statuses`,
    `notStarted`, `inFlight`, `mineHidden`, `queries.triage`, `bugs`, `spotlight`, `customer`
    and `nightly`.
  - No file means `account.repos: "all"` and no workspaces. A file in the earlier one-repo
    shape (top-level `repo` and `project`) reads as one workspace, its `launch.folder` as that
    repository's folder.

- **What you see**, top to bottom on the `canvas` background, 18px padding, cards with 10px
  radius and a 1px `border`:
  - A header: three pill tabs, Dashboard, Herds and "Daypack · N" (N open focus items), then
    "Alpmeister" (18px semibold), "updated 4m ago" in `dim` (`working` after 2 hours), a Refresh
    text button, and a gear icon button (`mods/workspace-chrome/settings.svg`, tooltip
    "Settings"). The gear goes to the space's tab named "Alpmeister settings", or opens one:
    `tab.new {mod: "alpmeister", name: "Alpmeister settings", props: {tab: "settings"}}`. That
    copy shows a gear and "Alpmeister settings" as its header, then the form, and fetches nothing
    from GitHub but the form's choices. Each other copy remembers its tab and
    workspace in localStorage; `props.tab` and `props.workspace` open a copy on a given one
    (`tab.new {mod: "alpmeister", props: {tab: "dashboard", workspace: "Team"}}`, `""` for All
    repos). `props.demo: true` shows a made-up herd on the Herds tab, for demos and screenshots.
  - **Dashboard**: with any workspaces, a row of pills on top switches between them and "All
    repos" (the last one). Without, it shows All repos alone.
  - **All repos**, top to bottom:
    - Four tiles: review requests, your open PRs (with how many are approved or have changes
      requested), your assigned issues, and red checks (default branches failing, your PRs
      failing).
    - The Repos card: every repository in scope, most recently pushed first, 12 rows then
      "Show N more", with a "With open work" toggle. A row: `owner/name` (dim without open
      work), then chips for private, archived, "local" (a folder is set), open issues, open PRs,
      the default branch's checks ("main passing", or `Needs you` style "main failing"), and
      "pushed 3d ago". A click opens the repository.
  - **A workspace**, top to bottom; the repository's cards show only with a `repo`:
    - Four tiles, in one row when the tab is at least 1000px wide, else two by two: open bugs by
      priority (total, a strip and a chip per priority, counted from the priority issue field),
      triage bugs, open customer issues (any label whose name contains `customer.labelMatch`,
      named under the count), and the last nightly run.
    - The nightly tile: "Success", "Failure" or "Running" for the last run, its local start date
      and time ("Tue 17 Nov, 06:05"), then one line per
      `nightly.checks` entry (deploy, unit, API and E2E tests) with an outcome chip. A check
      matches jobs by name, a step inside them, or every job except some.
    - The Spotlight card, derived from the issues of the next two milestones. One column per
      milestone, side by side when wide:
      - Its open issues with a priority value, a `spotlight.labels` label or a
        `spotlight.featureTypes` type. Most urgent first, then by feature type.
      - Each row shows its issue type beside the number, then its priority or label, an epic's
        "X of Y" sub-issues, its status, and an Unassigned flag. Rows show no due dates.
      - 8 rows, then "Show N more".
      - Below the columns, "To discuss": the issues in `spotlight.holdStatus` in either milestone.
        Left out with no board, as there are no statuses.
    - The next milestone card: its title (20px) with "1 of 12 closed", a usage-limits style bar
      (closed share, tick at the time gone since the previous milestone's due date, `working`
      when behind the tick), a 6px strip of board-status segments, a chip per status, and
      `Needs you` style flags for unassigned issues and for `notStarted` issues (New, Todo by
      default) in the last 7 days. With no board, the strip and chips are Open and Closed.
  - With a board, Team in flight, full width: the board's open issues in the configured statuses, grouped in
    board order, with toggles for the next milestone and the current iteration, 5 rows per group with "Show N more". Flagged rows first: a row outside the
    current iteration gets a warning chip naming its iteration or "No iteration". Chips for
    assignee, milestone, days in status and each linked PR's review state. An item from another
    repository than the workspace's names it in a chip.
  - With a repository and no board, Open PRs in its place: the repository's open PRs (drafts
    dimmed), with author, review decision, checks and age, Pin and the Claude button.
  - **Board**: a workspace's board items that match its filter (`boardView.query`, the board's
    own filter syntax, default `iteration:@current`) and its ticked statuses
    (`boardView.statuses`, the On Board column of the status table), up to 500. The workspaces
    with a board get the pill switch when there are two or more.
    - On top, the filter field. Enter fetches the board with it, then saves it to the settings
      file; a filter GitHub refuses stays in the field with the error, unsaved. Esc puts the
      saved filter back.
    - Under it, the people picker: each assignee's avatar with their item count, most items
      first, then Unassigned. A click picks or unpicks one, several at once; with any picked,
      the board shows only their items and Everyone clears the pick. Each workspace's pick is
      kept in localStorage.
    - The columns are the ticked statuses, each shown even when empty; with none ticked, the
      statuses that hold an item.
    - A card holds the number, the issue type, the session icon, Pin, the Claude button, the
      title, the linked PRs' review state (a PR's own decision), the iteration (Current iteration,
      in `accent`, for the current one), the milestone, and the assignees' avatars. The iteration
      and milestone chips and menu rows carry GitHub's Octicons (`iteration.svg`,
      `milestone.svg`, MIT). Long chips end in an ellipsis before the
      avatars. A click on a card opens it on GitHub.
    - The avatars download once with curl into `data/alpmeister/avatars/`, named for the image
      type GitHub serves; until then the login's initials show.
    - Dragging a card (a press that moves more than 5px) lifts it out of its column and draws it
      under the pointer, where it was pressed, at its own size. The column under the pointer
      (by the pointer's x) holds a tinted, dashed slot the card's height at the spot it would
      land: before the first card whose middle is below the pointer, else last. A drop sets the
      card's Status when the column differs, then its place on the board, just after the card
      above the slot (`updateProjectV2ItemPosition`), or at the top. A drop where it started does
      nothing.
    - A right click opens the card's menu: Iteration and Milestone, each with the card's current
      value and a chevron. Pointing at one or clicking it opens its menu beside it, level with its
      row. Iteration lists No iteration, the last three completed iterations and every open one
      (the current one noted). Milestone lists No milestone and the repository's open milestones,
      soonest due first (read on the first open). The card's own are ticked. A card shows its
      milestone in a chip.
    - A move shows at once and the card dims while GitHub writes it. A refused write puts the
      card back and shows the error over the columns. The board's ids come with its load, so a
      Board drawn from an older cache asks for a Refresh first.
  - **Daypack**, across every repository in scope (with `"all"`, everything the searches find).
    Today's focus across the top: a todo input, then Todos, PRs and Issues, each
    under a heading with its open count. A row: checkbox, `repo#number`, title, the issue's board
    status or the PR's review decision (Approved, Changes Requested, In Review, or Merged or
    Closed), days since it was added (from the next day), the session icon, a Claude button,
    Remove. Items stay until removed. The session icon, a terminal, shows while a tab named for the
    item is open (`repo#12`, or `PR repo#12`, the name a Claude button gives it). Its color is that
    tab's agent status, and a click shows the tab. Below it, two columns:
    - The PRs that need your attention (author, review decision, age, checks, Pin, Review), then My PRs: your
      open, non-draft PRs (`queries.myPrs`) with the review decision, checks and age (Pin,
      Review).
    - Your issues grouped by status, current iteration only by default (Pin, Start). An issue's
      status comes from the first of its boards that a workspace is on, read with that
      workspace's status field; the groups follow the workspaces' status order, and an issue is
      hidden when its status is in its workspace's `mineHidden`. Issues on no workspace's board
      go under "No status".
    - Every row in these lists names its repository in a chip after the number.
  - **Settings** (the settings copy): the settings file as a form. A save sets
    `shared("alp.settingsStamp")`, and every other copy fetches again. Nothing is written until Save, which writes over
    the version it read (or refuses, when the file changed on disk: Revert loads it) and keeps
    the previous file as `alpmeister.json.bak`. "Reload choices" reads GitHub and your disk again.
    - "Your GitHub": All my repos (with Include archived) or Only the ones I pick, then a
      checklist of your repositories (30px rows, scrolling after 12): the checkbox puts one in
      or out of scope, badges for private, archived and fork, its local folder with Folder… (the
      system folder picker) and ×. Clones found on disk (an `origin` on github.com, under
      `~/projects`, `~/code`, `~/src` and the like, 4 levels deep) are offered with "Use
      ~/path", or all at once. Then the Claude prompts, and the Daypack searches folded.
    - "Workspaces": a pill per workspace and "+ Add workspace"; the one shown below: Name,
      Repository and Project board (dropdowns: your repositories; the boards linked to the
      repository, then every open board on your account and organizations), then with a board
      its Status and Iteration fields, and a row per status (from the board, in board order):
      Counts as Not started / In flight / Other, Hide in Your issues, On hold. Picking a board
      takes its statuses and guesses their roles from their names. With a repository: the
      nightly workflow (from the repository's workflows), its branch and the runs that count,
      its checks (read only: edited in the file), then folded: bugs, triage, spotlight and
      customer issue settings. "Remove workspace" asks for a second click.
- **How it behaves:** a click on a row opens it on GitHub. Pin adds the row to today's focus. A
  pinned issue or PR checks itself once it closes or merges; each refresh reads every pick's
  state, board status and review decision, checked or not, and keeps them on the item. A pick is
  keyed by `kind-owner/name#number`; one pinned before workspaces gets its repository from its
  URL. Review and Start open, when a prompt is set, a tab named `repo#12` running `claude` with
  the prompt, in the space you are in. The tab starts in the live folder of that space's first
  tab (its first pane's `cwd`) when it is the repository's folder or inside it, such as a
  worktree, else in that folder, else in the space's own.
  The Daypack's Claude buttons do the same. It fetches when the tab opens and on Refresh only.
  - **Herds**: the Claude Code sessions on this machine and the links between them.
    - A Herds card: each herd as a graph. Its herdsman (the session that made the most links)
      is a box with an `accent` border; a 1px `border` line drops to a bar,
      and from it a 22px stub to each member's box, side by side, 260px of room each, centered.
      A stub is solid and labelled `msg 14:27` (the latest message) or dotted (four 3px dashes)
      and labelled `worktree`. Links between members are listed below the graph as one dim line
      each. Who and when only: never message text.
    - Role marks: Alp's own 24px line icons at 14px, at the end of each box's first line, with
      their meaning on hover: the herdsman's crook (`crook.svg`, `accent`), a cow for a member
      session and for each grazing card, before the space's avatar (`cow.svg`), a lamb for a fork agent (`lamb.svg`), a herding dog for any other agent
      (`dog.svg`), all in `muted` but the crook.
    - Agents: a session that started agents (`<session>/subagents/agent-<id>.meta.json`) is the
      herdsman of a herd with them, even with no link to another session. Its agents sit beside
      its member sessions under the same bar, 180px of room each: a 58px box (`working` border
      while it works) with the status mark and the agent's description, then "12m" running ("·
      quiet" with no write for 3 minutes), or "done 5m ago". The stub is labelled with the agent's
      type, dotted for a background agent. Tooltip: fork or type, background or foreground, model,
      start time. A click opens the session's tab. A member session's own agents stack under its
      box. An agent with `spawnDepth` 2 or more sits under the agent whose transcript holds its
      `toolUseId`, a step in, as deep as they go. Agents finished more than 30 minutes ago fold
      into a "+ N finished earlier" button under the herd. The Herds chip adds "N agents
      working".
    - A Grazing card: the sessions with no link and no recent agents, as a wrapping grid of 272px cards in the
      sidebar's space order, then the ones in no space. A card: a 3px stripe down the left edge
      in the space's color, the status mark and name, the space's avatar (its letter on its
      color, 15px) in the corner with the space's name on hover, the tab's name below (the
      space's name when the tab is titled with the session's own name).
    - Every box and card is 86px tall: name, tab, then a branch tag (Herdr's
      `workspace-chrome/git-branch.svg` and the name, on `hover`); a card without a branch
      keeps the room. A background session that no tab shows has a "Link a tab" button in its
      tab line; the picker opens below its box, or below the grid.
- **Built from:** `config.js` (settings, defaults, the one-repo upgrade), `queries.js` (the
  GraphQL documents: `ACCOUNT` for the repositories and @me searches, `WORKSPACE_REPO` and
  `WORKSPACE_BOARD` per workspace, the board through `repositoryOwner(login:) … on
  ProjectV2Owner` so user boards work, `DISCOVER`, `REPO_BOARDS` and `BOARD_FIELD_LIST` for
  Settings), `data.js` (`gh api graphql`, `gh api` for workflow runs and jobs; the account and
  each workspace load apart, each failing on its own; the cache carries `version: 2`),
  `focus.js` (the focus file, written with `writeTextFile` over the last read version),
  `account.js`, `project.js`, `spotlight.js`, `in-flight.js`, `my-day.js`, `focus-list.js`,
  `settings-data.js` (discovery, clones, save), `settings-view.js` (the form), `ui.js`, and
  `main.js`. Herds:
  `herds-data.js` reads Claude Code's files (it never writes them): `~/.claude/sessions/*.json`
  (live sessions, kept when `ps` finds their pid), `~/.claude/jobs/<id>/state.json` (a
  background session's state), and each live session's transcript
  `~/.claude/projects/*/<session>.jsonl`, where `grep` picks the main conversation's
  `SendMessage` calls (`input.to`, a session name) and `git worktree add` commands (the folder,
  matched to a session's `cwd`); a tool call can appear twice, so they are deduped by id. A
  session's tab is the Herdr terminal whose foreground pid (`hc get <t> --json`) is the
  session's pid; a background session's is the Claude tab titled with its name, else the one
  picked with Link a tab (`~/.local/state/alp/herds.json`). The branch is the pane's live
  `branch`, else `git branch --show-current` in the session's folder. `herds-view.js` draws it;
  `watchFolder(~/.claude/sessions)` reloads it, and so does each live session's `subagents`
  folder, with a 3-second pause (`cx.timer.after`) after each change, as agents write often. The
  agents are read in one `sh` call: per agent its meta file, the first `timestamp` in the first
  lines of its transcript (the first line is a header with none), the transcript's mtime
  (`stat -c %Y`, or `stat -f %m` on macOS), and for a nested agent the sibling transcript that
  holds its `toolUseId` (`grep -l -F`). `demo-herds.js` is the demo's herd, in `loadHerds()`'s
  shape plus `demo: { agents, spaces, colors }`, which the Herds tab draws with in place of
  `agents()`, `spaces()` and `shared("space.colors")`; in demo mode nothing is watched, the canvas
  takes half the tab, and a click on a card opens nothing.
- **Watch out:** issue search cannot filter on a board field, so in-flight items come from the
  project's own `items(query:)` filter. GitHub milestones have no start date. The runtime has no
  locale data, so dates are formatted by hand. Without a `mod.json` with `"place": "none"`, Herdr
  docks a copy of the mod into the shown layout the first time it sees the folder. Herds: `hc ls`
  has no foreground pid, so ask `hc get` per Claude terminal; `flex_shrink` takes a number.
- **Watch out (workspaces):** the @me searches run once with no `repo:` qualifier and are
  filtered to picked repositories in code, so the scope never meets GitHub's limits on query
  length and operators. Account queries read every board's field values with their field names
  (`fieldValues`), as each workspace's board may name its Status field differently. Text state
  (`InputState`) is made once in `init`; each Settings text field writes only its own key, so
  filling them for another workspace cannot mix two workspaces' values.
- **Done when:** `herdr-app check` passes, the milestone headline, triage count, team PR count
  and in-flight groups match the same queries run with `gh`, and with no settings file the
  Dashboard lists your repositories.

## Done when

- `herdr-app check` passes for `mods/usage-limits` and `mods/pane-agent`, and `herdr-app do layout.switch '{"name":"alp"}'` returns ok with no errors in `herdr-app status`.
- A new Claude Code session in a Herdr terminal shows its model, effort and context chips in the pane header within 3 seconds of its first answer, and `~/.local/state/herdr-agents/<terminal>.json` holds `"agent":"claude"`.
- Changing the file's `agent` to anything else hides the chips within 3 seconds.
- The sidebar shows Session and Weekly percentages and reset times matching `limits.json`, and folding the sidebar shows the rail cell with the same space above and below it as the unfolded rows (the `limits` block at 82px), back to 96px when unfolded.
- Exiting Claude empties the terminal's file and its chips disappear.

## Basecamp

- **What:** the column on the window's right edge, beside the terminals as the left sidebar is.
  The Basecamp button in the tab bar shows or hides it (drawn by `alp-tabs`, above).
- **Where:** the `basecamp` column, the root row's last child: a `basecamp-header` block (42px,
  drags the window) showing `mods/basecamp/`, over the `basecamp-body` stack of
  `basecamp-daypack` (`daypack`) and `basecamp-run` (`alp-runs` with `props: { part: "list" }`).
- **Header:** two tabs, Daypack (the backpack, then the open trail count in `accent`) and Run
  (`mods/alp-runs/play.svg`, then the running count in `working`), `selected` on the stack's
  active child; a click runs `layout.select`. A close button runs `layout.hide`.

## Daypack

- **What:** what you carry through the day, Basecamp's first tab. It holds today's trail.
- **How it looks:**
  - A "TODAY'S TRAIL" group (empty: "The trail is clear.")
    with the items in sections by kind (Todos, PRs, Issues), each headed by its open count.
    A row holds the item's checkbox, title and number. A click on a title opens it on GitHub.
    A PR row also shows where it stands: Merged or Closed, else its review decision (Approved,
    Changes, In Review), as of Alpmeister's last refresh.
  - An issue or PR row ends with the Claude button: it opens a Claude tab running the prompt from
    Alpmeister's settings (`account.launch`, or `launch` in the one-repo shape) in the item's
    repository folder (`account.folders`), as Alpmeister's Start and Review buttons do. The
    button shows only when that prompt is set. The number shows as `repo#12`.
  - A middle click on any Claude button opens the tab in the background (`tab.new` with
    `focus: false`), and a Herdr notification names it; a click on the notification shows the
    tab. A left click opens it and shows it.
  - Before the Claude button, the session icon shows while the item's Claude tab is open, as on
    Alpmeister's Daypack. A click shows that tab.
- **State:**
  - It reads and writes `~/.local/state/alp/focus.json`, the file Alpmeister keeps. Mods cannot
    import across folders, so `focus-file.js` is its own reader of that format.
  - Each side sets `shared("alp.focusStamp")` after a write, and the other reloads the file.

## Runs

- **What:** one mod, `mods/alp-runs/`, drawn by `props().part`: `list` (Basecamp's Run tab),
  `bar`, `sessions` and `empty` (the runs panel), and `input`, `save`, `menu` (overlays).
- **Workspace:** the first of the focused terminal's folder, the active tab's terminals', the
  space's other terminals' and the space's folder that is in a git repo. `git rev-parse
  --path-format=absolute --show-toplevel --git-common-dir` gives its root and, for a worktree,
  the main checkout.
- **Entries:** `.vscode/launch.json` (configurations and compounds), `.vscode/tasks.json` (with
  the `osx`/`linux`/`windows` block) and `~/.config/alp/commands.json` (`{ commands: [{ name,
  command, cwd?, env?, inputs?, workspace? }] }`, `workspace` matching the root or the main
  checkout). JSONC is read by `jsonc.js`. `${workspaceFolder}`, `${env:X}`, `${userHome}` and
  `${input:id}` resolve; `${file}`-like variables, `${command:}`, `${config:}`, browser, attach
  and other debugger types mark the entry as not runnable, with the reason.
- **Run tab:** a filter and reload button, the workspace name, then LAUNCH, TASKS and SAVED (with
  +). A row: the session mark (`●` `working`, `✓` `done`, `✗` `blocked`), the name, and a play
  button (a spinner while starting). A click on a row with a session selects it. Entries that
  can't run fold under "N need VS Code". Right-click: a saved command offers Edit and Delete, a
  task offers "Save to my commands…".
- **Starting:** inputs first (the `input` dialog: chips for `pickString`, fields for
  `promptString`, defaults from `shared("alp.runs.inputs")`), handed back to the list through
  `shared("alp.runs.launch")`. Then `dependsOn`/`preLaunchTask` (sequence or parallel; a task
  that isn't `isBackground` must exit 0 first), then the command or, for a compound, each
  config. A command runs as `hc run --bg --no-parent --name <slug> --cwd <cwd>` with the labels
  `alp.run`, `alp.run.key`, `alp.run.kind` and `alp.workspace`, in `$SHELL -l -i -c` with a
  wrapper: `trap : INT`, the command in a subshell, then `hc label <name> alp.run.exit=$?`, an
  "exited with" line and `exec tail -f /dev/null`, so the terminal and its output stay. A
  finished session of the same entry is closed first; a running one is shown instead.
- **Runs panel:** the `bottom-panel` column in `work`: `runs-bar` (34px, `part: "bar"`), then the
  `runs-body` row of `run-output` (the selected session's `{ terminal }` block, or `part:
  "empty"`) and `runs-sessions` (220px, `part: "sessions"`). The selection is
  `shared("alp.runs.selected")`; `panel.js` rewrites `run-output` with `layout.set`, because
  Herdr drops a terminal block when its terminal ends. The bar shows the mark, the entry, the
  terminal name, stop (SIGINT to the foreground process group; a second press within 4 s sends
  TERM), restart (with the answers it started with, `shared("alp.runs.started")`) and hide.
- **Status bar:** `mods/alp-status/`, cloned from `workspace-status` (0.1.16), adds the Runs button
  (`mods/alp-runs/terminal.svg` and the running count) after the commands hint, that runs
  `layout.toggle {id: "bottom-panel"}`.
- **Agents:** the plugin's `alp-runs` skill: `hc ls --label alp.workspace=<root>` and `hc read
  <name>`.

## Files

- **What:** the Files panel with a minimal editor. A click on a file opens it in Herdr's own
  `Editor` (syntect highlighting, line numbers, folding); local files are editable.
- **Where:** `mods/alp-files/`, cloned from the shipped `files`; the `files` block in
  `panel-body` shows it. The tab bar's Files button still selects the block id `files`.
- **Footer:** 32px under an open file, always there so the editor never moves: `No changes` or
  `Unsaved`, a `ctrl-s` hint and Save (`dim` when clean, `accent` when edited); `Saving…`;
  `Changed on disk` with Reload and Overwrite (`Deleted on disk` with Save again); a failed save
  with Retry; or why the file is read-only. An edited file also gets an `accent` `●` after its
  name in the header and in the tree.
- **Saving:** `ctrl-s` (an `on_key_down` around the editor, `cmd-s` in GPUI's spelling) or Save
  runs `writeTextFile(path, text, base)`, which refuses when the file changed since it was read.
  Overwrite passes the file as it is now. Unsaved documents are kept by path when you go back to
  the tree or focus another folder, and come back when the file is reopened.
- **Following the disk:** on each refresh (the folder watch, or every 10 s) the open file is read
  again: a clean document takes the new text, an edited one shows `Changed on disk`.
- **Read-only:** files on another machine (`writeTextFile` writes here only) and files over
  400,000 characters (shown cut off).
- **Highlighting:** syntect's default grammars, by extension. Missing ones map to the closest
  (TypeScript → JavaScript, TOML → YAML, Vue/Svelte → HTML), and files without an extension go
  by name (`Makefile`, `Dockerfile`, `.bashrc`, `.env`, …). Colors are Dracula's roles from the
  theme's ANSI colors: keywords and operators `ansi5`, strings `ansi3`, functions `ansi2`, types
  `ansi6`, numbers and constants `ansi4`, comments `dim`.
