# herdr-alp

## Pull request titles

PRs are squash-merged and the title becomes the commit, which git-cliff turns into a line of
`CHANGELOG.md` and the GitHub Release word for word. A PR check (commitlint) fails a title that
doesn't follow this:

```
type(scope): what changed, for the person using Alp
```

- `type`: `feat`, `fix` or `perf` when the person using Alp gets something (each merge of one is
  released by itself); `refactor`, `docs`, `chore`, `ci` or `test` when they don't.
- `scope`: one from `commitlint.config.js`: a mod folder, a part like `overview`, `board`,
  `herds`, `settings` or `updates`, or `plugin`, `layout`, `theme`, `setup`, `deps`.
  Comma-separate several, or leave it out.
- The text after the colon starts lowercase, even before a name ("pin Alp before the tabs").
- A breaking change has `!` before the colon: `feat(updates)!: …`. A `BREAKING CHANGE:` footer
  does nothing here, because the squash message is blank.

## Checks

- `npm install` once: dev tools and the pre-commit hook (oxlint and oxfmt on the staged files).
- `herdr-app check mods/<mod>` loads a mod once and reports what's wrong.
- Don't hand-edit `CHANGELOG.md` or the plugin's `version`: the release workflow writes both.
