// Spotlight: the project's focal point, what the next milestones hold, derived from the issues alone. Each milestone
// lists its open issues with a priority value, a prioritizing label or a feature type, most
// urgent first, each with its issue type. Issues on hold in those milestones show below, to discuss.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { priorityColor } from "./project.js";
import { Card, Chip, GroupHeading, Note, Row, TextButton, itemKey, openUrl, statusColor, typeColor, warningColor } from "./ui.js";

const LANE_LIMIT = 8;

/** A list's first rows, then its "Show N more" button. `key` names the list in `expanded`. */
function limited(key, rows, options) {
  const open = options.expanded.has(key);
  const more = rows.length - LANE_LIMIT;
  const toggle = TextButton(`sp-more-${key}`, open ? "Show less" : `Show ${more} more`, (cx) =>
    options.onToggleGroup(key, cx),
  );
  return [...(open ? rows : rows.slice(0, LANE_LIMIT)), ...(more > 0 ? [toggle] : [])];
}

/**
 * One issue: its type beside the number, then its priority or prioritizing label, an epic's
 * sub-issue progress, its board status, and a flag when unassigned.
 * @param {object} t The theme.
 * @param {object} config The workspace's config.
 * @param {string} prefix Keeps the row's id unique per list.
 * @param {object} issue The issue.
 * @param {object} options The card's options.
 * @param {object[]} [extraChips] Chips to put first.
 * @returns {object} The row.
 */
function issueRow(t, config, prefix, issue, options, extraChips = []) {
  const chips = [...extraChips];
  const label = issue.labels.find((name) => config.spotlight.labels.includes(name));
  if (issue.priority) chips.push(Chip(issue.priority, { color: priorityColor(t, config, issue.priority) }));
  else if (label) chips.push(Chip(label, { color: t.accent }));
  if (issue.type === "Epic" && issue.subIssues.total) {
    chips.push(Chip(`${issue.subIssues.completed} of ${issue.subIssues.total}`, { color: t.muted }));
  }
  chips.push(Chip(issue.status ?? "No status", { color: statusColor(t, issue.status) }));
  if (!issue.assignees.length) chips.push(Chip("Unassigned", { color: warningColor(t) }));
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
 * One milestone's column: its title, then its issues.
 * @param {object} t The theme.
 * @param {object} config The workspace's config.
 * @param {object} lane The milestone and its issues.
 * @param {object} options The card's options.
 * @returns {object} The column.
 */
function Lane(t, config, lane, options) {
  const prefix = `sp-${lane.title}`;
  const rows = lane.issues.map((issue) => issueRow(t, config, prefix, issue, options));
  return v_flex()
    .flex_1()
    .min_w(0)
    .gap(2)
    .child(
      h_flex()
        .id(`${prefix}-title`)
        .items_baseline()
        .gap(8)
        .pb(4)
        .cursor_pointer()
        .on_click(() => openUrl(lane.url))
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(lane.title))
        .child(div().text_size(11.5).text_color(t.dim).child(String(lane.issues.length))),
    )
    .children(rows.length ? limited(prefix, rows, options) : [Note("Nothing prioritized or planned.")]);
}

/**
 * The spotlight card. `options`: `{ wide, expanded, onToggleGroup, pinButton }`. `expanded`
 * is the set of lists that show every row; the rest show the first eight. The title's note says
 * which issues it lists: those with a priority, a prioritizing label or a feature type.
 * @param {object} config The workspace's settings.
 * @param {object} model The workspace's model, with `spotlight` from data.js.
 * @param {{ wide: boolean, expanded: Set<string>, onToggleGroup: Function, pinButton: Function }} options
 * @returns {object} The card.
 */
export function Spotlight(config, model, options) {
  const t = theme();
  const data = model.spotlight;
  if (!data) return Card("spotlight", "Spotlight", [], Note("Refresh to load the spotlight."));
  if (!data.milestones.length) return Card("spotlight", "Spotlight", [], Note("No open milestone with a due date ahead."));
  const lanes = data.milestones.map((lane) => Lane(t, config, lane, options));
  // Without a board there are no statuses, so nothing can be on hold: the group is left out.
  const discuss = (data.onHold ?? []).map((issue) =>
    issueRow(t, config, "sp-hold", issue, options, [Chip(issue.milestone, { color: t.dim })]),
  );
  const count = data.milestones.length;
  const note = `priorities and features in the next ${count === 1 ? "milestone" : `${count} milestones`}`;
  return Card(
    "spotlight",
    "Spotlight",
    [],
    v_flex()
      .gap(10)
      .child(options.wide ? h_flex().gap(18).items_start().children(lanes) : v_flex().gap(14).children(lanes))
      .when(data.onHold !== null, (el) =>
        el.child(
          v_flex()
            .gap(2)
            .child(GroupHeading(config.spotlight.holdStatus || "On hold", discuss.length, t.blocked))
            .children(discuss.length ? limited("sp-hold", discuss, options) : [Note("Nothing on hold.")]),
        ),
      ),
    note,
  );
}
