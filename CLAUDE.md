# herdr-alp

## Pull request titles

PRs are squash-merged and the title becomes the commit, which git-cliff turns into a line of
`CHANGELOG.md` and the GitHub Release word for word. A PR check (commitlint) fails a title that
doesn't follow this:

```
type(scope): what changed, for the person using Alp
```

- `type`: every change to shipped code (`mods/`, `layouts/`, `themes/`, `plugins/`, `sync.sh`,
  `setup.sh`) is a release, each one by itself (see below): `feat` (Added), `fix` (Fixed), `perf`
  (Faster) or `refactor` (Changed: shipped code that works the same). `docs`, `test`, `ci` and
  `chore` (repo tooling, dev dependencies) release nothing and can't touch shipped code.
- `scope`: one from `commitlint.config.js`: a mod folder, a part like `overview`, `board`,
  `herds`, `settings` or `updates`, or `plugin`, `layout`, `theme`, `setup`, `deps`.
  Comma-separate several, or leave it out.
- The text after the colon starts lowercase, even before a name ("pin Alp before the tabs").
- A breaking change has `!` before the colon: `feat(updates)!: …`. A `BREAKING CHANGE:` footer
  does nothing here, because the squash message is blank.

## The release commit

A PR whose title is `feat`, `fix`, `perf` or `refactor`, or has a `!`, ends with its release commit. After
opening the PR (its number goes in the changelog) and settling the title, run
`npm run release-commit`, then `git push`. Run it again after every rebase on `main`, every title
change and any later work: each run adds a commit (never force-push; only the squash merge's
files count), and a title that no longer releases gets main's `CHANGELOG.md` and version back. The "Release commit" PR check fails while
it's missing or out of date. On merge, the release workflow tags the merge and publishes the
GitHub Release from `CHANGELOG.md`.

## Checks

- `npm install` once: dev tools and the pre-commit hook (oxlint and oxfmt on the staged files).
- `herdr-app check mods/<mod>` loads a mod once and reports what's wrong.
- Don't hand-edit `CHANGELOG.md` or the plugin's `version`: `npm run release-commit` writes both.
