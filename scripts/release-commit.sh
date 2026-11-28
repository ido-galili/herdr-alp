#!/usr/bin/env bash
# The release commit of a pull request whose title is a feat, fix, perf or refactor, or has a "!": it
# writes CHANGELOG.md and the plugin's version as they will be once the PR is squash-merged, so
# main gets them with the merge and nothing is pushed to main afterwards. The release workflow
# then tags that merge and publishes the GitHub Release.
#
#   scripts/release-commit.sh          commit them; run it after the PR is open and its title is
#                                      final, and again after rebasing, retitling or more work.
#                                      Each run adds a commit and never rewrites one, so a plain
#                                      git push does: only the squash merge's files count
#   scripts/release-commit.sh --check  the PR check: fail when CHANGELOG.md or the version isn't
#                                      what the PR's title makes them
#
# The PR's title and number come from PR_TITLE and PR_NUMBER, or from `gh pr view`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

check=false
[ "${1:-}" = "--check" ] && check=true
plugin=plugins/alp/.claude-plugin/plugin.json
base="origin/${BASE_REF:-main}"
cliff=(npx --no-install git-cliff)

fail() {
  echo "release-commit: $*" >&2
  exit 1
}

if [ -z "${PR_TITLE:-}" ] || [ -z "${PR_NUMBER:-}" ]; then
  line=$(gh pr view --json number,title -q '"\(.number) \(.title)"' 2>/dev/null) ||
    fail "open the pull request first: its number goes in the changelog."
  PR_NUMBER=${line%% *}
  PR_TITLE=${line#* }
fi
$check || git fetch -q origin "${BASE_REF:-main}" --tags

version_of() { sed -nE 's/.*"version": *"([^"]*)".*/\1/p' | head -1; }
set_version() {
  sed -E "s/(\"version\": *\")[^\"]*\"/\1$1\"/" "$plugin" > "$plugin.tmp" && mv "$plugin.tmp" "$plugin"
}
ready_to_write() {
  git merge-base --is-ancestor "$base" HEAD || fail "rebase on $base first: the changelog is made from it."
  [ -z "$(git status --porcelain)" ] || fail "commit or stash your changes first."
}
# Commits CHANGELOG.md and the plugin's version with message $1, unless they're already so.
commit_files() {
  git add -A CHANGELOG.md "$plugin"
  if git diff --cached --quiet; then
    echo "Already up to date: nothing to commit."
  else
    git commit -q -m "$1"
    echo "Committed \"$1\". Push it with: git push"
  fi
}
base_version=$(git show "$base:$plugin" | version_of)
head_version=$(version_of < "$plugin")

# A PR stacked on one whose release isn't tagged yet would get that same version.
if git show "$base:CHANGELOG.md" 2> /dev/null | grep -q "^## \[$base_version\]" &&
  ! git rev-parse -q --verify "refs/tags/v$base_version" > /dev/null; then
  fail "$base's release v$base_version isn't tagged yet: merge it, rebase on main and run this again."
fi

# The same rule as cliff.toml: feat, fix, perf and refactor are released, and so is any type with
# a "!". docs, test, ci and chore aren't, so they can't change what ships.
shipped=(mods layouts themes plugins sync.sh setup.sh)
if [[ ! "$PR_TITLE" =~ ^(feat|fix|perf|refactor)(\([^\)]*\))?!?: && ! "$PR_TITLE" =~ ^[a-z]+(\([^\)]*\))?!: ]]; then
  changed=$(git diff --name-only "$base" HEAD -- "${shipped[@]}" ":!plugins/alp/.claude-plugin/plugin.json")
  [ -z "$changed" ] ||
    fail "\"$PR_TITLE\" releases nothing, but it changes what ships: $(echo $changed). Every change to shipped code is a release: make the title a feat, fix, perf or refactor."
  if $check; then
    [ "$head_version" = "$base_version" ] && git diff --quiet "$base" HEAD -- CHANGELOG.md ||
      fail "\"$PR_TITLE\" releases nothing, so CHANGELOG.md and the plugin's version stay as they are on main. Run npm run release-commit and push, or make the title a feat, fix, perf or refactor."
    echo "\"$PR_TITLE\" releases nothing."
    exit 0
  fi
  echo "\"$PR_TITLE\" releases nothing."
  # An earlier release commit is undone by a new commit: main's CHANGELOG.md and version again.
  ready_to_write
  if git cat-file -e "$base:CHANGELOG.md" 2> /dev/null; then git show "$base:CHANGELOG.md" > CHANGELOG.md; else rm -f CHANGELOG.md; fi
  set_version "$base_version"
  commit_files "chore(release): nothing to release"
  exit 0
fi

# The squash merge, made ahead of time: main's tree with the PR's title as the message. Nothing
# points at it, so git drops it later.
root=$(git rev-list --max-parents=0 "$base" | tail -1)
squash=$(git -c user.name=release -c user.email=release@localhost commit-tree "$base^{tree}" -p "$base" \
  -m "$PR_TITLE (#$PR_NUMBER)")
version=$("${cliff[@]}" "$root..$squash" --bumped-version 2>/dev/null)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${cliff[@]}" "$root..$squash" --tag "$version" -o "$work/CHANGELOG.md" 2>/dev/null

if $check; then
  [ "$head_version" = "${version#v}" ] ||
    fail "the plugin's version is $head_version, and this PR releases $version. Run npm run release-commit and push."
  # The new version's date is the day the commit was made, so it isn't compared.
  undated() { sed -E "s/^(## \[${version#v}\]\(.*\)) - [0-9-]+$/\1/" "$1"; }
  diff <(undated CHANGELOG.md 2>/dev/null) <(undated "$work/CHANGELOG.md") > "$work/diff" ||
    { cat "$work/diff" >&2; fail "CHANGELOG.md isn't what this PR's title makes it. Run npm run release-commit and push."; }
  echo "The release commit for $version is up to date."
  exit 0
fi

ready_to_write
cp "$work/CHANGELOG.md" CHANGELOG.md
set_version "${version#v}"
commit_files "chore(release): $version"
