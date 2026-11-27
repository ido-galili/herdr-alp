#!/usr/bin/env bash
# Sets Alp up on this machine, asking as it goes:
#   1. checks gh: installed, signed in, with the read:project scope project boards need
#   2. copies the layout and mods into Herdr (sync.sh install)
#   3. installs the alp Claude Code plugin
#   4. switches Herdr to the alp layout, where Alp opens on the Overview of all your
#      repositories, with a card that offers to add a workspace
#
#   ./setup.sh
#
# Alp works before any settings: its Settings button picks repositories, workspaces and prompts.
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup: unknown argument $arg (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { echo "setup: $*" >&2; exit 1; }
confirm() {
  local answer
  read -r -p "$1 [Y/n]: " answer || answer=""
  [[ -z "$answer" || "$answer" == [yY]* ]]
}

# 1. gh
say "1. GitHub CLI"
command -v gh >/dev/null || fail "needs the GitHub CLI: brew install gh, then gh auth login"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in: gh auth login, then ./setup.sh again"
if gh auth status 2>&1 | grep -qE "'(read:)?project'"; then
  echo "gh is signed in, with access to project boards."
else
  echo "gh's token lacks the read:project scope Alpmeister needs to read project boards."
  if confirm "Add it now (opens the browser)?"; then gh auth refresh -s read:project; fi
fi

# 2. Layout and mods
say "2. Layout and mods"
"$repo/sync.sh" install

# 3. Claude Code plugin
say "3. Claude Code plugin"
if ! command -v claude >/dev/null; then
  echo "Claude Code is not installed: skipping the alp plugin (see README, Install step 2)."
elif claude plugin list 2>/dev/null | grep -q "alp@"; then
  echo "The alp plugin is already installed."
elif confirm "Install the alp plugin, which feeds the usage limits and pane chips?"; then
  claude plugin marketplace list 2>/dev/null | grep -q "herdr-alp" ||
    claude plugin marketplace add ido-galili/herdr-alp
  claude plugin install alp@herdr-alp --scope user
  echo "Restart running Claude sessions to load it."
fi

# 4. Herdr
say "4. Herdr"
if ! command -v herdr-app >/dev/null || ! herdr-app status >/dev/null 2>&1; then
  echo "Herdr is not open. Later: herdr-app do layout.switch '{\"name\":\"alp\"}'"
elif confirm "Switch Herdr to the alp layout?"; then
  herdr-app do layout.switch '{"name":"alp"}' >/dev/null
  echo "Alp opens on the Overview of all your repositories: click its pinned tab, first in the tab bar."
fi

say "Done."
echo "Add a workspace, or change any setting, from the Settings button in Alp's header."
