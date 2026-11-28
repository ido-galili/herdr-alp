# herdr-alp

## Mods

Every mod this repo ships is `alp` (the Alp tab) or named `alp-<name>`, and is listed in
`sync.sh`'s `mods`. Renaming one adds `old:new` to `renamed_mods` there, so install moves its
Herdr data across.

## Pull request titles

PRs are squash-merged and the title becomes the commit, which git-cliff turns into a line of
`CHANGELOG.md` and the GitHub Release word for word. A PR check (action-semantic-pull-request, as Vite uses) fails a title that
doesn't follow this:

```
type(scope): what changed, for the person using Alp
```

- `type`: a change to shipped code (`mods/`, `layouts/`, `themes/`, `plugins/`, `sync.sh`,
  `setup.sh`) is `feat` (Added), `fix` (Fixed), `perf` (Faster) or `refactor` (Changed: works
  the same), a line in the next release's changelog. `docs`, `test`, `ci` and `chore` (repo
  tooling, dev dependencies) stay out of it.
- `scope`: a mod folder, a part like `overview`, `board`, `herds`, `settings` or `updates`, or
  `plugin`, `layout`, `theme`, `setup`, `deps`. Comma-separate several, or leave it out. The
  check doesn't hold a list: the scope is the changelog line's bold prefix, so keep to these.
- The text after the colon starts lowercase, even before a name ("pin Alp before the tabs").
- A breaking change has `!` before the colon: `feat(updates)!: …`. A `BREAKING CHANGE:` footer
  does nothing here, because the squash message is blank.

## Releases

Releases come from the "Prepare release" button (Actions › Prepare release › Run workflow), not
from feature PRs. It opens a `release: vX.Y.Z` PR that writes `CHANGELOG.md` and the plugin's
version; merging that PR tags it and publishes the GitHub Release. Never open a `release:` PR by
hand.

## Checks

- `npm install` once: dev tools and the pre-commit hook (oxlint and oxfmt on the staged files).
- `herdr-app check mods/<mod>` loads a mod once and reports what's wrong.
- Don't hand-edit `CHANGELOG.md` or the plugin's `version`: the release PR writes both.
