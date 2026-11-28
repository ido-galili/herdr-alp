/**
 * commitlint's rules for PR titles. Merges are squash only, so a PR's title becomes the commit
 * git-cliff turns into a changelog line: `type(scope): what changed, for the person using Alp`.
 * Every rule of @commitlint/config-conventional applies; only the types and scopes are ours.
 */
import { readdirSync } from "node:fs";

/** The types a title may start with. feat, fix and perf make a release; the rest don't. */
const TYPES = ["feat", "fix", "perf", "refactor", "docs", "chore", "ci", "test"];

/** Scopes besides the mod folders: parts of a mod people know by name, and repo-wide areas. */
const EXTRA_SCOPES = [
  // Parts of a mod
  "alp",
  "overview",
  "board",
  "herds",
  "today",
  "settings",
  "updates",
  "files",
  "runs",
  "tabs",
  "sidebar",
  "filters",
  "pane-header",
  "demo",
  // The repo
  "plugin",
  "layout",
  "theme",
  "setup",
  "deps",
  "release",
];

/** Every mod folder is a scope, so a new mod needs no change here. */
const MOD_SCOPES = readdirSync(new URL("./mods", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", TYPES],
    "scope-enum": [2, "always", [...MOD_SCOPES, ...EXTRA_SCOPES]],
  },
};
