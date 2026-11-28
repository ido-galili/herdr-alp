#!/usr/bin/env bash
# Installs a herdr-alp release into Herdr's home, for Alp's Settings > Updates. Alpmeister starts
# it detached: installing replaces every mod, Alpmeister too, so Herdr reloads it mid-update.
# The reloaded page reads the outcome from ~/.config/alp/update-result.json.
#   alp-update.sh <tag> <Herdr's home>
# Your clone is never used: the release's own source is downloaded and its sync.sh installs it.
set -uo pipefail
tag=$1
export HERDR_APP_HOME=$2
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "alp-update: not a release tag: $tag" >&2; exit 2; }
alp="$HOME/.config/alp"
mkdir -p "$alp"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

{
  echo "Updating to $tag"
  gh release download "$tag" --repo ido-galili/herdr-alp --archive tar.gz --dir "$work" &&
    tar -xzf "$work"/*.tar.gz -C "$work" &&
    src=$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n 1) &&
    [[ -n "$src" ]] &&
    bash "$src/sync.sh" install
} >"$alp/update.log" 2>&1
status=$?

ok=false
[[ $status -eq 0 ]] && ok=true
printf '{"tag": "%s", "ok": %s, "at": "%s"}\n' "$tag" "$ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$alp/update-result.json.tmp"
mv "$alp/update-result.json.tmp" "$alp/update-result.json"
