// Team in flight: the board's open issues in the in-flight statuses, grouped in board order,
// the longest in their status first, narrowed by the card's filter (the next milestone by
// default). The filter is written in the Board's syntax and read here, on the loaded items:
// `milestone:@next`, `milestone:v2.4,v2.5`, `no:milestone`, `assignee:lena-k,tobi-s`,
// `no:assignee`, each optionally negated with "-". Any other term is kept and ignored.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
import { boardTerm } from "./board-terms.js";
import { IN_FLIGHT_DEFAULT } from "./config.js";
import { tokenize } from "./search-terms.js";
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

export { IN_FLIGHT_DEFAULT };

/** The milestone term that stands for the next milestone, whichever that is today. */
const NEXT = "@next";

/**
 * Whether one term of the filter is about the milestone: `milestone:…` or `no:milestone`.
 * @param {{ field: string | null, values: string[] }} term The term, read.
 * @returns {boolean}
 */
const milestoneTerm = (term) =>
  term.field === "milestone" || (term.field === "no" && term.values.includes("milestone"));

/**
 * Whether an issue in flight passes the filter. Every term must hold; a term it doesn't know
 * holds. `milestone:@next` with no next milestone known (no repository, or none due) holds for
 * every issue.
 * @param {object} item The issue in flight.
 * @param {string} query The filter.
 * @param {string | null} next The next milestone's title, or null when none is known.
 * @returns {boolean}
 */
export function inFlightMatches(item, query, next) {
  return tokenize(query)
    .map(boardTerm)
    .every((term) => {
      let hit;
      if (term.field === "milestone") {
        hit = term.values.some((value) =>
          value === NEXT ? next === null || item.milestone === next : item.milestone === value,
        );
      } else if (term.field === "assignee") {
        hit = term.values.some((login) => item.assignees.includes(login));
      } else if (term.field === "no") {
        hit = term.values.every((what) =>
          what === "milestone" ? !item.milestone : what === "assignee" ? !item.assignees.length : true,
        );
      } else {
        return true;
      }
      return term.negated ? !hit : hit;
    });
}

/**
 * The filter in words, for the card's header, its filter icon and Settings › Card filters:
 * "next milestone · v2.4", "milestone v2.5 · assigned to lena-k", "every milestone".
 * @param {string} query The filter.
 * @param {string | null} [next] The next milestone's title, null when none is known, or left out
 *   where the milestones aren't loaded (Settings): then just "next milestone".
 * @returns {string}
 */
export function inFlightWords(query, next) {
  const words = [];
  let milestone = false;
  for (const term of tokenize(query).map(boardTerm)) {
    const not = term.negated ? "not " : "";
    if (term.field === "milestone") {
      milestone = true;
      for (const value of term.values) {
        if (value !== NEXT) words.push(`${not}milestone ${value}`);
        else if (next === undefined) words.push(`${not}next milestone`);
        else words.push(`${not}next milestone · ${next ?? "none known, so every milestone"}`);
      }
    } else if (term.field === "assignee") {
      words.push(`${not}assigned to ${term.values.join(", ")}`);
    } else if (term.field === "no") {
      if (term.values.includes("milestone")) {
        milestone = true;
        words.push(term.negated ? "with a milestone" : "no milestone");
      }
      if (term.values.includes("assignee")) words.push(term.negated ? "assigned" : "unassigned");
    } else if (term.token) {
      words.push(term.token);
    }
  }
  if (!milestone) words.unshift("every milestone");
  return words.join(" · ");
}

/**
 * The filter with its milestone terms replaced by one, or none for every milestone.
 * @param {string} query The filter.
 * @param {string | null} term Such as `milestone:@next`, `milestone:"v2.4"` or `no:milestone`.
 * @returns {string}
 */
export function withMilestone(query, term) {
  const kept = tokenize(query).filter((token) => !milestoneTerm(boardTerm(token)));
  return [...(term ? [term] : []), ...kept].join(" ");
}

/**
 * The filter with one person turned on or off in its `assignee:` term (one term, its values
 * split by commas, so the people are any of them).
 * @param {string} query The filter.
 * @param {string} login The person.
 * @returns {string}
 */
export function withAssigneeToggled(query, login) {
  const tokens = tokenize(query);
  const at = tokens.findIndex((token) => {
    const term = boardTerm(token);
    return term.field === "assignee" && !term.negated;
  });
  const people = at < 0 ? [] : boardTerm(tokens[at]).values;
  const next = people.includes(login) ? people.filter((each) => each !== login) : [...people, login];
  const term = next.length ? `assignee:${next.join(",")}` : null;
  if (at < 0) return term ? [...tokens, term].join(" ") : query.trim();
  if (term) tokens.splice(at, 1, term);
  else tokens.splice(at, 1);
  return tokens.join(" ");
}

/**
 * A milestone as a filter term, quoted when its title has a space or a comma.
 * @param {string} title The milestone's title.
 * @returns {string}
 */
export const milestoneTermOf = (title) => `milestone:${/[\s,]/.test(title) ? `"${title}"` : title}`;

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
 * the first five. `pinButton(item)` draws the row's pin control. The header says the filter in
 * words and ends in its filter icon, which opens the filter dialog.
 * @param {object} config The workspace's settings.
 * @param {object} model The workspace's model.
 * @param {{ query: string, filter: object | null, expanded: Set<string>,
 *   onToggleGroup(key: string, cx: object): void, pinButton(item: object): object }} options
 *   `query`: the saved filter; `filter`: its icon (`FilterIcon`).
 * @returns {object} The card.
 */
export function InFlight(config, model, options) {
  const t = theme();
  const all = model.inFlight ?? [];
  const next = model.milestones?.next ?? null;
  const items = all.filter((item) => inFlightMatches(item, options.query, next));
  const warning = warningColor(t);
  const extras = options.filter ? [options.filter] : [];
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
          items.length === all.length
            ? "Nothing in flight."
            : `Nothing in flight matches: ${inFlightWords(options.query, next)}.`,
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
  return Card("in-flight", "Team in flight", extras, body, inFlightWords(options.query, next));
}
