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
import { MilestoneMenu, milestoneRows } from "./spotlight.js";

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
 * Team in flight's milestone filter: a dropdown like the Milestone card's, on its own. "All
 * milestones" (the default), then the open milestones by due date (with a repository; with a
 * board only, the milestones of the issues in flight), then "No milestone". Each row says how
 * many of its issues are in flight. Left out while nothing in flight has a milestone and none
 * is picked.
 * @param {object} t The theme.
 * @param {object} model The workspace's model.
 * @param {object[]} items Every issue in flight.
 * @param {object} options The card's options.
 * @returns {object | null} The dropdown.
 */
function milestoneFilter(t, model, items, options) {
  const picked = options.milestone ?? null;
  const inFlight = (title) => items.filter((item) => item.milestone === title).length;
  const words = (count) => (count ? `${count} in flight` : "none in flight");
  let rows;
  if (model.milestones) {
    rows = milestoneRows(t, model.milestones, (milestone) => words(inFlight(milestone.title)));
  } else {
    const titles = [...new Set(items.map((item) => item.milestone).filter(Boolean))];
    if (picked && !titles.includes(picked)) titles.push(picked);
    titles.sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
    rows = [
      ...(titles.length ? [{ heading: "Milestones in flight" }] : []),
      ...titles.map((title) => ({ key: `ms:${title}`, title, right: words(inFlight(title)) })),
    ];
  }
  if (!rows.length && picked === null) return null;
  return MilestoneMenu("if-milestone", {
    open: options.menuOpen,
    label: picked === null ? "All milestones" : picked === "" ? "No milestone" : picked,
    rows: [
      { key: "all", title: "All milestones", right: words(items.length) },
      ...rows,
      { key: "none", title: "No milestone", right: words(inFlight(null)) },
    ],
    picked: picked === null ? "all" : picked === "" ? "none" : `ms:${picked}`,
    tooltip: "Show the issues in flight in one milestone",
    anchor: "top_right",
    onToggle: (cx) => options.onToggleMenu(cx),
    onOutside: (cx) => options.onCloseMenu(cx),
    onPick: (key, cx) => options.onPick(key === "all" ? null : key === "none" ? "" : key.slice(3), cx),
  });
}

/**
 * The in-flight card. `expanded` is the set of status groups that show every row; the rest show
 * the first five. `pinButton(item)` draws the row's pin control. The header has the card's own
 * milestone filter, a dropdown: All milestones, one milestone, or No milestone.
 * @param {object} config The workspace's settings.
 * @param {object} model The workspace's model.
 * @param {object} options `{ milestone, menuOpen, onToggleMenu(cx), onCloseMenu(cx), onPick(milestone, cx),
 *   expanded, onToggleGroup(key, cx), pinButton }`. `milestone`: null for All milestones, "" for
 *   No milestone, else a milestone's title.
 * @returns {object} The card.
 */
export function InFlight(config, model, options) {
  const t = theme();
  const all = model.inFlight ?? [];
  const picked = options.milestone ?? null;
  const items = picked === null ? all : all.filter((item) => (item.milestone ?? "") === picked);
  const warning = warningColor(t);
  const filter = milestoneFilter(t, model, all, options);
  const extras = filter ? [filter] : [];
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
    .when(!groups.length, (el) =>
      el.child(
        Note(
          picked === null
            ? "Nothing in flight."
            : picked === ""
              ? "Nothing in flight without a milestone."
              : `Nothing in flight in ${picked}.`,
        ),
      ),
    )
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
