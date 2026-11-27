// Your day, across every repository in scope: review requests, your own PRs and your own
// issues. Each row has a pin and a button that opens a Claude tab on it, and the key over the
// lists says what the two icons do.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
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
  LinkLabel,
  NeedsYou,
  Note,
  Row,
  TextButton,
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
 * Daypack's three, then a workspace's Open bugs, Triage bugs and Open PRs (on the Overview and in
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
  prs: [
    { term: "is:open", label: "Open" },
    { term: "draft:false", label: "Not draft" },
  ],
};

/**
 * A card's filter chips for a search: the card's own, then one per label in it.
 * @param {"review" | "myPrs" | "mine" | "bugs" | "triage" | "prs"} key The card's search.
 * @param {string} query The search as it stands in the field.
 * @returns {{ term: string, label: string, on: boolean }[]} Each chip's term, label and whether it is on.
 */
export function filterChips(key, query) {
  const labels = valuesOf(query, "label").map((label) => ({ term: termOf("label", label), label: `label ${label}` }));
  return [...CARD_CHIPS[key], ...labels].map((chip) => ({ ...chip, on: hasTerm(query, chip.term) }));
}

/**
 * A card's body with its filter's editor on top while it is open.
 * @param {{ panel: object | null } | null | undefined} filter From `actions.filter(key)`.
 * @param {object} body The card's list.
 * @returns {object}
 */
const withFilter = (filter, body) => (filter?.panel ? v_flex().gap(10).child(filter.panel).child(body) : body);

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
 * The Claude button for an issue or PR. With its prompt set, it shows the Claude mark and grows
 * "Review" (a PR) or "Start" (an issue) on hover or focus; a click opens a Claude tab on the item
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
 * The key over the Daypack's lists: what the Claude mark and the pin do, and, while a prompt is
 * missing, what the dashed mark means, with a link that opens Settings. "Hide key" on the right.
 * @param {{ missingPrompt: boolean, openSettings(cx: object): void, hide(cx: object): void }} actions
 * @returns {object} The key row.
 */
export function DaypackKey({ missingPrompt, openSettings, hide }) {
  const t = theme();
  const entry = (mark, ...words) => h_flex().flex_none().gap(6).items_center().child(mark).children(words);
  return h_flex()
    .id("daypack-key")
    .flex_wrap()
    .items_center()
    .gap_x(18)
    .gap_y(6)
    .px(12)
    .py(6)
    .rounded(8)
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .text_size(11.5)
    .text_color(t.muted)
    .child(div().font_semibold().text_color(t.dim).child("Key"))
    .child(entry(image(ICONS.claude).w(13).h(13).flex_none(), "Review a PR or Start an issue in Claude"))
    .child(entry(svg(ICONS.pin).size(13).flex_none().text_color(t.muted), "Pin to Today"))
    .when(missingPrompt, (el) =>
      el.child(
        entry(
          DashedMark(t),
          "no prompt yet ·",
          div()
            .id("daypack-key-settings")
            .text_color(t.accent)
            .cursor_pointer()
            .hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              openSettings(cx);
            })
            .child(LinkLabel(ICONS.settings, "set it in Settings")),
        ),
      ),
    )
    .child(div().flex_1())
    .child(TextButton("daypack-key-hide", "Hide key", (cx) => hide(cx)));
}

/**
 * Review requests.
 * @param {object} account The account model.
 * @param {{ pinButton(item: object): object, launch(item: object): void, prompt(kind: string): string,
 *   filter?(key: string): { summary: object, panel: object | null } }} actions `filter` gives the
 *   card's filter, from `FilterControl`.
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
      ...(filter ? [filter.summary] : []),
      Chip(String(account.counts?.reviews ?? reviews.length), { color: reviews.length ? t.blocked : t.dim }),
      IconButton("rv-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.review)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    withFilter(
      filter,
      v_flex()
        .gap(2)
        .when(!rows.length, (el) => el.child(Note("No reviews waiting on you.")))
        .children(rows),
    ),
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
 *   filter?(key: string): { summary: object, panel: object | null } }} actions
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
      ...(filter ? [filter.summary] : []),
      Chip(String(account.counts?.myPrs ?? prs.length), { color: t.muted }),
      IconButton("mp-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.myPrs)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    withFilter(
      filter,
      v_flex()
        .gap(2)
        .when(!rows.length, (el) => el.child(Note(account.myPrs ? "No open PRs of yours." : "Refresh to load your PRs.")))
        .children(rows),
    ),
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
      ...(filter ? [filter.summary] : []),
      Chip(hidden ? `${visible.length} shown · ${hidden} hidden by status` : `${visible.length}`, { color: t.dim }),
      IconButton("mi-all", ICONS.github, () => openUrl(searchUrl(null, account.queries.mine)), {
        tooltip: "Open the list on GitHub",
      }),
    ],
    withFilter(
      filter,
      v_flex()
        .gap(2)
        .when(!groups.length, (el) => el.child(Note("No open issues assigned to you.")))
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
                buttons: [actions.pinButton(issue), ClaudeButton("mi", issue, actions)],
              }),
            ),
          ]),
        ),
    ),
  );
}
