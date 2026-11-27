// Your GitHub as a whole, for the Dashboard's "All repos" view: the Red checks tile (beside your
// issues; your lists are in my-day.js), then every repository in scope with its open work and the
// state of its default branch.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
import { Tile } from "./project.js";
import { Card, Chip, NeedsYou, Note, Row, TextButton, Toggle, ago } from "./ui.js";

const REPO_LIMIT = 12;

/**
 * The Red checks tile: default branches and your PRs whose checks fail.
 * @param {object} account The account model.
 * @returns {object} The tile.
 */
export function RedChecks(account) {
  const t = theme();
  const red = account.redRepos + account.redPrs;
  return Tile(
    "tile-red",
    "Red checks",
    String(red),
    [`${account.redRepos} default branches failing`, `${account.redPrs} of your PRs failing`],
    red ? t.blocked : t.done,
    null,
  );
}

/**
 * The chip for a default branch's combined check state.
 * @param {object} t The theme.
 * @param {object} repo The repository row.
 * @returns {object | null}
 */
function branchChecks(t, repo) {
  const id = `repo-ck-${repo.repo}`;
  if (repo.checks === "FAILURE" || repo.checks === "ERROR") {
    return NeedsYou(`${repo.branch} failing`).id(id).tooltip(`The last commit on ${repo.branch} failed a check`);
  }
  if (repo.checks === "PENDING" || repo.checks === "EXPECTED") return Chip(`${repo.branch} running`, { color: t.working });
  if (repo.checks === "SUCCESS") return Chip(`${repo.branch} passing`, { color: t.done });
  return null;
}

/**
 * Every repository in scope, most recently pushed first: open issues and PRs, the default
 * branch's checks, when it was last pushed, and whether you have a local clone.
 * @param {object} config The settings.
 * @param {object} account The account model.
 * @param {object} options `{ expanded, onToggleGroup(key, cx), activeOnly, onToggleActive(cx) }`: the
 *   lists showing every row, and whether only repositories with open work show.
 * @returns {object} The card.
 */
export function Repos(config, account, options) {
  const t = theme();
  const now = Date.now();
  const shown = account.repos.filter((repo) => !options.activeOnly || repo.issues || repo.prs);
  const open = options.expanded.has("repos");
  const rows = (open ? shown : shown.slice(0, REPO_LIMIT)).map((repo) => {
    const folder = config.account.folders[repo.repo];
    return Row(`repo-${repo.repo}`, {
      title: repo.repo,
      url: repo.url,
      dim: !repo.issues && !repo.prs,
      chips: [
        repo.isPrivate ? Chip("private", { color: t.dim }) : null,
        repo.isArchived ? Chip("archived", { color: t.dim }) : null,
        folder ? Chip("local", { color: t.muted, id: `repo-local-${repo.repo}`, tooltip: folder }) : null,
        repo.issues ? Chip(`${repo.issues} issues`, { color: t.muted }) : null,
        repo.prs ? Chip(`${repo.prs} PRs`, { color: t.accent }) : null,
        branchChecks(t, repo),
        repo.pushedAt ? Chip(`pushed ${ago(now - repo.pushedAt)} ago`, { color: t.dim }) : null,
      ].filter(Boolean),
    });
  });
  const more = shown.length - REPO_LIMIT;
  const scope = Array.isArray(config.account.repos) ? "picked" : "all";
  return Card(
    "repos",
    "Repos",
    [
      Chip(`${account.repos.length} in scope (${scope})`, { color: t.dim }),
      Toggle(
        "repos-active",
        "With open work",
        options.activeOnly,
        (cx) => options.onToggleActive(cx),
        "Show only repositories with open issues or PRs",
      ),
    ],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) =>
        el.child(Note(options.activeOnly ? "No open issues or PRs in scope." : "No repositories in scope.")),
      )
      .children(rows)
      .when(more > 0, (el) =>
        el.child(
          TextButton("repos-more", open ? "Show less" : `Show ${more} more`, (cx) => options.onToggleGroup("repos", cx)),
        ),
      )
      .when(account.reposTotal > 100, (el) =>
        el.child(div().pt(6).child(Note(`Showing your 100 most recently pushed of ${account.reposTotal}.`))),
      ),
  );
}
