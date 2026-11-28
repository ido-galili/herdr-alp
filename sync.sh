#!/usr/bin/env bash
# Copy this repo's layout, theme and mods into Herdr's home, or pull live edits back.
#   ./sync.sh install   repo -> ~/.config/herdr-app (Herdr hot-reloads)
#   ./sync.sh pull      ~/.config/herdr-app -> repo (after editing in place)
#
# install also records what it installed, for Alp's Settings > Updates:
#   ~/.config/alp/installed.json     the version, and where it came from (a clone or a release)
#   ~/.config/alp/installed.sha256   a hash of every file it copied, to spot edits made in place
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
alp="$HOME/.config/alp"
mods=(alp-chrome usage-limits alp-spaces pane-agent alp-files alpmeister daypack alp-agents alp-tabs basecamp alp-runs alp-status)
# Mods an earlier version installed and this one doesn't: install removes them.
retired=()
layouts=(alp)
themes=(alp)
case "${1:-}" in
  install) src="$repo" dst="$home" ;;
  pull)    src="$home" dst="$repo" ;;
  *) echo "usage: $0 install|pull" >&2; exit 2 ;;
esac
mkdir -p "$dst/layouts" "$dst/mods" "$dst/themes"
for l in "${layouts[@]}"; do cp "$src/layouts/$l.json" "$dst/layouts/$l.json"; done
for t in "${themes[@]}"; do cp "$src/themes/$t.json" "$dst/themes/$t.json"; done
for m in "${mods[@]}"; do
  rsync -a --delete --exclude gpui-kit.d.ts --exclude '*.bak' --exclude '*.error' "$src/mods/$m/" "$dst/mods/$m/"
done
echo "synced ${layouts[*]} + themes ${themes[*]} + ${mods[*]}: $src -> $dst"
[[ "$1" == install ]] || exit 0

for m in ${retired[@]+"${retired[@]}"}; do
  if [[ -d "$dst/mods/$m" ]]; then rm -rf "${dst:?}/mods/$m"; echo "removed retired mod $m"; fi
done

# A JSON string, with its quotes.
json() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '"%s"' "$s"; }

# The version is plugin.json's: the release workflow sets it on every release, so a release's
# files carry their own number. A clone also says how far it is from that release.
version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$repo/plugins/alp/.claude-plugin/plugin.json" | head -n 1)
if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  from=$(json "$repo")
  describe=$(json "$(git -C "$repo" describe --tags --always --dirty 2>/dev/null || true)")
  branch=$(json "$(git -C "$repo" branch --show-current 2>/dev/null || true)")
  commit=$(json "$(git -C "$repo" rev-parse HEAD)")
else
  # A release's source archive has no .git.
  from='"release"' describe=null branch=null commit=null
fi
mkdir -p "$alp"
cat > "$alp/installed.json.tmp" <<EOF
{
  "version": $(json "${version:-unknown}"),
  "from": $from,
  "describe": $describe,
  "branch": $branch,
  "commit": $commit,
  "installedAt": $(json "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
}
EOF
mv "$alp/installed.json.tmp" "$alp/installed.json"

# Hashes of what was copied, as paths under Herdr's home. Herdr rewrites jsconfig.json itself.
if command -v sha256sum >/dev/null; then sum=(sha256sum); else sum=(shasum -a 256); fi
(
  cd "$dst"
  {
    for l in "${layouts[@]}"; do echo "layouts/$l.json"; done
    for t in "${themes[@]}"; do echo "themes/$t.json"; done
    for m in "${mods[@]}"; do
      (cd "$src" && find "mods/$m" -type f ! -name gpui-kit.d.ts ! -name '*.bak' ! -name '*.error' ! -name jsconfig.json)
    done
  } | LC_ALL=C sort | while IFS= read -r file; do "${sum[@]}" "$file"; done
) > "$alp/installed.sha256.tmp"
mv "$alp/installed.sha256.tmp" "$alp/installed.sha256"
echo "recorded v${version:-unknown} in $alp/installed.json"
