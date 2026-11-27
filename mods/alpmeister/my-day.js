// Your lists, on the Overview: review requests, your own PRs and your own issues, across every
// repository in scope on All repos, or narrowed to a workspace's repositories. Each row has a pin
// (Pin to Today, the list in Basecamp's Today tab) and a button that opens a Claude tab on it.

import { v_flex } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import { hasTerm, termOf, valuesOf } from "./search-terms.js";
import {
  Card,
  Chip,
  DashedMark,
  GroupHeading,
  ICONS,
  IconButton,
  NeedsYou,
  Note,
  Row,
  ago,
  claudeTooltip,
  fillPrompt,
  noPromptTooltip,
  itemKey,
  openUrl,
  statusColor,
  warningColor,
} from "./ui.js";

/**
 * The chips each card's filter offers, by its search's key: a term each turns on and off. The
 * Daypack's three, then a workspace's Open bugs and Triage bugs (on the Overview and in
 * Settings › Card filters). Every label in the search gets a chip too, and "+ Label" adds one.
 */
const CARD_CHIPS = {
  review: [
    { term: "review-requested:@me", label: "Review requested" },
    { term: "is:open", label: "Open" },
    { term: "draft:false", label: "Not draft" },
  ],
  myPrs: [
    { term: "author:@me", label: "Mine" },
    { term: "is:open", label: "Open" },
    { term: "draft:false", label: "Not draft" },
  ],
  mine: [
    { term: "assignee:@me", label: "Assigned to me" },
    { term: "is:open", label: "Open" },
    { term: "type:Bug", label: "Bugs only" },
  ],
  bugs: [
    { term: "is:open", label: "Open" },
    { term: "type:Bug", label: "Bugs only" },
  ],
  triage: [
    { term: "is:open", label: "Open" },
    { term: "type:Bug", label: "Bugs only" },
  ],
};

/**
 * A card's filter chips for a search: the card's own, then one per label in it.
 * @param {"review" | "myPrs" | "mine" | "bugs" | "triage"} key The card's search.
 * @param {string} query The search as it stands in the field.
 * @returns {{ term: string, label: string, on: boolean }[]} Each chip's term, label and whether it is on.
 */
export function filterChips(key, query) {
  const labels = valuesOf(query, "label").map((label) => ({ term: termOf("label", label), label: `label ${label}` }));
  return [...CARD_CHIPS[key], ...labels].map((chip) => ({ ...chip, on: hasTerm(query, chip.term) }));
}

/** A PR untouched this long gets its age in the warning color. */
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
 * The Claude button for an issue or PR. With its prompt set, it shows the Claude mark, and its
 * tooltip starts "Review" (a PR) or "Start" (an issue); a click opens a Claude tab on the item
 * and a middle click opens it in the background. Without one, the mark is dashed and a click
 * opens Settings, where the prompt is set.
 * @param {string} prefix Keeps the button's id unique per list.
 * @param {object} item The issue or PR.
 * @param {{ launch(item: object, options?: { background?: boolean }): void, prompt(kind: string): string,
 *   openSettings?(cx: object): void }} actions
 * @returns {object} The button.
 */
export function ClaudeButton(prefix, item, actions) {
  const id = `${prefix}-go-${itemKey(item)}`;
  const prompt = actions.prompt(item.kind);
  if (!prompt) {
    return IconButton(id, null, (cx) => actions.openSettings?.(cx), {
      mark: DashedMark(theme()),
      label: "Set prompt",
      tooltip: noPromptTooltip(item.kind),
    });
  }
  return IconButton(id, ICONS.claude, () => actions.launch(item), {
    picture: true,
    label: item.kind === "pr" ? "Review" : "Start",
    tooltip: claudeTooltip(fillPrompt(prompt, item)),
    onMiddleClick: (cx) => actions.launch(item, { background: true, cx }),
  });
}

/**
 * The repositories a workspace's lists are narrowed to: its repository, or for a workspace with
 * only a board, the repositories its board's items are in.
 * @param {object} ws The workspace.
 * @param {object | undefined} wsModel The workspace's model, for its board's items.
 * @returns {string[]} `owner/name` of each.
 */
export function workspaceRepos(ws, wsModel) {
  if (ws.repo) return [ws.repo];
  const items = [...(wsModel?.boardView?.items ?? []), ...(wsModel?.inFlight ?? [])];
  return [...new Set(items.map((item) => item.repo).filter(Boolean))].sort();
}

/**
 * The account's three lists narrowed to a workspace: review requests and your PRs in its
 * repositories, your issues in them or on its board. Counts are the narrowed lists' lengths, and
 * each list's GitHub link searches only those repositories.
 * @param {object} account The account model.
 * @param {object} ws The workspace.
 * @param {object | undefined} wsModel The workspace's model.
 * @returns {object} A copy of the account model with `reviews`, `myPrs`, `mine`, `counts`,
 *   `scope` (the `repo:` terms the GitHub links add) and `only` (the workspace's one repository,
 *   whose rows leave out its name; null when it has none) narrowed.
 */
export function narrowAccount(account, ws, wsModel) {
  const repos = new Set(workspaceRepos(ws, wsModel));
  const inRepos = (item) => repos.has(item.repo);
  const reviews = (account.reviews ?? []).filter(inRepos);
  const myPrs = (account.myPrs ?? []).filter(inRepos);
  const mine = (account.mine ?? []).filter((issue) => inRepos(issue) || issue.workspace === ws.name);
  return {
    ...account,
    reviews,
    myPrs,
    mine,
    counts: { ...account.counts, reviews: reviews.length, myPrs: myPrs.length, mine: mine.length },
    scope: [...repos].map((repo) => `repo:${repo}`).join(" "),
    only: repos.size === 1 ? [...repos][0] : null,
  };
}

/**
 * The repository a row names before its title: none for the workspace's one repository.
 * @param {object} account The account model, narrowed or not.
 * @param {{ repo: string }} item The issue or PR.
 * @returns {string | null}
 */
const shownRepo = (account, item) => (account.only && item.repo === account.only ? null : item.repo);

/**
 * A list's search for its GitHub link: the card's search, narrowed to the workspace's
 * repositories when the account model is (`narrowAccount`).
 * @param {object} account The account model.
 * @param {"review" | "myPrs" | "mine"} key The card's search.
 * @returns {string} The URL.
 */
const listUrl = (account, key) =>
  searchUrl(null, account.scope ? `${account.queries[key]} ${account.scope}` : account.queries[key]);

/**
 * Review requests.
 * @param {object} account The account model.
 * @param {{ pinButton(item: object): object, launch(item: object): void, prompt(kind: string): string,
 *   filter?(key: string): object }} actions `filter` gives the card's filter icon (`FilterIcon`),
 *   last on the header.
 * @returns {object} The card.
 */
export function Reviews(account, actions) {
  const t = theme();
  const reviews = account.reviews ?? [];
  const now = Date.now();
  const rows = reviews.map((pr) =>
    Row(`rv-${itemKey(pr)}`, {
      number: pr.number,
      repo: shownRepo(account, pr),
      title: pr.title,
      url: pr.url,
      chips: [
        Chip(pr.author, { color: t.muted }),
        decisionChip(t, pr, "rv"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? warningColor(t) : t.dim }),
        checksChip(t, pr, "rv"),
      ].filter(Boolean),
      buttons: [actions.pinButton(pr), ClaudeButton("rv", pr, actions)],
    }),
  );
  const filter = actions.filter?.("review");
  return Card(
    "reviews",
    "Waiting for your review",
    [
      Chip(String(account.counts?.reviews ?? reviews.length), { color: reviews.length ? t.blocked : t.dim }),
      IconButton("rv-all", ICONS.github, () => openUrl(listUrl(account, "review")), {
        tooltip: "Open the list on GitHub",
      }),
      ...(filter ? [filter] : []),
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
 * @param {{ pinButton(item: object): object, launch(item: object): void, prompt(kind: string): string,
 *   filter?(key: string): object }} actions
 * @returns {object} The card.
 */
export function MyPrs(account, actions) {
  const t = theme();
  const prs = account.myPrs ?? [];
  const now = Date.now();
  const rows = prs.map((pr) =>
    Row(`mp-${itemKey(pr)}`, {
      number: pr.number,
      repo: shownRepo(account, pr),
      title: pr.title,
      url: pr.url,
      chips: [
        decisionChip(t, pr),
        checksChip(t, pr, "mp"),
        Chip(`${ago(now - pr.updatedAt)} ago`, { color: now - pr.updatedAt > STALE_PR_AGE ? warningColor(t) : t.dim }),
      ].filter(Boolean),
      buttons: [actions.pinButton(pr), ClaudeButton("mp", pr, actions)],
    }),
  );
  const filter = actions.filter?.("myPrs");
  return Card(
    "my-prs",
    "Your open PRs",
    [
      Chip(String(account.counts?.myPrs ?? prs.length), { color: t.muted }),
      IconButton("mp-all", ICONS.github, () => openUrl(listUrl(account, "myPrs")), {
        tooltip: "Open the list on GitHub",
      }),
      ...(filter ? [filter] : []),
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
 * no workspace's board shows under "No status".
 * @param {object} config The settings.
 * @param {object} account The account model.
 * @param {object} actions `{ pinButton, launch, prompt, filter? }`.
 * @returns {object} The card.
 */
export function MyIssues(config, account, actions) {
  const t = theme();
  const settingsOf = (issue) => config.workspaces.find((ws) => ws.name === issue.workspace) ?? null;
  const mine = account.mine ?? [];
  const order = [...new Set(config.workspaces.flatMap((ws) => (ws.board ? ws.statuses : [])))];
  const visible = mine.filter((issue) => !settingsOf(issue)?.mineHidden.includes(issue.status));
  const groups = [...order, null]
    .map((status) => ({
      status,
      items: visible.filter((issue) => (status === null ? !order.includes(issue.status) : issue.status === status)),
    }))
    .filter((group) => group.items.length);
  const hidden = mine.length - visible.length;
  const filter = actions.filter?.("mine");
  return Card(
    "mine",
    "Your issues",
    [
      Chip(hidden ? `${visible.length} shown · ${hidden} hidden by status` : `${visible.length}`, { color: t.dim }),
      IconButton("mi-all", ICONS.github, () => openUrl(listUrl(account, "mine")), {
        tooltip: "Open the list on GitHub",
      }),
      ...(filter ? [filter] : []),
    ],
    v_flex()
      .gap(2)
      .when(!groups.length, (el) => el.child(Note("No open issues assigned to you.")))
      .children(
        groups.flatMap((group) => [
          GroupHeading(group.status ?? "No status", group.items.length, statusColor(t, group.status)),
          ...group.items.map((issue) =>
            Row(`mi-${itemKey(issue)}`, {
              number: issue.number,
              repo: shownRepo(account, issue),
              title: issue.title,
              url: issue.url,
              chips: issue.milestone ? [Chip(issue.milestone, { color: t.dim })] : [],
              buttons: [actions.pinButton(issue), ClaudeButton("mi", issue, actions)],
            }),
          ),
        ]),
      ),
  );
}
