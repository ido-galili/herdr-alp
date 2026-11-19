// Your day: review requests, your own PRs and your own issues. Each row has a pin and a button
// that opens a Claude tab on it.

import { v_flex } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import {
  Card,
  Chip,
  GroupHeading,
  ICONS,
  IconButton,
  NeedsYou,
  Note,
  Row,
  Toggle,
  ago,
  openUrl,
  statusColor,
} from "./ui.js";

/** A PR untouched this long gets its age in the `working` color. */
const STALE_PR_AGE = 3 * 86400000;

/** The chip for a PR's combined check state. `prefix` keeps its id unique per list. */
function checksChip(t, pr, prefix) {
  const id = `${prefix}-ck-${pr.number}`;
  if (pr.checks === "FAILURE" || pr.checks === "ERROR")
    return NeedsYou("Checks Failing").id(id).tooltip("A check failed");
  if (pr.checks === "PENDING" || pr.checks === "EXPECTED") return Chip("Checks Running", { color: t.working });
  if (pr.checks === "SUCCESS") return Chip("Checks Pass", { color: t.done });
  return null;
}

/**
 * Review requests. `actions`: `{ pinButton(item), launch(kind, number) }`.
 */
export function Reviews(config, model, actions) {
  const t = theme();
  const reviews = model.reviews ?? [];
  const now = Date.now();
  const rows = reviews.map((pr) =>
    Row(`rv-${pr.number}`, {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      chips: [
        Chip(pr.author, { color: t.muted }),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? t.working : t.dim }),
        checksChip(t, pr, "rv"),
      ].filter(Boolean),
      buttons: [
        actions.pinButton(pr),
        config.launch.pr &&
          IconButton(`rv-go-${pr.number}`, ICONS.claude, () => actions.launch("pr", pr.number), {
            picture: true,
            tooltip: `Open a Claude tab running ${config.launch.pr.replace("{number}", pr.number)}`,
          }),
      ].filter(Boolean),
    }),
  );
  return Card(
    "reviews",
    "PRs need your attention",
    [
      Chip(String(model.counts?.reviews ?? reviews.length), { color: reviews.length ? t.blocked : t.dim }),
      IconButton("rv-all", ICONS.github, () => openUrl(searchUrl(config, model.queries.reviewQuery)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) => el.child(Note("No reviews waiting on you.")))
      .children(rows),
  );
}

/** The chip for your PR's review decision: approved, changes requested, or waiting for review. */
function decisionChip(t, pr) {
  if (pr.reviewDecision === "APPROVED") return Chip("Approved", { color: t.done });
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return NeedsYou("Changes Requested").id(`mp-rd-${pr.number}`).tooltip("A reviewer asked for changes");
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") return Chip("In Review", { color: t.muted });
  return null;
}

/**
 * Your open, non-draft PRs: review decision, checks and age.
 * `actions`: `{ pinButton(item), launch(kind, number) }`.
 */
export function MyPrs(config, model, actions) {
  const t = theme();
  const prs = model.myPrs ?? [];
  const now = Date.now();
  const rows = prs.map((pr) =>
    Row(`mp-${pr.number}`, {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      chips: [
        decisionChip(t, pr),
        checksChip(t, pr, "mp"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? t.working : t.dim }),
      ].filter(Boolean),
      buttons: [
        actions.pinButton(pr),
        config.launch.pr &&
          IconButton(`mp-go-${pr.number}`, ICONS.claude, () => actions.launch("pr", pr.number), {
            picture: true,
            tooltip: `Open a Claude tab running ${config.launch.pr.replace("{number}", pr.number)}`,
          }),
      ].filter(Boolean),
    }),
  );
  return Card(
    "my-prs",
    "My PRs",
    [
      Chip(String(model.counts?.myPrs ?? prs.length), { color: t.muted }),
      IconButton("mp-all", ICONS.github, () => openUrl(searchUrl(config, model.queries.myPrsQuery)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) => el.child(Note(model.myPrs ? "No open PRs of yours." : "Refresh to load your PRs.")))
      .children(rows),
  );
}

/**
 * Your open issues grouped by board status, hiding the statuses in `mineHidden`. With
 * `actions.iterationOnly`, only the issues in the current iteration show.
 */
export function MyIssues(config, model, actions) {
  const t = theme();
  const iteration = model.iteration;
  const mine = (model.mine ?? []).filter(
    (issue) => !actions.iterationOnly || !iteration || issue.iteration === iteration.title,
  );
  const order = [...config.statuses, null];
  const visible = mine.filter((issue) => !config.mineHidden.includes(issue.status));
  const groups = order
    .map((status) => ({
      status,
      items: visible.filter((issue) =>
        status === null ? !config.statuses.includes(issue.status) : issue.status === status,
      ),
    }))
    .filter((group) => group.items.length);
  const hidden = mine.length - visible.length;
  return Card(
    "mine",
    "Your issues",
    [
      Chip(`${visible.length} shown · ${hidden} in ${config.mineHidden.join(", ")}`, { color: t.dim }),
      Toggle(
        "mi-iteration-only",
        "Current iteration",
        actions.iterationOnly,
        (cx) => actions.onToggleIteration(cx),
        iteration ? `Show only issues in ${iteration.title}` : "No current iteration: showing every issue",
      ),
    ],
    v_flex()
      .gap(2)
      .when(!groups.length, (el) =>
        el.child(
          Note(
            actions.iterationOnly
              ? "None of your issues are in the current iteration."
              : "No open issues assigned to you.",
          ),
        ),
      )
      .children(
        groups.flatMap((group) => [
          GroupHeading(group.status ?? "No status", group.items.length, statusColor(t, group.status)),
          ...group.items.map((issue) =>
            Row(`mi-${issue.number}`, {
              number: issue.number,
              title: issue.title,
              url: issue.url,
              chips: issue.milestone ? [Chip(issue.milestone, { color: t.dim })] : [],
              buttons: [
                actions.pinButton(issue),
                config.launch.issue &&
                  IconButton(`mi-go-${issue.number}`, ICONS.claude, () => actions.launch("issue", issue.number), {
                    picture: true,
                    tooltip: `Open a Claude tab running ${config.launch.issue.replace("{number}", issue.number)}`,
                  }),
              ].filter(Boolean),
            }),
          ),
        ]),
      ),
  );
}
