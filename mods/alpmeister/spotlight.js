// Spotlight: the project's focal point, what the next milestones hold, derived from the issues alone. Each milestone
// lists its open issues with a priority value, a prioritizing label or a feature type, most
// urgent first, each with its issue type. Issues on hold in those milestones show below, to discuss.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { priorityColor } from "./project.js";
import { Card, Chip, GroupHeading, Note, Row, TextButton, openUrl, statusColor, typeColor } from "./ui.js";

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
  if (!issue.assignees.length) chips.push(Chip("Unassigned", { color: t.ansi3 ?? t.working }));
  return Row(`${prefix}-${issue.number}`, {
    number: issue.number,
    lead: [Chip(issue.type ?? "No type", { color: typeColor(t, issue.type) })],
    title: issue.title,
    url: issue.url,
    chips,
    buttons: [options.pinButton({ kind: "issue", number: issue.number, title: issue.title, url: issue.url, status: issue.status })],
  });
}

/** One milestone's column: its title, then its issues. */
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
        .child(div().text_size(11).text_color(t.dim).child(String(lane.issues.length))),
    )
    .children(rows.length ? limited(prefix, rows, options) : [Note("Nothing prioritized or planned.")]);
}

/**
 * The spotlight card. `options`: `{ wide, expanded, onToggleGroup, pinButton }`. `expanded`
 * is the set of lists that show every row; the rest show the first eight.
 */
export function Spotlight(config, model, options) {
  const t = theme();
  const data = model.spotlight;
  if (!data?.milestones?.[0]?.issues) return Card("spotlight", "Spotlight", [], Note("Refresh to load the spotlight."));
  const lanes = data.milestones.map((lane) => Lane(t, config, lane, options));
  const discuss = data.onHold.map((issue) =>
    issueRow(t, config, "sp-hold", issue, options, [Chip(issue.milestone, { color: t.dim })]),
  );
  return Card(
    "spotlight",
    "Spotlight",
    [],
    v_flex()
      .gap(10)
      .child(options.wide ? h_flex().gap(18).items_start().children(lanes) : v_flex().gap(14).children(lanes))
      .child(
        v_flex()
          .gap(2)
          .child(GroupHeading(`To discuss · ${config.spotlight.holdStatus}`, discuss.length, t.blocked))
          .children(discuss.length ? limited("sp-hold", discuss, options) : [Note("Nothing on hold.")]),
      ),
  );
}
