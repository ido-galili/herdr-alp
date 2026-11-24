// Your day, across every repository in scope: review requests, your own PRs and your own
// issues. Each row has a pin and a button that opens a Claude tab on it.

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
  claudeTooltip,
  fillPrompt,
  itemKey,
  openUrl,
  statusColor,
} from "./ui.js";

/** A PR untouched this long gets its age in the `working` color. */
const STALE_PR_AGE = 3 * 86400000;

/**
 * The chip for a PR's combined check state.
 * @param {object} t The theme.
 * @param {object} pr The PR.
 * @param {string} prefix Keeps the chip's id unique per list.
 * @returns {object | null} The chip, or null when the PR has no checks.
 */
export function checksChip(t, pr, prefix) {
  const id = `${prefix}-ck-${itemKey(pr)}`;
  if (pr.checks === "FAILURE" || pr.checks === "ERROR")
    return NeedsYou("Checks Failing").id(id).tooltip("A check failed");
  if (pr.checks === "PENDING" || pr.checks === "EXPECTED") return Chip("Checks Running", { color: t.working });
  if (pr.checks === "SUCCESS") return Chip("Checks Pass", { color: t.done });
  return null;
}

/**
 * The Claude button for an issue or PR, when its prompt is set.
 * @param {string} prefix Keeps the button's id unique per list.
 * @param {object} item The issue or PR.
 * @param {{ launch(item: object, options?: { background?: boolean }): void, prompt(kind: string): string }} actions
 * @returns {object | null} The button, or null without a prompt. A middle click opens the tab
 *   in the background.
 */
export function ClaudeButton(prefix, item, actions) {
  const prompt = actions.prompt(item.kind);
  if (!prompt) return null;
  return IconButton(`${prefix}-go-${itemKey(item)}`, ICONS.claude, () => actions.launch(item), {
    picture: true,
    tooltip: claudeTooltip(fillPrompt(prompt, item)),
    onMiddleClick: (cx) => actions.launch(item, { background: true, cx }),
  });
}

/**
 * Review requests.
 * @param {object} account The account model.
 * @param {{ pinButton(item: object): object, launch(item: object): void, prompt(kind: string): string }} actions
 * @returns {object} The card.
 */
export function Reviews(account, actions) {
  const t = theme();
  const reviews = account.reviews ?? [];
  const now = Date.now();
  const rows = reviews.map((pr) =>
    Row(`rv-${itemKey(pr)}`, {
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      url: pr.url,
      chips: [
        Chip(pr.author, { color: t.muted }),
        decisionChip(t, pr, "rv"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? t.working : t.dim }),
        checksChip(t, pr, "rv"),
      ].filter(Boolean),
      buttons: [actions.pinButton(pr), ClaudeButton("rv", pr, actions)].filter(Boolean),
    }),
  );
  return Card(
    "reviews",
    "PRs need your attention",
    [
      Chip(String(account.counts?.reviews ?? reviews.length), { color: reviews.length ? t.blocked : t.dim }),
      IconButton("rv-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.review)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) => el.child(Note("No reviews waiting on you.")))
      .children(rows),
  );
}

/**
 * The chip for a PR's review decision: approved, changes requested, or waiting for review.
 * @param {object} t The theme.
 * @param {object} pr The PR.
 * @param {string} prefix Keeps the chip's id unique per list.
 * @returns {object | null}
 */
export function decisionChip(t, pr, prefix = "mp") {
  if (pr.reviewDecision === "APPROVED") return Chip("Approved", { color: t.done });
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return NeedsYou("Changes Requested").id(`${prefix}-rd-${itemKey(pr)}`).tooltip("A reviewer asked for changes");
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") return Chip("In Review", { color: t.muted });
  return null;
}

/**
 * Your open, non-draft PRs: review decision, checks and age.
 * @param {object} account The account model.
 * @param {{ pinButton(item: object): object, launch(item: object): void, prompt(kind: string): string }} actions
 * @returns {object} The card.
 */
export function MyPrs(account, actions) {
  const t = theme();
  const prs = account.myPrs ?? [];
  const now = Date.now();
  const rows = prs.map((pr) =>
    Row(`mp-${itemKey(pr)}`, {
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      url: pr.url,
      chips: [
        decisionChip(t, pr),
        checksChip(t, pr, "mp"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? t.working : t.dim }),
      ].filter(Boolean),
      buttons: [actions.pinButton(pr), ClaudeButton("mp", pr, actions)].filter(Boolean),
    }),
  );
  return Card(
    "my-prs",
    "My PRs",
    [
      Chip(String(account.counts?.myPrs ?? prs.length), { color: t.muted }),
      IconButton("mp-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.myPrs)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    v_flex()
      .gap(2)
      .when(!rows.length, (el) => el.child(Note(account.myPrs ? "No open PRs of yours." : "Refresh to load your PRs.")))
      .children(rows),
  );
}

/**
 * Your open issues, grouped by board status in the workspaces' status order. An issue on a
 * workspace's board is hidden when its status is in that workspace's `mineHidden`; an issue on
 * no workspace's board shows under "No status". With `actions.iterationOnly`, an issue on a board
 * with a current iteration shows only when it is in it.
 * @param {object} config The settings.
 * @param {object} account The account model.
 * @param {Record<string, { title: string } | null>} iterations Each workspace's current iteration, by name.
 * @param {object} actions `{ pinButton, launch, prompt, iterationOnly, onToggleIteration(cx) }`.
 * @returns {object} The card.
 */
export function MyIssues(config, account, iterations, actions) {
  const t = theme();
  const settingsOf = (issue) => config.workspaces.find((ws) => ws.name === issue.workspace) ?? null;
  const inIteration = (issue) => {
    const current = issue.workspace ? iterations[issue.workspace] : null;
    return !current || issue.iteration === current.title;
  };
  const mine = (account.mine ?? []).filter((issue) => !actions.iterationOnly || inIteration(issue));
  const order = [...new Set(config.workspaces.flatMap((ws) => (ws.board ? ws.statuses : [])))];
  const visible = mine.filter((issue) => !settingsOf(issue)?.mineHidden.includes(issue.status));
  const groups = [...order, null]
    .map((status) => ({
      status,
      items: visible.filter((issue) => (status === null ? !order.includes(issue.status) : issue.status === status)),
    }))
    .filter((group) => group.items.length);
  const hidden = mine.length - visible.length;
  const anyIteration = Object.values(iterations).some(Boolean);
  return Card(
    "mine",
    "Your issues",
    [
      Chip(hidden ? `${visible.length} shown · ${hidden} hidden by status` : `${visible.length}`, { color: t.dim }),
      Toggle(
        "mi-iteration-only",
        "Current iteration",
        actions.iterationOnly,
        (cx) => actions.onToggleIteration(cx),
        anyIteration ? "Show only issues in their board's current iteration" : "No board has a current iteration",
      ),
      IconButton("mi-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.mine)), {
        tooltip: "Open the list on GitHub",
      }),
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
            Row(`mi-${itemKey(issue)}`, {
              number: issue.number,
              repo: issue.repo,
              title: issue.title,
              url: issue.url,
              chips: issue.milestone ? [Chip(issue.milestone, { color: t.dim })] : [],
              buttons: [actions.pinButton(issue), ClaudeButton("mi", issue, actions)].filter(Boolean),
            }),
          ),
        ]),
      ),
  );
}
