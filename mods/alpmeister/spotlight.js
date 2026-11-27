// The Milestone card: one milestone of the workspace, picked in its header ("Next", which moves
// on by itself, or one picked by hand), how it is going (closed of total, the due date, the time
// from its start to its due date with today's tick, the board statuses and the flags), then its
// issues in focus (priorities and features) and those on hold. Also the milestone dropdown, which
// Team in flight's own filter uses too.

import { div } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import {
  Bar,
  Chip,
  GroupHeading,
  ICONS,
  LinkLabel,
  Note,
  Row,
  TextButton,
  daysUntil,
  formatDate,
  itemKey,
  openUrl,
  statusColor,
  typeColor,
  warningColor,
} from "./ui.js";

const LANE_LIMIT = 8;
const WEEK_DAYS = 7;

/**
 * A list's first rows, then its "Show N more" button.
 * @param {string} key Names the list in `options.expanded`.
 * @param {object[]} rows The rows.
 * @param {{ expanded: Set<string>, onToggleGroup(key: string, cx: object): void }} options
 * @returns {object[]} The rows to draw.
 */
function limited(key, rows, options) {
  const open = options.expanded.has(key);
  const more = rows.length - LANE_LIMIT;
  const toggle = TextButton(`sp-more-${key}`, open ? "Show less" : `Show ${more} more`, (cx) =>
    options.onToggleGroup(key, cx),
  );
  return [...(open ? rows : rows.slice(0, LANE_LIMIT)), ...(more > 0 ? [toggle] : [])];
}

/**
 * A milestone's due date in words: "Due Wed 2 Dec · 5d left", "Overdue · was due Wed 18 Nov",
 * "No due date", and its color.
 * @param {object} t The theme.
 * @param {{ due: number | null, overdue: boolean }} milestone The milestone.
 * @returns {{ text: string, color: string }}
 */
export function dueWords(t, milestone) {
  if (milestone.due == null) return { text: "No due date", color: t.dim };
  const due = formatDate(milestone.due, { utc: true });
  if (milestone.overdue) return { text: `Overdue · was due ${due}`, color: t.blocked };
  const left = daysUntil(milestone.due);
  return { text: `Due ${due} · ${left}d left`, color: left < WEEK_DAYS ? warningColor(t) : t.muted };
}

/**
 * The milestone dropdown: a button naming the shown choice ("v2.4 · next ▾"), and while open a
 * list under it. A row is `{ key, title, tag, sub, subColor, right }`, or `{ heading }` for a
 * dim line between groups. Picking a row calls `onPick(key, cx)`.
 * @param {string} id A unique element id.
 * @param {{ open: boolean, label: string, tag?: string | null, rows: object[], picked: string,
 *   onToggle(cx: object): void, onOutside(cx: object): void, onPick(key: string, cx: object): void,
 *   tooltip?: string, anchor?: string }} options `picked` is the key of the row shown as chosen;
 *   `anchor` is the button's corner the list hangs from: "top_left" (default) or "top_right"
 *   for a button at a card's right end.
 * @returns {object} The button, with its list while open.
 */
export function MilestoneMenu(id, { open, label, tag, rows, picked, onToggle, onOutside, onPick, tooltip, anchor = "top_left" }) {
  const t = theme();
  const trigger = h_flex()
    .id(`${id}-button`)
    .flex_none()
    .h(24)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(open ? t.accent : t.border)
    .bg(t.background)
    .cursor_pointer()
    .hover((style) => style.border_color(t.input))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onToggle(cx);
    })
    .when(Boolean(tooltip) && !open, (el) => el.tooltip(tooltip))
    .text_size(12)
    .text_color(t.foreground)
    .child(div().font_medium().child(label))
    .when(Boolean(tag), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`· ${tag}`)))
    .child(div().text_size(11.5).text_color(t.dim).child("▾"));
  if (!open) return trigger;
  const list = v_flex()
    .id(`${id}-list`)
    .mt(28)
    .w(300)
    .p(4)
    .gap(1)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .shadow_lg()
    .on_mouse_down_out((_event, cx) => onOutside(cx))
    .children(
      rows.map((row, index) =>
        row.heading
          ? div()
              .px(8)
              .pt(index ? 6 : 2)
              .pb(2)
              .text_size(11.5)
              .font_medium()
              .text_color(t.dim)
              .child(row.heading)
          : h_flex()
              .id(`${id}-row-${index}`)
              .px(8)
              .py(4)
              .gap(8)
              .items_center()
              .rounded(5)
              .cursor_pointer()
              .hover((style) => style.bg(t.hover))
              .when(row.key === picked, (el) => el.bg(t.selected))
              .on_click((_event, cx) => onPick(row.key, cx))
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .child(
                    h_flex()
                      .gap(6)
                      .items_baseline()
                      .text_size(12)
                      .text_color(row.key === picked ? t.accent : t.foreground)
                      .child(div().font_medium().child(row.title))
                      .when(Boolean(row.tag), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(row.tag))),
                  )
                  .when(Boolean(row.sub), (el) =>
                    el.child(div().truncate().text_size(11.5).text_color(row.subColor ?? t.dim).child(row.sub)),
                  ),
              )
              .when(Boolean(row.right), (el) =>
                el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(row.right)),
              ),
      ),
    );
  return Popup.new(`${id}-popup`, trigger).anchor(anchor).content(list);
}

/**
 * One issue: its type beside the number, then an epic's sub-issue progress, its board status
 * (with a board), and who it is assigned to (orange when nobody). No priority or label chip, so
 * the title keeps its room on a half-width card.
 * @param {object} t The theme.
 * @param {object} config The workspace's config.
 * @param {string} prefix Keeps the row's id unique per list.
 * @param {object} issue The issue.
 * @param {object} options The card's options.
 * @returns {object} The row.
 */
function issueRow(t, config, prefix, issue, options) {
  const chips = [];
  if (issue.type === "Epic" && issue.subIssues.total) {
    chips.push(Chip(`${issue.subIssues.completed} of ${issue.subIssues.total}`, { color: t.muted }));
  }
  if (config.board) chips.push(Chip(issue.status ?? "No status", { color: statusColor(t, issue.status) }));
  chips.push(
    issue.assignees.length
      ? Chip(issue.assignees.join(", "), { color: t.muted })
      : Chip("Unassigned", { color: warningColor(t) }),
  );
  return Row(`${prefix}-${itemKey(issue)}`, {
    number: issue.number,
    lead: [Chip(issue.type ?? "No type", { color: typeColor(t, issue.type) })],
    title: issue.title,
    url: issue.url,
    chips,
    buttons: [options.pinButton({ kind: "issue", ...issue })],
  });
}

/**
 * A heading over one of the card's lists: "Issues 5", and buttons on its right.
 * @param {object} t The theme.
 * @param {string} name The heading.
 * @param {number} count How many the list holds.
 * @param {object[]} [extras] Buttons on its right.
 * @returns {object}
 */
function ListHeading(t, name, count, extras = []) {
  return h_flex()
    .pt(4)
    .gap(6)
    .items_center()
    .text_size(12)
    .child(div().font_semibold().text_color(t.foreground).child(name))
    .child(div().text_size(11.5).text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .children(extras);
}

/**
 * A flag on the progress band, as a button: "1 unassigned", "3 not started". A press lists its
 * issues in place of the card's Issues; while they are listed it is outlined, and a press again
 * lists the Issues again.
 * @param {string} id The element id.
 * @param {string} text The words.
 * @param {string} color Its color.
 * @param {boolean} on Whether its issues are listed now.
 * @param {object[]} issues Its issues, for the tooltip.
 * @param {(cx: object) => void} onPress Called on a press.
 * @returns {object}
 */
function Flag(id, text, color, on, issues, onPress) {
  const t = theme();
  return h_flex()
    .id(id)
    .flex_none()
    .px(7)
    .h(22)
    .items_center()
    .rounded(5)
    .border_1()
    .border_color(on ? color : t.background)
    .bg(`${color}26`)
    .text_size(11.5)
    .text_color(color)
    .cursor_pointer()
    .hover((style) => style.border_color(color))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onPress(cx);
    })
    .tooltip(`${on ? "List the Issues again" : "List these"}:\n${issues.map((issue) => `#${issue.number} ${issue.title}`).join("\n")}`)
    .child(text);
}

/**
 * The progress band: closed of total (orange when behind schedule, without words for it), the
 * due date, the flags, the time from the start to the due date with today's tick, and the board
 * statuses.
 * "No milestone" has no due date or total: only its open issues, by status, and its flags.
 * @param {object} t The theme.
 * @param {object} config The workspace's config.
 * @param {object} shown The shown milestone, or "No milestone"'s parts with `none: true`.
 * @param {{ flag: string | null, onFlag(name: string, cx: object): void }} options
 * @returns {object}
 */
function ProgressBand(t, config, shown, options) {
  const now = Date.now();
  const fraction = shown.total ? shown.closed / shown.total : 0;
  const span = shown.due != null && shown.start != null && shown.due > shown.start ? shown.due - shown.start : null;
  const elapsed = span ? Math.max(0, Math.min(1, (now - shown.start) / span)) : null;
  const behind = elapsed != null && fraction < elapsed && shown.closed < shown.total;
  // A milestone whose time starts later (after the one before it is due).
  const ahead = shown.start != null && shown.start > now;
  const color = behind ? warningColor(t) : t.accent;
  const due = shown.none ? null : dueWords(t, shown);
  const nearDeadline = shown.overdue || (shown.due != null && daysUntil(shown.due) < WEEK_DAYS);
  const flags = [];
  if (shown.unassigned.length) {
    flags.push(
      Flag(
        "ms-flag-unassigned",
        `${shown.unassigned.length} unassigned`,
        warningColor(t),
        options.flag === "unassigned",
        shown.unassigned,
        (cx) => options.onFlag("unassigned", cx),
      ),
    );
  }
  if (shown.notStarted.length) {
    flags.push(
      Flag(
        "ms-flag-not-started",
        `${shown.notStarted.length} not started`,
        nearDeadline ? t.blocked : t.muted,
        options.flag === "notStarted",
        shown.notStarted,
        (cx) => options.onFlag("notStarted", cx),
      ),
    );
  }
  const order = [
    ...config.statuses,
    ...Object.keys(shown.byStatus).filter((status) => !config.statuses.includes(status)),
  ];
  const present = order.filter((status) => shown.byStatus[status]);
  const counted = present.reduce((sum, status) => sum + shown.byStatus[status], 0);
  const headline = shown.none ? `${shown.openCount} open` : `${shown.closed} of ${shown.total} closed`;
  const startTip = shown.startFrom != null ? `The day ${shown.startFrom} was due` : "The day the milestone was created";
  return v_flex()
    .gap(8)
    .child(
      h_flex()
        .flex_wrap()
        .items_center()
        .gap(10)
        .child(div().text_size(18).font_semibold().text_color(shown.none ? t.foreground : color).child(headline))
        .when(Boolean(due), (el) => el.child(Chip(due.text, { color: due.color })))
        .child(div().flex_1())
        .children(flags),
    )
    .when(!shown.none && shown.total > 0 && shown.due != null, (el) =>
      el.child(
        v_flex()
          .gap(4)
          .child(
            div()
              .id("ms-time-bar")
              .tooltip(
                elapsed == null
                  ? `${Math.round(fraction * 100)}% closed`
                  : `${Math.round(fraction * 100)}% closed; today's tick: ${Math.round(elapsed * 100)}% of the time from the start to the due date gone`,
              )
              .child(Bar(fraction, color, elapsed)),
          )
          .when(elapsed != null, (col) =>
            col.child(
              h_flex()
                .gap(8)
                .text_size(11.5)
                .text_color(t.dim)
                .child(
                  div()
                    .id("ms-start")
                    .flex_none()
                    .tooltip(startTip)
                    .child(`${ahead ? "Starts" : "Started"} ${formatDate(shown.start, { utc: shown.startFrom != null })}`),
                )
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_center()
                    .child(
                      `Today, ${formatDate(now)} · ${
                        ahead
                          ? `starts in ${daysUntil(shown.start)}d`
                          : shown.overdue
                            ? `${Math.max(1, Math.floor((now - shown.due) / 86400000))}d past the due date`
                            : `${Math.round(elapsed * 100)}% of the time gone`
                      }, ${Math.round(fraction * 100)}% closed`,
                    ),
                )
                .child(div().flex_none().child(`Due ${formatDate(shown.due, { utc: true })}`)),
            ),
          ),
      ),
    )
    .when(counted > 0, (el) =>
      el
        .child(
          h_flex()
            .w_full()
            .h(6)
            .rounded(3)
            .overflow_hidden()
            .children(
              present.map((status) =>
                div()
                  .h_full()
                  .w(`${(shown.byStatus[status] / counted) * 100}%`)
                  .bg(statusColor(t, status)),
              ),
            ),
        )
        .child(
          h_flex()
            .flex_wrap()
            .gap(6)
            .children(present.map((status) => Chip(`${status} ${shown.byStatus[status]}`, { color: statusColor(t, status) }))),
        ),
    );
}

/** Each flag's list heading, and where its issues sit on the shown milestone. */
const FLAG_LISTS = { unassigned: ["Unassigned", "unassigned"], notStarted: ["Not started", "notStarted"] };

/**
 * The Milestone card's choice, in the dropdown's keys: "next", "none" or "ms:<title>".
 * @param {string | null} pick null for Next, "" for No milestone, else a milestone's title.
 * @returns {string}
 */
const pickKey = (pick) => (pick === null ? "next" : pick === "" ? "none" : `ms:${pick}`);

/**
 * A dropdown key back as a choice: null for Next, "" for No milestone, else the title.
 * @param {string} key "next", "none" or "ms:<title>".
 * @returns {string | null}
 */
const keyPick = (key) => (key === "next" ? null : key === "none" ? "" : key.slice(3));

/**
 * The dropdown's rows for a workspace's open milestones, by due date (overdue ones in red),
 * each with how many issues are open. Shared with Team in flight's filter.
 * @param {object} t The theme.
 * @param {{ list: object[], next: string | null }} data The workspace's milestones.
 * @param {(milestone: object) => string} [right] The words on a row's right; its open issues by default.
 * @returns {object[]} The rows.
 */
export function milestoneRows(t, data, right = (milestone) => `${milestone.openCount} open`) {
  return [
    ...(data.list.length ? [{ heading: "Open milestones, by due date" }] : []),
    ...data.list.map((milestone) => {
      const due = dueWords(t, milestone);
      return {
        key: `ms:${milestone.title}`,
        title: milestone.title,
        tag: milestone.title === data.next ? "next" : null,
        sub: due.text,
        subColor: milestone.overdue ? t.blocked : t.dim,
        right: right(milestone),
      };
    }),
  ];
}

/**
 * A link in the Milestone card's header, in the accent: its words, with the icon on their left
 * when given (the GitHub mark on one that opens GitHub; none for one that stays in Alp).
 * @param {object} t The theme.
 * @param {string} id The element id.
 * @param {string | null} icon The icon's path, or null for none.
 * @param {string} text The words.
 * @param {string} tooltip The tooltip.
 * @param {(cx: object) => void} onPress Called on a click.
 * @returns {object} The link.
 */
function HeaderLink(t, id, icon, text, tooltip, onPress) {
  return div()
    .id(id)
    .flex_none()
    .text_size(11.5)
    .font_medium()
    .text_color(t.accent)
    .cursor_pointer()
    .hover((style) => style.text_color(t.foreground))
    .tooltip(tooltip)
    .on_click((_event, cx) => onPress(cx))
    .child(LinkLabel(icon, text));
}

/**
 * The Milestone card. The header holds the dropdown ("v2.4 · next ▾"), "Back to next (v2.4)"
 * while a milestone is picked by hand (the card is then outlined in the accent), "On GitHub →"
 * (the milestone, or the open issues without one, on GitHub; the GitHub mark on its left), and
 * "Open v2.4 on the Board →" when the workspace has a board. Then the progress band, "Issues" (the open
 * issues with a priority, a prioritizing label or a feature type) and the issues on hold (left
 * out when none). A pressed flag lists its issues in place of the Issues.
 * @param {object} config The workspace's settings.
 * @param {object} model The workspace's model, with `milestones` from data.js.
 * @param {{ expanded: Set<string>, onToggleGroup: Function, pinButton: Function,
 *   pick: string | null, menuOpen: boolean, onToggleMenu(cx: object): void, onCloseMenu(cx: object): void,
 *   onPick(pick: string | null, cx: object): void, noMilestone: { parts?: object, error?: string } | null,
 *   flag: string | null, onFlag(name: string, cx: object): void,
 *   onBoard: ((title: string | null, cx: object) => void) | null }} options `pick`: null for Next,
 *   "" for No milestone, else an open milestone's title. `noMilestone`: the open issues without a
 *   milestone, fetched when picked. `onBoard` is null without a board; it gets null for No milestone.
 * @returns {object} The card.
 */
export function MilestoneCard(config, model, options) {
  const t = theme();
  const data = model.milestones;
  const card = (header, body, outlined = false) =>
    v_flex()
      .id("milestone")
      .min_w(0)
      .p(14)
      .gap(10)
      .rounded(10)
      .bg(t.background)
      .border_1()
      .border_color(outlined ? t.accent : t.border)
      .child(header)
      .child(body);
  const title = div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("Milestone");
  if (!data) return card(h_flex().child(title), Note("Refresh to load the milestones."));
  const next = data.list.find((milestone) => milestone.title === data.next) ?? null;
  const picked = options.pick;
  const shown =
    picked === null
      ? next
      : picked === ""
        ? { none: true, title: null, ...(options.noMilestone?.parts ?? {}) }
        : (data.list.find((milestone) => milestone.title === picked) ?? next);
  const byHand = picked !== null;
  const rows = [
    {
      key: "next",
      title: "Next",
      sub: next ? `Always the next one · now ${next.title}` : "Always the next one · none due ahead",
    },
    ...milestoneRows(t, data),
    { key: "none", title: "No milestone", right: `${data.noMilestone.count} open` },
  ];
  const menu = MilestoneMenu("ms-menu", {
    open: options.menuOpen,
    label: picked === "" ? "No milestone" : (shown?.title ?? "Next"),
    tag: picked === null && next ? "next" : null,
    rows,
    picked: pickKey(picked),
    tooltip: "Pick the milestone this card shows",
    onToggle: (cx) => options.onToggleMenu(cx),
    onOutside: (cx) => options.onCloseMenu(cx),
    onPick: (key, cx) => options.onPick(keyPick(key), cx),
  });
  const boardTitle = shown?.none ? "No milestone" : shown?.title;
  const githubUrl = shown?.none
    ? config.repo && searchUrl(config.repo, "is:issue is:open no:milestone")
    : (shown?.url ?? null);
  const header = h_flex()
    .flex_wrap()
    .items_center()
    .gap(8)
    .child(title)
    .child(menu)
    .when(byHand, (el) =>
      el.child(
        TextButton("ms-back", next ? `Back to next (${next.title})` : "Back to next", (cx) => options.onPick(null, cx), {
          tooltip: "Show the next milestone again; it moves on by itself",
        }),
      ),
    )
    .child(div().flex_1())
    .child(
      h_flex()
        .flex_none()
        .gap(14)
        .items_center()
        .when(Boolean(githubUrl), (el) =>
          el.child(
            HeaderLink(
              t,
              "ms-github",
              ICONS.github,
              "On GitHub →",
              shown?.none ? "The open issues without a milestone, on GitHub" : `Open ${boardTitle} on GitHub`,
              () => openUrl(githubUrl),
            ),
          ),
        )
        .when(Boolean(options.onBoard && boardTitle), (el) =>
          el.child(
            HeaderLink(
              t,
              "ms-board",
              null,
              shown?.none ? "Open on the Board →" : `Open ${boardTitle} on the Board →`,
              `The Board with only ${shown?.none ? "the items without a milestone" : `the items in ${boardTitle}`}`,
              (cx) => options.onBoard(shown.none ? null : shown.title, cx),
            ),
          ),
        ),
    );
  if (!shown) {
    const words = data.list.length ? "No open milestone with a due date ahead." : "No open milestones.";
    return card(header, Note(words), byHand);
  }
  if (shown.none && !options.noMilestone?.parts) {
    const error = options.noMilestone?.error;
    return card(
      header,
      Note(error ? `GitHub: ${error}` : "Loading the issues without a milestone…", error ? t.blocked : undefined),
      byHand,
    );
  }
  const flag = FLAG_LISTS[options.flag] ? options.flag : null;
  const [flagName, flagKey] = flag ? FLAG_LISTS[flag] : [];
  const listed = flag ? shown[flagKey] : shown.issues;
  const prefix = `sp-${shown.title ?? "none"}`;
  const rowsOf = (issues, key) => issues.map((issue) => issueRow(t, config, key, issue, options));
  const hold = shown.onHold ?? [];
  const body = v_flex()
    .gap(10)
    .child(ProgressBand(t, config, shown, { flag, onFlag: options.onFlag }))
    .child(
      v_flex()
        .gap(2)
        .child(
          ListHeading(
            t,
            flag ? flagName : "Issues",
            listed.length,
            flag ? [TextButton("ms-flag-clear", "Back to Issues", (cx) => options.onFlag(flag, cx))] : [],
          ),
        )
        .children(
          listed.length
            ? limited(`${prefix}-${flag ?? "issues"}`, rowsOf(listed, `${prefix}-${flag ?? "i"}`), options)
            : [Note(flag ? "None." : "Nothing prioritized or planned.")],
        ),
    )
    .when(!flag && hold.length > 0, (el) =>
      el.child(
        v_flex()
          .gap(2)
          .child(GroupHeading(config.spotlight.holdStatus || "On hold", hold.length, t.blocked))
          .children(limited(`${prefix}-hold`, rowsOf(hold, `${prefix}-hold`), options)),
      ),
    );
  return card(header, body, byHand);
}
