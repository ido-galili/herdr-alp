# herdr-alp

## Pull request titles

PRs are squash-merged and the title becomes the commit, which git-cliff turns into a line of
`CHANGELOG.md` and the GitHub Release word for word. A PR check (commitlint) fails a title that
doesn't follow this:

```
type(scope): what changed, for the person using Alp
```

- `type`: `feat`, `fix` or `perf` when the person using Alp gets something (each one is released
  by itself, see below); `refactor`, `docs`, `chore`, `ci` or `test` when they don't.
- `scope`: one from `commitlint.config.js`: a mod folder, a part like `overview`, `board`,
  `herds`, `settings` or `updates`, or `plugin`, `layout`, `theme`, `setup`, `deps`.
  Comma-separate several, or leave it out.
- The text after the colon starts lowercase, even before a name ("pin Alp before the tabs").
- A breaking change has `!` before the colon: `feat(updates)!: …`. A `BREAKING CHANGE:` footer
  does nothing here, because the squash message is blank.

## The release commit

A PR whose title is `feat`, `fix` or `perf`, or has a `!`, ends with its release commit. After
opening the PR (its number goes in the changelog) and settling the title, run
`npm run release-commit`, then `git push` (`git push --force-with-lease` when it says it replaced
one). Run it again after every rebase on `main` and every title change, and keep it the last
commit: commit other work before it and run it again. The "Release commit" PR check fails while
it's missing or out of date. On merge, the release workflow tags the merge and publishes the
GitHub Release from `CHANGELOG.md`.

## Checks

- `npm install` once: dev tools and the pre-commit hook (oxlint and oxfmt on the staged files).
- `herdr-app check mods/<mod>` loads a mod once and reports what's wrong.
- Don't hand-edit `CHANGELOG.md` or the plugin's `version`: `npm run release-commit` writes both.
