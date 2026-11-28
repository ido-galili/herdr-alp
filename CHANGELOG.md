# Changelog

Every release of herdr-alp: the layout, theme and mods, and the `alp` Claude Code plugin, which
share one version. Made by git-cliff from the titles of merged pull requests.

## [0.6.0](https://github.com/ido-galili/herdr-alp/releases/tag/v0.6.0) - 2026-11-28

### Added

- **updates**: an Updates page in Settings, and releases with a changelog ([#45](https://github.com/ido-galili/herdr-alp/pull/45))
- **herds**: Map | Cards switch shows even with no herds ([#46](https://github.com/ido-galili/herdr-alp/pull/46))
- **board**: no Claude action on Board cards
- **board**: the ⋯ always shows and opens where pressed; Claude moves into the card menu
- **overview**: no scope line beside the workspace dropdown
- **overview**: Team in flight's own filter; Progress colored by the share closed
- **overview**: icon-only tiles, gears to settings, no "not started" role
- **overview**: simpler Milestone card, GitHub marks, avatar-only people row
- **milestone**: issue rows keep status and assignee; no "behind schedule"
- **overview**: tiles on top, Team in flight between the rows
- **alpmeister**: Overview rows and view tab icons
- **board**: the move toast floats at the bottom left, and the avatar row is back
- **alp-agents**: idle agents always fold, and an idle row shows just its time
- **today**: the Today list lives in the dock; your lists move to the Overview
- **alp**: the Daypack view is called Today
- **pane-header**: icon and status, then worktree and branch with icons
- **pane-header**: the worktree first, with its icon, never cut off
- **overview**: one Milestone card with a milestone dropdown
- **filters**: one filter dialog for every card
- **overview**: milestone switch, link icons and card filters on the Overview
- **files**: auto save after a delay or on leaving the file, set in Settings
- **basecamp**: one right dock with Files, Changes, Today and Run
- **sidebar**: usage time left, status in words, Needs you on top of By space
- **tabs**: a tab bar that says it in shapes and words, and fits
- **pane-header**: status after the name, one muted line, buttons on hover
- **runs**: a ⋯ menu, a stop square and Output in the Run tab
- **settings**: a page per part, a fixed save bar, Card filters, first run on Overview
- **board**: the Board filter on the card-filter pattern, Undo after a move, a ⋯ on each card
- **daypack**: a filter on each GitHub card, saved per card
- **daypack**: icons with a key, labels on hover or focus, dashed when no prompt
- **alp**: Alp header, workspace picker, tile links, Settings in place
- **herds**: one view with a Map | Cards switch, a grazing lane and one card
- **files**: open files in an editor pane beside the terminals
- **files**: ask whose version wins when the open file changes on disk
- **theme**: orange for warnings, a readable dim, no text under 11.5px
- **alp**: remove "Current iteration"; remember the toggles
- **names**: Alp, Overview, Today, and plain words across the mods
- **demo**: props.demo fills every tab with made-up data ([#21](https://github.com/ido-galili/herdr-alp/pull/21))
- **alp-tabs**: Alpmeister pinned before the space's tabs, shown in place of the terminals ([#20](https://github.com/ido-galili/herdr-alp/pull/20))
- **sidebar**: a cleaner folded rail ([#19](https://github.com/ido-galili/herdr-alp/pull/19))
- **herds**: dragging a card moves everything under it ([#18](https://github.com/ido-galili/herdr-alp/pull/18))
- **alp-tabs**: icon buttons in two groups, [Files Changes | Alpmeister Basecamp] ([#16](https://github.com/ido-galili/herdr-alp/pull/16))
- **alp-runs**: runs in Alp's own config, merged with yours, and an import from VS Code ([#17](https://github.com/ido-galili/herdr-alp/pull/17))
- **alp-files**: a minimal file editor in the Files panel ([#14](https://github.com/ido-galili/herdr-alp/pull/14))
- **herds**: a demo herd (props.demo), a new preview, and Fit at app zoom ([#12](https://github.com/ido-galili/herdr-alp/pull/12))
- **alpmeister**: background Claude tabs and a Board tab ([#11](https://github.com/ido-galili/herdr-alp/pull/11))
- **runs**: Basecamp, a Run tab and a runs panel for VS Code launch configs and tasks; Herds canvas only ([#9](https://github.com/ido-galili/herdr-alp/pull/9))
- **herds**: a canvas to pan, zoom and rearrange the herds ([#8](https://github.com/ido-galili/herdr-alp/pull/8))

### Fixed

- **board**: the move notice stays in view on a tall board
- **alp-tabs**: the tab menu lights the row under the pointer, and gets Put away
- **alp**: GitHub and Settings icons on the newer links
- stack leftovers
- **alpmeister, daypack**: a background tab's notification shows the tab ([#15](https://github.com/ido-galili/herdr-alp/pull/15))
- **daypack**: fix "label is not a function" on PR and issue rows ([#6](https://github.com/ido-galili/herdr-alp/pull/6))

### Changed

- **herds**: herds side by side in a row that scrolls sideways ([#7](https://github.com/ido-galili/herdr-alp/pull/7))


