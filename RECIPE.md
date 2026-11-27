# Alp

A calm, dark Herdr window for running coding agents, where you watch over the herd rather than fence it. A sidebar on the left holds your agent account's usage limits (session and weekly, with how close each reset is), your spaces and your agents. On the right the active tab's panes sit as rounded cards, each with a header showing what runs there: the agent, its folder, its model, reasoning effort and context fill, its worktree and branch, and whether it is working, needs you, or is done.

![Alp](preview.png)

## What you see

Left to right:

- **Sidebar**, 268px wide (min 44, max 480, not draggable), on the theme's `chrome` background:
  - **Brand row**, 46px: `alp-chrome`, the shipped `workspace-chrome` header (app name, search, sidebar toggle) with Alp's 60px rail. Drags the window.
  - **Usage limits**, 96px: two rows, `Session` (5-hour window) and `Weekly` (7-day window). Each row: the label (11.5px, `foreground`, medium), the used percentage right after it (semibold, colored by level), and `4h 11m left` / `5d 16h left` right-aligned in `dim`. Under it an 8px bar with 4px rounding: `border` track, fill in the level color. The row's tooltip has the full text: used, how much of the window's time is gone, and the reset ("Weekly: 74% used, 55% of the time gone · resets in 3d 4h"). Level colors: `accent` below 70%, `warning` from 70%, `blocked` from 90%, `dim` with no data (`–`). A 1px `border` line closes the block.
  - **Spaces** and **Agents**: `alp-spaces` and `alp-agents`, the shipped lists with Alp's changes. Spaces is as tall as its rows (up to 300px, then it scrolls); Agents gets the rest (each at least 90px).
  - **Footer**, 41px: `alp-chrome` in footer mode (Settings alone; Add machine is in the Spaces "+" menu).
- **Work area**:
  - **Tabs**, 42px: Alp's tab bar (`alp-tabs`, the shipped `tabs` with the Alp tab and buttons added). Drags the window. Left to right: the pinned Alp tab, a 1px line, the tabs, +, a 1px line, Basecamp (icon-only), then the window buttons where the platform draws none.
  - **Body**, a stack of the terminals and Alp (`alpmeister-view`), swapped from the pinned tab. The terminals, 8px padding and gap: the active tab's panes, each a card with `background` fill, 1px `border` outline (1px `accent` when focused), 10px radius, 8px between cards, framed even when alone.
  - **Runs panel**, 280px (140–720), hidden at first, between the body and the status bar: a 34px bar, then the selected run's terminal beside a 220px Runs list (see Runs, below).
  - **Status bar**, 28px: `alp-status`, the shipped `workspace-status` with a Runs button after the commands hint, at the right end.
- **Basecamp**, the one right dock, 360px (300–900), hidden at first, the root row's last child, on `chrome`: a 42px tab strip (`basecamp`) over a stack of Files, Changes, Today and Run (see Basecamp, below).
- Theme: Dracula, shipped as the layout's own theme `themes/alp.json` (background `#282a36`, chrome `#21222c`, border `#44475a`, hover `#343746`, muted `#bfbfd0`, dim `#8b95c9`, accent `#bd93f9`, working `#f1fa8c`, warning `#ffb86c`, blocked `#ff5555`, done `#50fa7b`) and set as the root's `theme`. Every color below is a theme name, so another theme from the picker restyles it all. One meaning per color: `working` (yellow) is working or running only, `warning` (orange) marks warnings (usage and context over 70%, stale data, unsaved edits, unassigned, close deadlines, changed on disk); mods fall back to `#ffb86c` when a theme has no `warning`. No text under 11.5px but glyphs in tiny fixed boxes.
- Window: `canvas` background, no title bar (traffic lights at 12,16), 1px `border` dividers, terminal padding 14×12.

**Pane header**, 30px, always shown, at the top of each card, 12px text on `background` with a 1px `border` bottom line. Left to right:

1. The program's icon (14px; tinted `dim` when the program table marks it tintable); its tooltip names the program (`Claude Code`, the shell). A program with no icon shows its name instead (medium weight, `foreground`, truncated at 260px), so the header never starts blank.
2. Status, right after the icon: a `Needs you` chip (semibold, `blocked` text on `blocked` at 15% opacity) when blocked; a 12px spinner and "working" in `working` color while working; a 13px `done` check when done; nothing when idle.
3. One muted line in `dim`, taking the free space: `folder · [branch icon] branch`, or in a linked git worktree the worktree first, `[worktree icon] <worktree> · [branch icon] branch` (the folder shows after it only when it is a subfolder). Outside git, just the folder. A narrow pane cuts the folder and branch first and the worktree's name only after them. Tooltip: the full path, plus "Linked worktree of <repo>".
4. Chips (18px high, 5px radius, `hover` fill, 11.5px text), only for an agent that reports status: the model and reasoning effort in one chip in `foreground` (`claude-opus-5-5` + `high` → `Opus 5.5 · high`); the context fill as "context" in `muted`, a 44×5px bar and the percentage, colored `accent`, `warning` from 70%, `blocked` from 90%.
5. Only while the header is hovered or the pane focused, four 14px icon buttons in `dim` (hover: `hover` fill, `foreground`): split right, split down, zoom/unzoom, then a 1px divider and close.

An Alp page that is its tab's only pane (a `tab.new` copy) gets no header: the strip is drawn in `canvas`, so it looks like the pinned Alp view. A Files editor pane gets an empty one (it draws its own top line).

## How it behaves

- **working**: spinner turning once every 900ms in the pane header, with "working"; the agents list and tabs show their own state.
- **blocked**: `Needs you` chip in the header.
- **done**: a small `done`-colored check.
- **idle**: no status mark.
- Clicking a pane header focuses that pane. The four buttons split it right or down, zoom/unzoom it, or close it; their clicks don't also focus.
- The chips follow the agent live: a `/model` or `/effort` change shows on the next prompt, the context bar after each answer. After `/clear` the context bar disappears until the next answer; when the agent exits, all its chips disappear.
- If something else runs in the terminal later, stale chips stay hidden: they show only when the status file's `agent` matches the program in the pane.
- The limits refresh every 5 seconds and the "left" text every 30 seconds. With the sidebar folded under 160px the block becomes a 32px rail cell: a gauge icon, the session percentage, a 24×3px bar and a clock with the time to reset (`4h`, `12m`); the full text is its tooltip. The cell has the same 10px top padding as the unfolded rows, and the block shrinks from 96px to 82px so the space under it matches too; unfolding restores 96px.

## Built from

- **Layout** `layouts/alp.json`, cloned from the shipped `main` (0.1.14): `root` row with `"theme": "alp"` → `sidebar` column (`brand` block, `sidebar-lists` column of `limits` / `spaces` / `agents` blocks, `sidebar-footer` block) and `work` column (`tabs` block showing `alp-tabs`, `work-stack` stack (active `work-body`) of the `work-body` row (the `main` block) and the `alpmeister-view` block showing `alpmeister`, hidden `bottom-panel` column, `status` block showing `alp-status`) and the hidden `basecamp` column (the dock: `basecamp-header` block, `basecamp-body` stack of `files` / `changes` / `basecamp-daypack` / `basecamp-run`). `main` shows `{ "tab": "active" }` with a `pane` frame whose `header` is `{ "content": { "mod": "pane-agent" }, "reveal": "always", "height": 30, "position": "top" }`.
- **Shipped mods used**: `changes`. Cloned with Alp's changes: `alp-chrome` from `workspace-chrome` (brand, and footer with `props: { footer: true }`), `alp-spaces` from `spaces`, `alp-agents` from `agents`. Art borrowed from `workspace-chrome`: `clock.svg`, `spinner.svg`, `check.svg`, `branch.svg`.
- **`mods/alp-tabs`**, cloned from the shipped `tabs` (0.1.16) with `mod.clone`, which rewrote its own art paths. Added, marked at the top of `main.js`:
  - First, before the tabs: a pinned Alp tab, drawn like a tab (`dashboard.svg` at 14px, then "Alp"), raised while `work-stack` shows `alpmeister-view`, then a 1px line. A click runs `layout.select {stack: "work-stack", child: "alpmeister-view"}`, or `work-body` when it already shows (tooltip "Show Alp" or "Back to the terminals"). While it shows, the space's tabs are greyed. Clicking a tab selects `work-body` on that tab, and so does any change of the active space or tab (a key, + or a tab Alp opens), so that tab shows.
  - The space's tabs shrink evenly to a minimum width (48px of name, at most 170), then "+N" lists the rest (a red "!" on it when one needs you). A tab that needs you shows a red "!", a done one a green check, a zoomed one an expand icon (tooltip "Zoomed: one pane fills this tab. Click to show all panes."; a click unzooms). The active tab has a ⋯, the same menu as a right-click: Rename, Show all panes (when zoomed), Move left, Move right, New tab, then Put away (`tab.settle`, its tooltip saying what that does) and Close; the pointer and the arrow keys move one highlight, Enter and Esc work in it.
  - After + and a 1px × 16px `border` line (5px each side), icon buttons, each a 26px square with a 15px Lucide icon (copied into `mods/alp-tabs/`): `muted` on `chrome` while off, `foreground` on `selected` while on, `foreground` on `hover` under the pointer. The shipped labelled Files and Changes pills are gone: Files and Changes are tabs of the dock.
  - Alp (`dashboard.svg`, layout-dashboard), only when the layout has no `work-stack` with `alpmeister-view`, in place of the pinned tab: a click goes to the tab of the space's Alp pane (`panes()` with `mod: "alpmeister"`) or runs `tab.new {mod: "alpmeister", name: "Alp"}`. On while that tab shows. Tooltip "Open Alp" or "Go to Alp". The Alp tab itself shows the same icon at 14px before its name (`foreground` while active, `muted` otherwise).
  - Basecamp (`panel-right.svg`), last, only when the layout has a `basecamp` node: on while the dock shows; it shows the dock on the tab it last showed, or hides it. Its tooltip names the dock's tabs with their counts: "Show Basecamp: Files, Changes (2 changed), Today (1 open) and Run (1 running)", counting changed files (the read-only `git status` the Changes tab runs, at most every 10 s, also shared as `alp.changedFiles` for the dock's strip and drawn as an `accent` badge on the icon), open Today items (from `~/.local/state/alp/focus.json`, again whenever `shared("alp.focusStamp")` changes) and running runs (a live terminal with an `alp.run` label and no `alp.run.exit`).
  - The dock is remembered per space in `localStorage` `dock` (null, or the stack child it shows): switching to a space shows its choice; a space with none leaves the dock as it is. The first time, it is made from the older `panels` key (a space whose Files or Changes panel was open opens the dock on that tab; the others get Basecamp's state).
- **`mods/usage-limits`**: a `View` reading `~/.local/state/herdr-agents/limits.json` with `readTextFile(home() + …)`, picking the entry for `props.agent` (default `"claude"`). Uses `theme()` and `layout()` (sidebar width for the rail), and `run("layout.resize", { id: "limits", px })` when the fold state changes. Props: `agent`, `block` (default `"limits"`), `height` (96), `foldedHeight` (82). Art: `gauge.svg`.
- **`mods/pane-agent`**, cloned from the shipped `pane` (0.1.14): `panes()` + `props().pane` for its pane; `readTextFile` of `~/.local/state/herdr-agents/<terminal>.json` every 3 seconds; `exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])` in the pane's folder (a worktree when the two differ; the worktree name is the git dir's last part); `run("pane.focus" | "pane.split" | "pane.zoom" | "pane.close")`; `on_hover` for the buttons. Art: `close`, `split-down`, `split-right`, `zoom`, `unzoom`, `worktree` SVGs.
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

## Alp

A mod, `mods/alpmeister`, for a team lead's start of day, shown as **Alp**. The layout places it
in `alpmeister-view`, shown from the pinned tab; it also opens as a tab with
`tab.new {mod: "alpmeister", name: "Alp"}`.

- **Settings** live in `~/.config/alp/alpmeister.json`, written by Settings, in three parts:
  - `account`: your GitHub as a whole. `repos` is `"all"` (every repository you own,
    collaborate on or reach through an organization, archived ones only with `archived`, less
    `exclude`) or a list of `owner/name`. Also the Claude prompts (`launch.issue`, `launch.pr`,
    with `{repo}` and `{number}`), each repository's local clone (`folders`), and the @me
    searches of your lists on the Overview (`queries.review`, `queries.mine`, `queries.myPrs`).
  - `workspaces`: each a `repo`, a project `board` (`owner`, `number`, `statusField`,
    `iterationField`, on a user or an organization), or both, with its own `statuses`,
    `inFlight` (its `statuses`, `excludeTypes` and Team in flight's `filter`), `mineHidden`, `queries.triage`, `bugs`,
    `spotlight` (the Milestone card's issues), `customer`, `nightly` and `boardView`.
  - `files`: the Files editor's auto save (`autoSave`: `off`, `afterDelay` or `onFocusChange`;
    `autoSaveDelay` in ms, 200–60000, default 1000).
  - No file means `account.repos: "all"` and no workspaces. A file in the earlier one-repo
    shape (top-level `repo` and `project`) reads as one workspace, its `launch.folder` as that
    repository's folder.

- **What you see**, top to bottom on the `canvas` background, 18px padding, cards with 10px
  radius and a 1px `border`:
  - A header over a 1px `border` line: "Alp" (18px semibold), then the views as underlined
    tabs (12.5px, an `accent` underline on the shown one): Overview, Board and Herds (the open
    Today count is on Basecamp's Today tab). On the right, "Updated 3h ago · Refresh" as
    one button (`warning` once the data is over 2 hours old), a "Settings" button ("Settings · 2
    unsaved" in `warning` while Settings holds unsaved edits; tooltip "Alp settings"), and "Back
    to terminals" while Alp is pinned in their place. On Herds, Refresh reads the sessions again.
  - The Settings button shows Settings in place of the view: the header becomes "← Back to
    Overview" (or the view it came from) and "Alp settings". Its edits stay while Alp is open;
    after a Save, Back fetches again. `props.tab: "settings"` still opens a copy that shows only
    Settings, under a gear and "Alp settings", and fetches nothing from GitHub but the form's
    choices. Each other copy remembers its view and workspace in localStorage; `props.tab` and
    `props.workspace` open a copy on a given one
    (`tab.new {mod: "alpmeister", props: {tab: "dashboard", workspace: "Team"}}`, `"overview"`
    works too, `""` for All repos; the old `"today"`, and a copy that last showed the Today
    view, opens the Overview). `props.demo: true` fills every view with made-up data
    (`props.firstRun` too: a first run; `props.herdsView` and `props.herdsFull` open Herds on a
    view), for demos and screenshots.
  - **Overview**: on top, "Workspace: <name> ▾", a dropdown of All repos (first) and every
    workspace, each row with a dim line saying what it covers ("repo … · board …"); nothing beside the dropdown.
    A tile or card that opens GitHub has the GitHub mark (an icon button, no words) at the right
    end of its top-right icons, after its filter icon, with a tooltip saying where ("See all 7
    on GitHub", "See both on GitHub", "Open the run on GitHub"); a tile itself takes no click
    and shows no hover. Customer issues and Nightly have a gear ("Customer issues settings",
    "Nightly settings") before the mark, which opens Settings on the workspace with that
    section alone unfolded; it is also the way in when no customer label or nightly is set (the
    tile then says "No customer label" / "No nightly configured"). Order, left to right: filter,
    gear, GitHub. Every tile and card that lists a GitHub
    search (open bugs, triage bugs, customer issues, and your three lists)
    has a filter icon in its top-right corner, with a dot when its saved filter isn't the
    default and the filter in words as its tooltip; it opens the filter dialog (below).
  - **All repos**, top to bottom:
    - While there is no workspace, a card: "This is every repo you can reach.", "Add a
      workspace" (opens Settings) and "Not now", which hides it for good on this computer.
    - The Red checks tile (default branches failing, your PRs failing), then your lists (below),
      across every repository in scope (with `"all"`, everything the searches find): Waiting for
      your review, then Your open PRs | Your issues, two equal columns when the tab is at least
      1000px wide. Narrower, one column in that order.
    - The Repos card: every repository in scope, most recently pushed first, 12 rows then
      "Show N more", with a "With open work" toggle (remembered). A row: `owner/name` (dim without open
      work), then chips for private, archived, "local" (a folder is set), open issues, open PRs,
      the default branch's checks ("main passing", or `Needs you` style "main failing"), and
      "pushed 3d ago". A click opens the repository.
  - **A workspace**; the repository's cards show only with a `repo` (a board-only workspace says
    what adding one would show). Top to bottom: the tiles, the Milestone card | Waiting for your
    review, Team in flight (full width), then Your open PRs | Your issues; two equal columns when
    the tab is at least 1000px wide, else one column in the same order. A card the workspace has
    no part for is left out and its row's other card takes the width: without a board no Team in
    flight; with only a board no tiles and no Milestone card. The parts:
    - Four tiles, in one row when the tab is at least 1000px wide, else two by two: open bugs by
      priority (total, a strip and a chip per priority, counted from the priority issue field),
      triage bugs, open customer issues (any label whose name contains `customer.labelMatch`,
      named under the count), and the last nightly run (a failed one outlines its tile in `blocked`).
    - Your lists (below), narrowed to the workspace: review requests and your PRs in its
      repository, your issues in it or on its board. A workspace with only a board narrows to the
      repositories its board's items are in (and your issues on its board). Their counts are the
      narrowed rows, their GitHub links add `repo:` terms, and a row leaves out the repository's
      name when the workspace has one.
    - The nightly tile: "Success", "Failure" or "Running" for the last run, its local start date
      and time ("Tue 17 Nov, 06:05"), then one line per
      `nightly.checks` entry (deploy, unit, API and E2E tests) with an outcome chip. A check
      matches jobs by name, a step inside them, or every job except some.
    - The Milestone card: one milestone, picked in its header ("v2.4 · next ▾"): Next, which
      moves on by itself, any open milestone by due date (overdue ones in `blocked`, undated
      last), or No milestone. A milestone picked by hand outlines the card in `accent` and offers
      "Back to next (v2.4)"; each workspace keeps its pick, and one that closes goes back to
      Next. The header ends in the GitHub mark (the milestone's page, or the open issues
      without a milestone). Then:
      - The progress band, two bars each with a small dim title over its left end. "Progress":
        a usage-limits style bar of the share closed (its fill blends from `warning` at none
        closed to `done` at all, by the share closed), with today's tick on the time from the start (the previous milestone's due date, else its
        creation) to the due date, and the due date and days left over its right end; its
        tooltip has the counts and dates. "By status": a strip of board-status segments with a
        chip per status (Open and Closed with no board).
      - "Issues": its open issues with a priority value, a `spotlight.labels` label or a
        `spotlight.featureTypes` type, most urgent first, then by feature type. Each row shows
        its issue type beside the number, then an epic's "X of Y" sub-issues, its status, and
        its assignee or an Unassigned flag (no priority or label chip). 8 rows, then "Show N more".
      - The issues in `spotlight.holdStatus`, under that status's name; left out when there
        are none or no board.
  - With a board, Team in flight (full width, between the Milestone row and your PRs and
    issues): the board's open issues in the configured statuses, grouped in
    board order, the longest in their status first, 5 rows per group with "Show N more". Its
    filter (`inFlight.filter`, the Board's syntax, default `milestone:@next`) narrows them on
    what is loaded: `milestone:@next` (the open milestone due soonest; with none known, every
    milestone), `milestone:v2.4,v2.5`, `no:milestone`, `assignee:lena-k,tobi-s`, `no:assignee`,
    each negatable with "-"; other terms are kept and ignored. The header says it in words
    ("next milestone · v2.4") and ends in the filter icon: the dialog's Milestone chips (Next
    milestone, each open milestone, No milestone, Any milestone) and People chips (whoever has
    an issue in flight, Unassigned). Settings › Card filters lists it for every workspace with
    a board.
    Chips for assignee (or Unassigned), milestone, days in status and each linked PR's review
    state. An item from another repository than the workspace's names it in a chip.
  - **Board**: a workspace's board items that match its filter (`boardView.query`, the board's
    own filter syntax, default `iteration:@current`) and its ticked statuses
    (`boardView.statuses`, the Show on board ticks in Settings), up to 500. The Workspace
    dropdown lists the workspaces with a board; with none, an "Add a board" button opens the
    board picker in Settings.
    - On the header, the filter in words ("Filter: current iteration · 5 columns") opens the
      filter dialog with chips for Type, Columns and People and the board filter itself, with a
      count of the cards it shows. "Save for this board" writes `boardView.query` and
      `boardView.statuses`; a filter GitHub refuses shows its error in the dialog, unsaved, and
      the last good board stays. People (each assignee's avatar with their item count, then
      Unassigned) are kept in localStorage only; the same people show as an avatar row above
      the columns (avatars only; the count is in the tooltip), where a click picks or unpicks one (and "Everyone" clears them). "Choose columns ▾" opens the same dialog; a
      board the filter empties says "Nothing matches." with Clear filters.
    - The columns are the ticked statuses, each shown even when empty; with none ticked, the
      statuses that hold an item.
    - A card holds the number, the issue type, the session icon, Pin, the Claude button, the
      title, the linked PRs' review state (a PR's own decision), its iteration ("Sprint 24",
      left out when the filter already asks for that iteration), the milestone, and the
      assignees' avatars. The iteration and milestone chips and menu rows carry GitHub's
      Octicons (`iteration.svg`, `milestone.svg`, MIT). Long chips end in an ellipsis before the
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
    - A ⋯ on each card (shown on hover or focus), or a right click, opens the card's menu: Move
      to (the columns), Iteration and Milestone, each with the card's current value and a
      chevron. Pointing at one or clicking it opens its menu beside it, level with its row.
      Iteration lists No iteration, the last three completed iterations and every open one (the
      current one noted). Milestone lists No milestone and the repository's open milestones,
      soonest due first (read on the first open). The card's own are ticked. The menu works from
      the keyboard (Tab, Enter, Space or →, ←, Esc back to the ⋯).
    - A move shows at once and the card dims while GitHub writes it; then a toast "Moved #61 to
      In Review on GitHub · Undo", floating at the board's bottom left for 10 s, whose Undo writes the old status (and place, after a drag)
      back. A refused write puts the card back and shows the error over the columns. The
      board's ids come with its load, so a Board drawn from an older cache asks for a Refresh
      first.
  - **Your lists**, on the Overview (above), the same three cards on All repos and narrowed on a
    workspace:
    - Waiting for your review (author, review decision, age, checks, Pin, Review), then Your
      open PRs: your open, non-draft PRs (`queries.myPrs`) with the review decision, checks and
      age (Pin, Review).
    - Your issues grouped by status (Pin, Start). An issue's
      status comes from the first of its boards that a workspace is on, read with that
      workspace's status field; the groups follow the workspaces' status order, and an issue is
      hidden when its status is in its workspace's `mineHidden`. Issues on no workspace's board
      go under "No status".
    - Every row names its repository in a chip after the number. Each card has a GitHub mark
      ("Open the list on GitHub") and a filter icon.
    - The pin is "Pin to Today" (lit in `accent`, "Unpin from Today", once the item is on the
      Today list in Basecamp's Today tab). The Claude button is the Claude mark, faded at rest;
      with no prompt set it is a dashed outline whose click opens Settings in place. Icon
      buttons stay 22px icons on hover and Tab focus; a button's word ("Review", "Start",
      "Pin", "Unpin", "Set prompt") leads its tooltip ("Review: Open a Claude tab running …").
  - **The filter dialog**: one editor for every card's filter, a Herdr dialog over the dimmed
    window (a copy of the mod opened with `props.part: "filter"`): "Filter: <card>", chip groups,
    the GitHub search, a live "Shows 3 issues · now 0" count, and Reset to default, Cancel and
    "Save for this card", which writes only that card's settings key. Cancel, Esc or a click
    outside drop the edit; the card only ever shows the saved filter.
  - **Settings** (in place of the view, or the settings copy): the settings file as a form. A
    side list picks the page and only the page scrolls: **You** (GitHub, Local folders, Claude
    buttons, Card filters, Files), then "Workspace: <name>" per workspace and "+ Add
    workspace", with "Reload choices" (reads GitHub and your disk again) at its foot. A save bar
    stays at the bottom: "2 unsaved changes" in `warning`, Revert, Save. A save sets
    `shared("alp.settingsStamp")`, and every other copy fetches again. Nothing is written until
    Save, which writes over the version it read (or refuses, when the file changed on disk:
    Revert loads it) and keeps the previous file as `alpmeister.json.bak`.
    - GitHub: All my repos (with Include archived) or Only the ones I pick, then a checklist of
      your repositories (30px rows, scrolling after 12): the checkbox puts one in or out of
      scope, badges for private, archived and fork.
    - Local folders: each repository's folder with Folder… (the system folder picker) and ×.
      Clones found on disk (an `origin` on github.com, under `~/projects`, `~/code`, `~/src` and
      the like, 4 levels deep) are offered with "Use ~/path", or all at once.
    - Claude buttons: the issue and PR prompts.
    - Card filters: every card's filter in one list (Waiting for your review, Your open PRs and
      Your issues under "Your GitHub", then each workspace's Open bugs, Triage bugs and Open
      PRs), each with Edit,
      which opens the filter dialog; its Save writes at once and the save bar stays in step.
    - Files: auto save, Off, After a delay (with the delay) or When you leave the file.
    - A workspace: Name, Repository and Project board (dropdowns: your repositories; the boards
      linked to the repository, then every open board on your account and organizations), then
      folds, each with a line saying what it is set to: Board columns (the Status and Iteration
      fields and a row per status, from the board in board order: Means In flight / Other
      and Show on board; "More per-status options…" adds hidden from Your issues and on
      hold), Nightly (the workflow, from the repository's workflows, its branch and the runs
      that count; its checks read only, edited in the file), Bugs and triage, Milestone issues
      and Customer issues. Picking a board takes its statuses and guesses their roles from their
      names. "Remove workspace" asks for a second click.
- **How it behaves:** a click on a row opens it on GitHub. Pin adds the row to the Today list
  (Basecamp's Today tab). A
  pinned issue or PR checks itself once it closes or merges; each refresh reads every pick's
  state, board status and review decision, checked or not, and keeps them on the item. A pick is
  keyed by `kind-owner/name#number`; one pinned before workspaces gets its repository from its
  URL. Review and Start open, when a prompt is set, a tab named `repo#12` running `claude` with
  the prompt, in the space you are in. The tab starts in the live folder of that space's first
  tab (its first pane's `cwd`) when it is the repository's folder or inside it, such as a
  worktree, else in that folder, else in the space's own.
  Basecamp's Today tab's Claude buttons do the same. It fetches when the tab opens, when it shows data
  over 2 hours old, and on Refresh.
  - **Herds**: the Claude Code sessions on this machine and the links between them, one view at
    a time behind a Map | Cards switch (Cards in a tab, the Map in full tab, each choice
    remembered). One toolbar for both: a red "N need you" pill (a click outlines those cards and
    scrolls the Map to the first), "N working" and sessions pills (tooltip "N agents working"),
    the switch, then on the Map Fit, a zoom menu, Lines ▾ (Curved or Square corners) and Reset
    layout, and last full tab. A key row under it explains the marks, with Hide key. With no
    herds, Cards alone and no Map controls.
    - One session card in both views, 210×54 at 100%: a 3px stripe down the left edge in the
      space's color; the status mark (a spinner while working, a dot when done), the name, then
      `Needs you` or "idle", a "bg" tag for a background session and the crook for a herdsman;
      below, the space and the branch (Herdr's `workspace-chrome/branch.svg`; the pane's live
      `branch`). Hovering a session lights it wherever it shows. A click opens its tab.
    - The Map: each herd as a tree you can pan, zoom and rearrange, like a flow editor. Its
      herdsman (the session that made the most links) on top, with painted lines down to the
      sessions it is linked to, solid and labelled `msg 14:27` (the latest message) or dotted
      and labelled `worktree` (dotted means a worktree only), and to the agents it started;
      herds side by side. Under them a labelled "Grazing · N" lane holds the sessions on their
      own, wrapped to the map's width. Drag the background or scroll to pan, Cmd- or Ctrl-scroll
      to zoom (30%–200%), drag a card to move it and everything under it (they stay where you
      put them). Fit sizes to the herds and stops at 80%; past that the map scrolls. Who and
      when only: never message text.
    - Cards: Needs you, then each herd (lead, an arrow, its members), then Grazing; the
      sessions with no tab fold into "Background, no tab · N".
    - Role marks: Alp's own 24px line icons at 14px, with their meaning on hover: the
      herdsman's crook (`crook.svg`, `accent`), a cow for a member or grazing session
      (`cow.svg`), a lamb for a fork agent (`lamb.svg`), a herding dog for any other agent
      (`dog.svg`), all in `muted` but the crook.
    - Agents: a session that started agents (`<session>/subagents/agent-<id>.meta.json`) is the
      herdsman of a herd with them, even with no link to another session. Each agent is a
      180×54 box under it, labelled with its type on the line: its mark and what it is for
      ("bg" while it runs in the background), then how long it has run, or when it finished.
      Tooltip: fork or type, background or foreground, model, start time. A click opens the
      session's tab. A member session's own agents sit under its card. An agent with
      `spawnDepth` 2 or more sits under the agent whose transcript holds its `toolUseId`, a step
      in, as deep as they go. Agents finished more than 30 minutes ago fold into a "+ N finished
      earlier" button under the herd.
    - A background session that no tab shows has a "Link a tab" button ("Unlink tab" once
      linked); the picker opens below its card.
- **Built from:** `config.js` (settings, defaults, the one-repo upgrade), `queries.js` (the
  GraphQL documents: `ACCOUNT` for the repositories and @me searches, `WORKSPACE_REPO` and
  `WORKSPACE_BOARD` per workspace, the board through `repositoryOwner(login:) … on
  ProjectV2Owner` so user boards work, `DISCOVER`, `REPO_BOARDS` and `BOARD_FIELD_LIST` for
  Settings), `data.js` (`gh api graphql`, `gh api` for workflow runs and jobs; the account and
  each workspace load apart, each failing on its own; the cache carries `version: 3`),
  `focus.js` (the focus file, written with `writeTextFile` over the last read version),
  `account.js` (All repos), `project.js` (a workspace's tiles), `spotlight.js` (the Milestone
  card and its dropdown), `in-flight.js`, `my-day.js` (your three lists, and their narrowing to a
  workspace), `search-terms.js` (a GitHub search read as terms, for the card filters),
  `filter-dialog.js` (the filter dialog), `board-view.js`, `board-state.js`, `board-menu.js`,
  `board-actions.js` (the Board's writes) and `board-terms.js` (the board filter read as terms),
  `avatars.js`, `settings-data.js` (discovery, clones, save), `settings-view.js` (the form),
  `demo-data.js` (the demo's settings, GitHub data and pins), `ui.js`, and `main.js`.
  Herds:
  `herds-data.js` reads Claude Code's files (it never writes them): `~/.claude/sessions/*.json`
  (live sessions, kept when `ps` finds their pid), `~/.claude/jobs/<id>/state.json` (a
  background session's state), and each live session's transcript
  `~/.claude/projects/*/<session>.jsonl`, where `grep` picks the main conversation's
  `SendMessage` calls (`input.to`, a session name) and `git worktree add` commands (the folder,
  matched to a session's `cwd`); a tool call can appear twice, so they are deduped by id. A
  session's tab is the Herdr terminal whose foreground pid (`hc get <t> --json`) is the
  session's pid; a background session's is the Claude tab titled with its name, else the one
  picked with Link a tab (`~/.local/state/alp/herds.json`). The branch is the pane's live
  `branch`, else `git branch --show-current` in the session's folder. `herds-view.js` draws the
  toolbar, the session card and Cards; `herds-canvas.js` the Map (painted paths, pan, zoom, the
  cards you moved, kept in localStorage);
  `watchFolder(~/.claude/sessions)` reloads it, and so does each live session's `subagents`
  folder, with a 3-second pause (`cx.timer.after`) after each change, as agents write often. The
  agents are read in one `sh` call: per agent its meta file, the first `timestamp` in the first
  lines of its transcript (the first line is a header with none), the transcript's mtime
  (`stat -c %Y`, or `stat -f %m` on macOS), and for a nested agent the sibling transcript that
  holds its `toolUseId` (`grep -l -F`). `demo-herds.js` is the demo's herd, in `loadHerds()`'s
  shape plus `demo: { agents, spaces, colors }`, which the Herds tab draws with in place of
  `agents()`, `spaces()` and `shared("space.colors")`; in demo mode nothing is watched and a
  click on a card opens nothing.
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
- **Done when:** `herdr-app check` passes, the Milestone card's closed count, triage count, team
  PR count and in-flight groups match the same queries run with `gh`, and with no settings file
  the Overview lists your repositories.

## Done when

- `herdr-app check` passes for `mods/usage-limits` and `mods/pane-agent`, and `herdr-app do layout.switch '{"name":"alp"}'` returns ok with no errors in `herdr-app status`.
- A new Claude Code session in a Herdr terminal shows its model, effort and context chips in the pane header within 3 seconds of its first answer, and `~/.local/state/herdr-agents/<terminal>.json` holds `"agent":"claude"`.
- Changing the file's `agent` to anything else hides the chips within 3 seconds.
- The sidebar shows Session and Weekly percentages and reset times matching `limits.json`, and folding the sidebar shows the rail cell with the same space above and below it as the unfolded rows (the `limits` block at 82px), back to 96px when unfolded.
- Exiting Claude empties the terminal's file and its chips disappear.

## Basecamp

- **What:** the one right dock, on the window's right edge beside the terminals as the left
  sidebar is: Files, Changes, Today and Run. The Basecamp button in the tab bar shows or hides it
  (drawn by `alp-tabs`, above).
- **Where:** the `basecamp` column, the root row's last child: a `basecamp-header` block (42px,
  drags the window) showing `mods/basecamp/`, over the `basecamp-body` stack of `files`
  (`alp-files`, 8px padding), `changes` (the shipped `changes`, 8px padding), `basecamp-daypack`
  (`daypack`) and `basecamp-run` (`alp-runs` with `props: { part: "list" }`).
- **Header:** the tab strip: Files (`files.svg`), Changes (`changes.svg`, then the changed-file
  count in `accent`), Today (the backpack, then the open Today count in `accent`) and Run
  (`mods/alp-runs/play.svg`, then the running count in `working`), `selected` on the stack's
  active child; a click runs `layout.select`. Files and Changes show when
  `shared("workspace.panels")` has them. The icons go when the strip is too narrow for them
  (measured from a hidden copy). A close button ("Hide Basecamp") runs `layout.hide`.

## Today

- **What:** the `daypack` mod, Basecamp's Today tab (the one the dock opens on first). It holds
  the Today list, and is the only place it shows: the issues and PRs pinned in Alp ("Pin to
  Today") and the todos typed here. Alp has no Today view any more.
- **How it looks**, top to bottom on `chrome`:
  - "Today" and "5 open · 2 done" (11.5px, `dim`); "Key" on the right while the key is hidden.
  - The key, in a bordered box: the Claude mark ("Review a PR or Start an issue in Claude"), the
    lit pin ("Pinned from Alp: click to unpin") and, while a prompt is missing, the dashed mark
    with "no prompt yet · set it in Settings" (the gear), which shows the pinned Alp and asks it
    to open Settings in place (`shared("alp.openSettings")`). "Hide key" at its end; remembered.
  - "Add a todo and press Enter": Enter adds a todo, dated today. While the list shows one
    repository, the todo gets that `repo`, so it stays in view.
  - "All repos ▾", a dropdown of All repos, each repository on the list (short name, `owner/name`
    under it) and Todos ("without a repo"), each with its open count; and "Group by repo", a
    dot toggle. Both remembered in the tab's localStorage (`daypack.repoFilter`,
    `daypack.groupByRepo`).
  - The items: in sections by kind (Todos, PRs, Issues), or, grouped, the todos without a
    repository under "Todos", then a heading per repository (its short name, `owner/name` as the
    tooltip), each headed by its open count. Empty: "Nothing for today yet." and "Type a todo
    above, or pin an issue or PR in Alp."; a filter with nothing: "Nothing for website yet.".
  - A row: the checkbox (✓ when done, the title struck through), the title (a click opens an
    issue or PR on GitHub; a double-click edits a todo: Enter or a click away saves, Esc
    cancels), the number (`repo#12`, or `#12` while grouped or filtered), a PR's standing
    (Merged or Closed, else Approved, Changes, In Review, as of Alp's last refresh), days since
    it was added (from the next day), the session icon; then for an issue or PR the lit pin
    ("Unpin from Today") and the Claude button, for a todo Edit and Remove.
  - The Claude button opens a Claude tab running the prompt from Alp's settings
    (`account.launch`, or `launch` in the one-repo shape) in the item's repository folder
    (`account.folders`), as Alp's Start and Review buttons do. Icon buttons stay 22px icons on
    hover and focus; the word ("Review", "Start", "Set prompt") leads the tooltip. With no prompt
    set it shows a dashed mark, and a click opens Alp's Settings as the key's link does.
  - A middle click on any Claude button opens the tab in the background (`tab.new` with
    `focus: false`), and a Herdr notification names it; a click on the notification shows the
    tab. A left click opens it and shows it.
  - Before the pin, the session icon shows while the item's Claude tab is open. A click shows
    that tab.
- **State:**
  - It reads and writes `~/.local/state/alp/focus.json`, the file Alp keeps. Mods cannot
    import across folders, so `focus-file.js` is its own reader and writer of that format. A
    write goes over the version it read; if the file changed meanwhile, it reloads and makes the
    change again.
  - Each side sets `shared("alp.focusStamp")` after a write, and the other reloads the file;
    Basecamp's Today count and the tab bar's Basecamp button count it again.

## Runs

- **What:** one mod, `mods/alp-runs/`, drawn by `props().part`: `list` (Basecamp's Run tab),
  `bar`, `sessions` and `empty` (the runs panel), and `input`, `save`, `menu` (overlays).
- **Workspace:** the first of the focused terminal's folder, the active tab's terminals', the
  space's other terminals' and the space's folder that is in a git repo. `git rev-parse
  --path-format=absolute --show-toplevel --git-common-dir` gives its root and, for a worktree,
  the main checkout.
- **Config:** `alp-config.js` reads `~/.config/alp/alp.json` (you), `<root>/.herdr/alp.json`
  (repo) and `<mainRoot>/.herdr/alp.local.json` (local) and deep-merges them in that order:
  objects key by key, anything else replaced, `null` removes. `jsonc.js` parses JSONC and edits it
  in place (`editJsonc(text, path, value)` sets or removes one key and keeps comments, formatting
  and order). Writing the local file adds `.herdr/alp.local.json` to the repo's `info/exclude`. A
  new repo file starts with a comment and `$schema` (`schema/alp.schema.json`).
- **Entries:** `config.js` turns each of the merged `runs` into an entry (`run:<name>`, kind `run`
  or `compound` for a `runs` group), applying the platform's `macos`/`linux`/`windows` block, with
  its origin (the latest file that defines it). Listed in the repo file's order, then local, then
  yours. `${workspaceFolder}`, `${env:X}`, `${userHome}` and `${input:id}` resolve; `${file}`-like
  variables, `${command:}` and `${config:}` mark the run as not runnable, with the reason. The
  first load moves `~/.config/alp/commands.json` into the config and renames it `.bak`.
- **Import:** `vscode.js` converts `.vscode/launch.json` (node, node-terminal and python configs,
  compounds) and `tasks.json` (shell, process and npm tasks, their platform blocks as the run's)
  into runs, or gives the reason one can't be (attach, browser and other debuggers, extension
  tasks, `command` inputs, editor variables, a name used twice). The `import` dialog
  (`import-view.js`) lists them with checkboxes, ticks dependencies along, and writes the picked
  runs and the inputs they use to the repo or local file.
- **Run tab:** a filter, + (add a run) and reload, the workspace name with an Output button
  (lit while the runs panel shows; it shows or hides it), then a heading per `section`, in the
  config's own case (Launch, Tasks and Runs first). A row: the session mark (`●` `working`, `✓`
  `done`, `✗` `blocked`), the name, *just me* or *me everywhere* in `dim` for runs from your
  local or your own file, and a play button (a spinner while starting); while it runs, "running"
  in `working` and a red stop square in place of play (Ctrl-C, then terminate on a second press
  within 4 s). A click on a row with a session selects it. Runs that can't run fold under "N
  can't run here", hidden ones under "N hidden". With no runs: where runs live, Import from VS
  Code… (when `.vscode` has configs) and Add a run…; with runs, Import from VS Code… ends the
  list. A ⋯ on each row (shown on hover or keyboard focus; Enter or Space opens it) and a
  right-click open the menu: Edit…, Hide for me (or Show again), and Delete from <file> (the
  full file, in `blocked`). The `save` form
  has name, command, folder and Save to (This repo, Just me here, Me everywhere). The list
  re-reads on changes in `<root>/.herdr` and on `shared("alp.runs.stamp")`, which every write sets.
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
  "empty"`: "No run selected" or "Nothing has run yet") and `runs-sessions` (220px, `part:
  "sessions"`, the Runs list: every run, running, exited 0 or failed). The selection is
  `shared("alp.runs.selected")`; `panel.js` rewrites `run-output` with `layout.set`, because
  Herdr drops a terminal block when its terminal ends. The bar shows the mark, the entry, the
  terminal name, stop (SIGINT to the foreground process group; a second press within 4 s sends
  TERM), restart (with the answers it started with, `shared("alp.runs.started")`) and hide.
- **Status bar:** `mods/alp-status/`, cloned from `workspace-status` (0.1.16), adds the Runs button
  (`mods/alp-runs/terminal.svg` and the running count) after the commands hint, that runs
  `layout.toggle {id: "bottom-panel"}`, as the Run tab's Output button does ("Show the runs'
  output" on both).
- **Agents:** the plugin's `alp-runs` skill: `hc ls --label alp.workspace=<root>` and `hc read
  <name>`.

## Files

- **What:** Basecamp's Files tab, the folder's tree, and a minimal editor. A click on a file
  opens it in Herdr's own `Editor` (syntect highlighting, line numbers, folding) in an editor
  pane split right of the focused pane; the Files tab stays the tree. Local files are editable.
- **Where:** `mods/alp-files/`, cloned from the shipped `files`; the `files` block in the dock's
  `basecamp-body` shows the tree (`main.js`), and `pane.split {mod: "alp-files", props: {file, on,
  root, tab}}` opens the editor pane (`editor.js`). When Alp shows in place of the terminals,
  the terminals come back first.
- **Editor pane:** a second file reuses the tab's editor pane (a shared request it picks up): a
  clean document is replaced, one with unsaved edits stays as a chip (name, `warning` `●`, ✕)
  above the editor. The pane's quiet top line: the file name, the folder · branch in `dim`, a
  `warning` "● Unsaved", Save (Ctrl+S) and ✕. ✕ with unsaved edits asks first: "cart.ts has
  unsaved edits." Save / Discard / Keep editing; a chip's ✕ asks the same. A failed save or open
  says why in a box outlined in `blocked`. While the editor pane is focused the tree follows the
  tab's terminal, highlights the open file and marks unsaved ones with a `warning` `●`.
- **Saving:** `ctrl-s` (an `on_key_down` around the editor, `cmd-s` in GPUI's spelling) or Save
  runs `writeTextFile(path, text, base)`, which refuses when the file changed since it was read.
- **Auto save**, as VS Code's `files.autoSave`, set on Alp's Settings › Files page (`files` in
  `~/.config/alp/alpmeister.json`, read again on `shared("alp.settingsStamp")`): Off (default),
  After a delay (default 1000 ms, restarted by each edit) or When you leave the file. It goes
  through the same save. With it on, the top line says a quiet "Saving…", "Unsaved" or "Saved",
  and chips and the tree mark such files with a `dim` dot.
- **Following the disk:** on each refresh (the folder watch, or every 10 s) the open file is read
  again: a clean document takes the new text. An edited one gets a box over the editor: "cart.ts
  changed on disk while you were editing it." with Keep my edits (the next Save overwrites the
  disk's text knowingly), Use the file on disk and Compare (a read-only line diff, − on disk, +
  my edits, drawn like the Changes tab). Deleted on disk: Keep my edits (Save writes it anew)
  and Close it.
- **Read-only:** files on another machine (`writeTextFile` writes here only) and files over
  400,000 characters (shown cut off).
- **Highlighting:** syntect's default grammars, by extension. Missing ones map to the closest
  (TypeScript → JavaScript, TOML → YAML, Vue/Svelte → HTML), and files without an extension go
  by name (`Makefile`, `Dockerfile`, `.bashrc`, `.env`, …). Colors are Dracula's roles from the
  theme's ANSI colors: keywords and operators `ansi5`, strings `ansi3`, functions `ansi2`, types
  `ansi6`, numbers and constants `ansi4`, comments `dim`.
