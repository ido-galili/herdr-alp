#!/usr/bin/env bash
# The release commit: the last commit of a pull request whose title is a feat, fix or perf, or
# has a "!". It writes CHANGELOG.md and the plugin's version as they will be once the PR is
# squash-merged, so main gets them with the merge and nothing is pushed to main afterwards. The
# release workflow then tags that merge and publishes the GitHub Release.
#
#   scripts/release-commit.sh          write it as this branch's last commit (replacing an older
#                                      one); run it after the PR is open and its title is final,
#                                      and again after rebasing or retitling
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
base_version=$(git show "$base:$plugin" | version_of)
head_version=$(version_of < "$plugin")

# A PR stacked on one whose release isn't tagged yet would get that same version.
if git show "$base:CHANGELOG.md" 2> /dev/null | grep -q "^## \[$base_version\]" &&
  ! git rev-parse -q --verify "refs/tags/v$base_version" > /dev/null; then
  fail "$base's release v$base_version isn't tagged yet: merge it, rebase on main and run this again."
fi

# The same rule as cliff.toml: feat, fix and perf are released, and so is any type with a "!".
if [[ ! "$PR_TITLE" =~ ^(feat|fix|perf)(\([^\)]*\))?!?: && ! "$PR_TITLE" =~ ^[a-z]+(\([^\)]*\))?!: ]]; then
  if $check; then
    [ "$head_version" = "$base_version" ] && git diff --quiet "$base" HEAD -- CHANGELOG.md ||
      fail "\"$PR_TITLE\" releases nothing, so CHANGELOG.md and the plugin's version stay as they are on main. Drop the release commit, or make the title a feat, fix or perf."
    echo "\"$PR_TITLE\" releases nothing."
    exit 0
  fi
  [ "$(git log -1 --format=%s)" != "chore(release): v$head_version" ] ||
    fail "\"$PR_TITLE\" releases nothing, but the last commit is a release commit: drop it (git reset --keep HEAD~1)."
  echo "\"$PR_TITLE\" releases nothing: no release commit needed."
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

git merge-base --is-ancestor "$base" HEAD || fail "rebase on $base first: the changelog is made from it."
[ -z "$(git status --porcelain)" ] || fail "commit or stash your changes first."
replaced=false
if [[ "$(git log -1 --format=%s)" == "chore(release): "* ]]; then
  git reset -q --soft HEAD~1
  replaced=true
fi
cp "$work/CHANGELOG.md" CHANGELOG.md
sed -E "s/(\"version\": *\")[^\"]*\"/\1${version#v}\"/" "$plugin" > "$work/plugin.json"
cat "$work/plugin.json" > "$plugin"
git add CHANGELOG.md "$plugin"
git commit -q -m "chore(release): $version"
if $replaced; then
  echo "Replaced the release commit with $version. Push it with: git push --force-with-lease"
else
  echo "Added the release commit for $version. Push it with: git push"
fi
