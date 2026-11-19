#!/usr/bin/env bash
# Sets Alp up on this machine, asking as it goes:
#   1. checks gh: installed, signed in, with the read:project scope the board needs
#   2. builds your Alpmeister settings (~/.config/alp/alpmeister.json) by asking, with
#      defaults from your current settings or from what gh finds on GitHub
#   3. copies the layout and mods into Herdr (sync.sh install)
#   4. installs the alp Claude Code plugin
#   5. switches Herdr to the alp layout and opens the Alpmeister tab
#
#   ./setup.sh [PROJECT_FOLDER]     PROJECT_FOLDER: your project's local clone (default: here)
#   ./setup.sh --settings-only      step 1 and 2 only
#
# Run it again any time to change your settings: each question starts from your current answer.
# ALP_SETTINGS=path writes the settings elsewhere, for trying it out.
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
settings="${ALP_SETTINGS:-$HOME/.config/alp/alpmeister.json}"
settings_only=false
start="$PWD"
for arg in "$@"; do
  case "$arg" in
    --settings-only) settings_only=true ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) start="$arg" ;;
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
command -v python3 >/dev/null || fail "needs python3: xcode-select --install"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in: gh auth login, then ./setup.sh again"
if gh auth status 2>&1 | grep -qE "'(read:)?project'"; then
  echo "gh is signed in, with access to project boards."
else
  echo "gh's token lacks the read:project scope Alpmeister needs to read the project board."
  if confirm "Add it now (opens the browser)?"; then gh auth refresh -s read:project; fi
fi

# 2. Settings
say "2. Your Alpmeister settings"
python3 -I "$repo/setup/settings.py" "$settings" "$start"
$settings_only && exit 0

# 3. Layout and mods
say "3. Layout and mods"
"$repo/sync.sh" install

# 4. Claude Code plugin
say "4. Claude Code plugin"
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

# 5. Herdr
say "5. Herdr"
if ! command -v herdr-app >/dev/null || ! herdr-app status >/dev/null 2>&1; then
  echo "Herdr is not open. Later: herdr-app do layout.switch '{\"name\":\"alp\"}'"
elif confirm "Switch Herdr to the alp layout and open the Alpmeister tab?"; then
  herdr-app do layout.switch '{"name":"alp"}' >/dev/null
  if herdr-app ls 2>/dev/null | grep -q '"name": "Alpmeister"'; then
    echo "The Alpmeister tab is already open."
  else
    herdr-app do tab.new '{"mod":"alpmeister","name":"Alpmeister"}' >/dev/null
  fi
fi

say "Done."
echo "Run ./setup.sh again any time to change your settings."
