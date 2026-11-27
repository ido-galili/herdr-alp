// Your GitHub as a whole, for the Dashboard's "All repos" view: four tiles (review requests,
// your PRs, your issues, red checks), then every repository in scope with its open work and the
// state of its default branch. Also the open PRs card a workspace without a board shows in place
// of the team in flight.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import { ClaudeButton, checksChip, decisionChip } from "./my-day.js";
import { Tile } from "./project.js";
import { Card, Chip, NeedsYou, Note, Row, TextButton, Toggle, ago, itemKey } from "./ui.js";

const REPO_LIMIT = 12;
const PR_LIMIT = 10;

/**
 * The account's four tiles, four across when `wide`, else two by two.
 * @param {object} account The account model.
 * @param {{ wide: boolean }} options
 * @returns {object} The row of tiles.
 */
export function AccountTiles(account, { wide }) {
  const t = theme();
  const counts = account.counts;
  const approved = account.myPrs.filter((pr) => pr.reviewDecision === "APPROVED").length;
  const changes = account.myPrs.filter((pr) => pr.reviewDecision === "CHANGES_REQUESTED").length;
  const red = account.redRepos + account.redPrs;
  const prLines = [
    approved ? `${approved} approved` : null,
    changes ? `${changes} with changes requested` : null,
  ].filter(Boolean);
  const tiles = [
    Tile(
      "tile-reviews",
      "Waiting for your review",
      String(counts.reviews),
      "review requests",
      counts.reviews ? t.blocked : t.foreground,
      searchUrl(null, account.queries.review),
    ),
    Tile(
      "tile-my-prs",
      "Your open PRs",
      String(counts.myPrs),
      prLines.length ? prLines : "no review decisions yet",
      t.foreground,
      searchUrl(null, account.queries.myPrs),
    ),
    Tile(
      "tile-mine",
      "Your issues",
      String(counts.mine),
      "open, assigned to you",
      t.foreground,
      searchUrl(null, account.queries.mine),
    ),
    Tile(
      "tile-red",
      "Red checks",
      String(red),
      [`${account.redRepos} default branches failing`, `${account.redPrs} of your PRs failing`],
      red ? t.blocked : t.done,
      null,
    ),
  ];
  if (wide) return h_flex().gap(10).items_stretch().children(tiles);
  return v_flex()
    .gap(10)
    .child(h_flex().gap(10).items_stretch().children(tiles.slice(0, 2)))
    .child(h_flex().gap(10).items_stretch().children(tiles.slice(2)));
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

/**
 * A workspace's open PRs, for a repository with no board: author, review decision, checks, age.
 * @param {object} ws The workspace.
 * @param {object} model The workspace's model.
 * @param {object} actions `{ pinButton, launch, prompt, expanded, onToggleGroup }`.
 * @returns {object} The card.
 */
export function OpenPrs(ws, model, actions) {
  const t = theme();
  const prs = model.openPrs ?? [];
  const now = Date.now();
  const open = actions.expanded.has("open-prs");
  const rows = (open ? prs : prs.slice(0, PR_LIMIT)).map((pr) =>
    Row(`op-${itemKey(pr)}`, {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      dim: pr.isDraft,
      chips: [
        pr.isDraft ? Chip("Draft", { color: t.dim }) : null,
        Chip(pr.author, { color: t.muted }),
        decisionChip(t, pr, "op"),
        checksChip(t, pr, "op"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: t.dim }),
      ].filter(Boolean),
      buttons: [actions.pinButton(pr), ClaudeButton("op", pr, actions)].filter(Boolean),
    }),
  );
  const more = prs.length - PR_LIMIT;
  return Card(
    "open-prs",
    "Open PRs",
    [Chip(String(model.openPrsTotal ?? prs.length), { color: t.muted })],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) =>
        el.child(Note(model.errors?.prs ? `GitHub: ${model.errors.prs}` : `No open PRs in ${ws.repo}.`)),
      )
      .children(rows)
      .when(more > 0, (el) =>
        el.child(
          TextButton("open-prs-more", open ? "Show less" : `Show ${more} more`, (cx) =>
            actions.onToggleGroup("open-prs", cx),
          ),
        ),
      ),
  );
}
