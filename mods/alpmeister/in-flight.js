// Team in flight: the board's open issues in the in-flight statuses, grouped in board order,
// the longest in their status first.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
import {
  Card,
  itemKey,
  Chip,
  GroupHeading,
  NeedsYou,
  Note,
  Row,
  TextButton,
  ago,
  statusColor,
  warningColor,
} from "./ui.js";

const GROUP_LIMIT = 5;

/**
 * The chip for a linked PR: its review state in the pane header's colors.
 * @param {object} t The theme.
 * @param {object} item The issue the PR closes.
 * @param {{ number: number, reviewDecision: string | null }} pr The linked PR.
 * @param {string} [prefix] Keeps the chip's id unique per list.
 * @returns {object} The chip.
 */
export function prChip(t, item, pr, prefix = "if") {
  const id = `${prefix}-pr-${itemKey(item)}-${pr.number}`;
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return NeedsYou(`#${pr.number} changes`).id(id).tooltip("Changes requested");
  if (pr.reviewDecision === "APPROVED")
    return Chip(`#${pr.number} approved`, { color: t.done, id, tooltip: "Approved, not merged" });
  return Chip(`#${pr.number}`, { id, tooltip: "Review required" });
}

/**
 * The in-flight card. `expanded` is the set of status groups that show every row; the rest show
 * the first five. `pinButton(item)` draws the row's pin control.
 * @param {object} config The workspace's settings.
 * @param {object} model The workspace's model.
 * @param {object} options `{ milestoneOnly, onToggleMilestone(cx), expanded, onToggleGroup(key, cx), pinButton }`.
 * @returns {object} The card.
 */
export function InFlight(config, model, options) {
  const t = theme();
  const nextMilestone = model.milestone?.title;
  // A remembered "Only <milestone>" waits while the workspace has no next milestone.
  const milestoneOnly = options.milestoneOnly && Boolean(nextMilestone);
  const items = (model.inFlight ?? []).filter((item) => !milestoneOnly || item.milestone === nextMilestone);
  const warning = warningColor(t);
  const extras = nextMilestone
    ? [
        TextButton(
          "if-milestone-only",
          milestoneOnly ? `Only ${nextMilestone}` : "All milestones",
          (cx) => options.onToggleMilestone(cx),
          { tooltip: "Switch between every in-flight issue and the next milestone's" },
        ),
      ]
    : [];
  // The longest in their status first.
  const order = (first, second) => (first.since ?? 0) - (second.since ?? 0);
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
            const chips = [
              Chip(item.assignees.length ? item.assignees.join(", ") : "Unassigned", {
                color: item.assignees.length ? t.muted : warning,
              }),
            ];
            if (item.milestone) chips.push(Chip(item.milestone, { color: t.dim }));
            if (item.since) chips.push(Chip(`${ago(now - item.since)} in status`, { color: t.dim }));
            for (const pr of item.prs) chips.push(prChip(t, item, pr));
            return Row(`if-${itemKey(item)}`, {
              number: item.number,
              repo: item.repo !== config.repo ? item.repo : null,
              title: item.title,
              url: item.url,
              chips,
              buttons: [options.pinButton({ kind: "issue", ...item })],
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
