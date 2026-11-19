// Team in flight: the board's open issues in the in-flight statuses, grouped in board order.
// An issue outside the current iteration gets a flag naming the iteration it is in.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
import {
  Card,
  Chip,
  GroupHeading,
  NeedsYou,
  Note,
  Row,
  TextButton,
  Toggle,
  ago,
  daysUntil,
  statusColor,
} from "./ui.js";

const GROUP_LIMIT = 5;

/** The chip for a linked PR: its review state in the pane header's colors. */
function prChip(t, item, pr) {
  const id = `if-pr-${item.number}-${pr.number}`;
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return NeedsYou(`#${pr.number} changes`).id(id).tooltip("Changes requested");
  if (pr.reviewDecision === "APPROVED")
    return Chip(`#${pr.number} approved`, { color: t.done, id, tooltip: "Approved, not merged" });
  return Chip(`#${pr.number}`, { id, tooltip: "Review required" });
}

/**
 * The in-flight card. `options`: `{ milestoneOnly, onToggleMilestone, iterationOnly,
 * onToggleIteration, expanded, onToggleGroup,
 * pinButton }`. `expanded` is the set of status groups that show every row; the rest show
 * the first five. `pinButton(item)` draws the row's pin control.
 */
export function InFlight(config, model, options) {
  const t = theme();
  const iteration = model.iteration;
  const nextMilestone = model.milestone?.title;
  const items = (model.inFlight ?? [])
    .filter((item) => !options.milestoneOnly || item.milestone === nextMilestone)
    .filter((item) => !options.iterationOnly || !iteration || item.iteration === iteration.title);
  const warning = t.ansi3 ?? t.working;
  const extras = [
    iteration
      ? Chip(`${iteration.title} · ${daysUntil(iteration.end)}d left`, { color: t.muted })
      : Chip("No current iteration", { color: warning }),
    TextButton(
      "if-milestone-only",
      options.milestoneOnly ? `Only ${nextMilestone}` : "All milestones",
      (cx) => options.onToggleMilestone(cx),
      { tooltip: "Switch between every in-flight issue and the next milestone's" },
    ),
    Toggle(
      "if-iteration-only",
      "Current iteration",
      options.iterationOnly,
      (cx) => options.onToggleIteration(cx),
      "Show only issues in the current iteration",
    ),
  ];
  const outsideIteration = (item) => !iteration || item.iteration !== iteration.title;
  // Flagged rows first, then the longest in their status.
  const order = (first, second) =>
    Number(outsideIteration(second)) - Number(outsideIteration(first)) || (first.since ?? 0) - (second.since ?? 0);
  const statuses = [...config.inFlight.statuses, null];
  const groups = statuses
    .map((status) => ({
      status,
      items: items
        .filter((item) => (status === null ? !config.inFlight.statuses.includes(item.status) : item.status === status))
        .sort(order),
    }))
    .filter((group) => group.items.length);
  const now = Date.now();
  const body = v_flex()
    .gap(2)
    .when(items.filter(outsideIteration).length > 0, (el) =>
      el.child(
        Note(`${items.filter(outsideIteration).length} of ${items.length} not in the current iteration`, warning),
      ),
    )
    .when(!groups.length, (el) => el.child(Note("Nothing in flight.")))
    .children(
      groups.flatMap((group) => {
        const key = group.status ?? "Other";
        const open = options.expanded.has(key);
        const shown = open ? group.items : group.items.slice(0, GROUP_LIMIT);
        const more = group.items.length - GROUP_LIMIT;
        return [
          GroupHeading(key, group.items.length, statusColor(t, group.status)),
          ...shown.map((item) => {
            const chips = [];
            if (outsideIteration(item)) {
              chips.push(
                Chip(item.iteration ?? "No iteration", {
                  color: warning,
                  id: `if-it-${item.number}`,
                  tooltip: "Not in the current iteration",
                }),
              );
            }
            chips.push(
              Chip(item.assignees.length ? item.assignees.join(", ") : "Unassigned", {
                color: item.assignees.length ? t.muted : warning,
              }),
            );
            if (item.milestone) chips.push(Chip(item.milestone, { color: t.dim }));
            if (item.since) chips.push(Chip(`${ago(now - item.since)} in status`, { color: t.dim }));
            for (const pr of item.prs) chips.push(prChip(t, item, pr));
            return Row(`if-${item.number}`, {
              number: item.number,
              title: item.title,
              url: item.url,
              chips,
              buttons: [options.pinButton({ kind: "issue", number: item.number, title: item.title, url: item.url, status: item.status })],
            });
          }),
          ...(more > 0
            ? [
                TextButton(`if-more-${key}`, open ? "Show less" : `Show ${more} more`, (cx) =>
                  options.onToggleGroup(key, cx),
                ),
              ]
            : []),
        ];
      }),
    )
    .when(model.inFlightTotal > (model.inFlight ?? []).length, (el) =>
      el.child(
        div()
          .pt(6)
          .child(Note(`Showing ${model.inFlight.length} of ${model.inFlightTotal}.`)),
      ),
    );
  return Card("in-flight", "Team in flight", extras, body);
}
