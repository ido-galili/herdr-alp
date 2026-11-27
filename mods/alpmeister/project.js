// A workspace's status: tiles for open bugs by priority, triage bugs, customer issues and the
// nightly run, then the next milestone. `config` here is the workspace's settings.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import { Bar, Card, Chip, NeedsYou, Note, daysUntil, formatDate, formatTime, openUrl, statusColor, warningColor } from "./ui.js";

const WEEK_DAYS = 7;

/**
 * The next milestone: X of Y closed, the due date, the status strip and its flags.
 * @param {object} config The workspace's config.
 * @param {object} model The fetched model.
 * @returns {object} The card.
 */
export function Milestone(config, model) {
  const t = theme();
  const milestone = model.milestone;
  if (!milestone) return Card("milestone", "Next milestone", [], Note("No open milestone with a due date ahead."));
  const daysLeft = daysUntil(milestone.due);
  const fraction = milestone.total ? milestone.closed / milestone.total : 0;
  const elapsed =
    milestone.previousDue && milestone.due > milestone.previousDue
      ? (Date.now() - milestone.previousDue) / (milestone.due - milestone.previousDue)
      : null;
  const behind = elapsed != null && fraction < elapsed;
  const color = behind ? warningColor(t) : t.accent;
  const due = formatDate(milestone.due, { utc: true });
  const order = [
    ...config.statuses,
    ...Object.keys(milestone.byStatus).filter((status) => !config.statuses.includes(status)),
  ];
  const present = order.filter((status) => milestone.byStatus[status]);
  const flags = [];
  if (milestone.unassigned.length) {
    flags.push(
      Chip(`${milestone.unassigned.length} unassigned`, {
        color: warningColor(t),
        fill: `${warningColor(t)}26`,
        id: "flag-unassigned",
        tooltip: milestone.unassigned.map((issue) => `#${issue.number} ${issue.title}`).join("\n"),
      }),
    );
  }
  if (daysLeft < WEEK_DAYS && milestone.notStarted.length) {
    flags.push(
      NeedsYou(`${milestone.notStarted.length} not started`)
        .id("flag-not-started")
        .tooltip(milestone.notStarted.map((issue) => `#${issue.number} ${issue.status} ${issue.title}`).join("\n")),
    );
  }
  return Card(
    "milestone",
    "Next milestone",
    [Chip(`Due ${due} · ${daysLeft}d left`, { color: daysLeft < WEEK_DAYS ? warningColor(t) : t.muted })],
    v_flex()
      .gap(10)
      .child(
        h_flex()
          .id("milestone-title")
          .items_baseline()
          .gap(10)
          .cursor_pointer()
          .on_click(() => openUrl(milestone.url))
          .child(div().text_size(20).font_semibold().text_color(t.foreground).child(milestone.title))
          .child(
            div()
              .text_size(14)
              .font_medium()
              .text_color(color)
              .child(`${milestone.closed} of ${milestone.total} closed`),
          ),
      )
      .child(
        div()
          .id("milestone-bar")
          .tooltip(
            elapsed == null
              ? `${Math.round(fraction * 100)}% closed`
              : `${Math.round(fraction * 100)}% closed, ${Math.round(Math.min(1, elapsed) * 100)}% of the time since the previous milestone gone`,
          )
          .child(Bar(fraction, color, elapsed == null ? null : Math.min(1, elapsed))),
      )
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
                .w(`${(milestone.byStatus[status] / milestone.total) * 100}%`)
                .bg(statusColor(t, status)),
            ),
          ),
      )
      .child(
        h_flex()
          .flex_wrap()
          .gap(6)
          .children(
            present.map((status) => Chip(`${status} ${milestone.byStatus[status]}`, { color: statusColor(t, status) })),
          ),
      )
      .when(flags.length > 0, (el) => el.child(h_flex().gap(6).children(flags))),
  );
}

/**
 * The words that end a tile which opens a list: "See all 7 →", "See both →", "See it →".
 * @param {number | null | undefined} count How many the list holds.
 * @returns {string | null} The words, or null for an empty or unknown list.
 */
export function seeAll(count) {
  if (!count) return null;
  if (count === 1) return "See it →";
  if (count === 2) return "See both →";
  return `See all ${count} →`;
}

/** The words that end a tile whose setting is missing; a click opens Settings on it. */
export const SET_UP = "Set up in Settings →";

/**
 * One number tile: a label, a big value, then lines or any element under it, and at the
 * bottom the words that say what a click opens. `sub` is a string, an element, or a list of
 * them. `action` is a URL to open or a function to run on click.
 * @param {string} id The tile's element id.
 * @param {string} label The tile's label.
 * @param {string} value The big value.
 * @param {string | object | Array<string | object>} sub The lines under the value.
 * @param {string} color The value's color.
 * @param {string | Function | null} action A URL to open, or a function to run, on click.
 * @param {string} [note] A short clause after the label that says what the tile counts.
 * @param {{ link?: string | null, outline?: string | null }} [options] `link`: the words at the
 *   bottom, such as "See all 7 →"; `outline`: a border color, such as red for a failed run.
 * @returns {object} The tile.
 */
export function Tile(id, label, value, sub, color, action, note, { link, outline } = {}) {
  const t = theme();
  return v_flex()
    .id(id)
    .flex_1()
    .min_w(0)
    .p(12)
    .gap(4)
    .rounded(10)
    .bg(t.background)
    .border_1()
    .border_color(outline ?? t.border)
    .when(Boolean(action), (el) => el.cursor_pointer().hover((style) => style.border_color(outline ? t.blocked : t.input)))
    .on_click((_event, cx) => {
      if (typeof action === "function") action(cx);
      else if (action) openUrl(action);
    })
    .child(div().text_size(11.5).text_color(t.dim).child(note ? `${label} · ${note}` : label))
    .child(div().text_size(22).font_semibold().text_color(color).child(value))
    .children(
      (Array.isArray(sub) ? sub : [sub]).map((line) =>
        typeof line === "string" ? div().text_size(11.5).truncate().text_color(t.muted).child(line) : line,
      ),
    )
    .when(Boolean(link && action), (el) =>
      el.child(div().flex_1()).child(div().pt(2).text_size(11.5).text_color(t.accent).child(link)),
    );
}

/**
 * The color for a bug priority: the most urgent in `blocked`, unset in `dim`.
 * @param {object} t The theme.
 * @param {object} config The workspace's config, with its bug priorities in order.
 * @param {string} priority The priority.
 * @returns {string} The color: red, then orange, then the accent.
 */
export function priorityColor(t, config, priority) {
  const colors = [t.blocked, t.ansi9 ?? t.blocked, warningColor(t), t.accent];
  const index = config.bugs.priorities.indexOf(priority);
  return index < 0 ? t.dim : (colors[index] ?? t.muted);
}

/** The open-bugs tile's body: a strip of priority segments and a chip per priority. */
function BugPriorities(t, config, bugs) {
  const present = [...config.bugs.priorities, "Unset"].filter((priority) => bugs.counts[priority]);
  return v_flex()
    .gap(6)
    .child(
      h_flex()
        .w_full()
        .h(6)
        .rounded(3)
        .overflow_hidden()
        .bg(t.border)
        .children(
          present.map((priority) =>
            div()
              .h_full()
              .w(`${(bugs.counts[priority] / Math.max(1, bugs.read)) * 100}%`)
              .bg(priorityColor(t, config, priority)),
          ),
        ),
    )
    .child(
      h_flex()
        .flex_wrap()
        .gap(4)
        .children(
          present.map((priority) =>
            Chip(`${priority} ${bugs.counts[priority]}`, { color: priorityColor(t, config, priority) }),
          ),
        ),
    )
    .when(bugs.read < bugs.total, (el) => el.child(Note(`Counted ${bugs.read} of ${bugs.total}`)));
}

/** The color for a nightly outcome: success in `done`, a failure in `blocked`, running in `muted`. */
function outcomeColor(t, outcome) {
  if (outcome === "success") return t.done;
  if (outcome === "failure" || outcome === "failed") return t.blocked;
  if (outcome === "running") return t.muted;
  return t.dim;
}

/**
 * The nightly tile's value, color and lines: the run's outcome, when it started, then one line per check.
 * @param {object} t The theme.
 * @param {object | null} run The latest nightly run.
 * @param {string | null} error Why it could not be read.
 * @returns {Array} The value, its color, and the lines under it.
 */
function nightlyParts(t, run, error) {
  if (error) return ["Error", t.blocked, error];
  if (!run) return ["–", t.dim, "No nightly configured"];
  if (!run.checks) return ["–", t.dim, "Refresh to load the checks"];
  const value = { success: "Success", failure: "Failure", running: "Running" }[run.overall];
  const lines = run.checks.map((check) =>
    h_flex()
      .items_center()
      .gap(6)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(check.name))
      .child(Chip(check.outcome, { color: outcomeColor(t, check.outcome) })),
  );
  return [value, outcomeColor(t, run.overall), [`${formatDate(run.at)}, ${formatTime(run.at)}`, ...lines]];
}

/**
 * The top row: open bugs by priority, triage bugs, open customer issues and the nightly run.
 * Four across when `wide`, else two by two. Each ends in what a click opens; a failed nightly is
 * outlined in red. A missing nightly or customer label opens Settings on this workspace instead.
 * @param {object} config The workspace's config.
 * @param {object} model The workspace's model.
 * @param {{ wide: boolean, onSettings(cx: object): void }} options `onSettings` opens Settings on
 *   this workspace.
 * @returns {object} The row of tiles.
 */
export function Tiles(config, model, { wide, onSettings }) {
  const t = theme();
  const counts = model.counts;
  const [nightlyValue, nightlyColor, nightlySub] = nightlyParts(t, model.nightly, model.errors.nightly);
  const bugs = model.bugs;
  const customer = model.customer;
  const noNightly = !model.nightly && !model.errors.nightly;
  const noLabel = Boolean(customer) && !customer.labels.length;
  const failed = model.nightly?.overall === "failure";
  const tiles = [
    Tile(
      "tile-bugs",
      "Open bugs by priority",
      bugs ? String(bugs.total) : "–",
      bugs ? BugPriorities(t, config, bugs) : (model.errors.bugs ?? ""),
      t.foreground,
      searchUrl(config.repo, model.queries.bugsQuery),
      undefined,
      { link: seeAll(bugs?.total) },
    ),
    Tile(
      "tile-triage",
      "Triage bugs",
      String(counts?.triage ?? "–"),
      "waiting for triage",
      t.foreground,
      searchUrl(config.repo, model.queries.triageQuery),
      undefined,
      { link: seeAll(counts?.triage) },
    ),
    Tile(
      "tile-customer",
      "Customer issues",
      customer ? String(customer.count) : "–",
      customer ? customer.labels.join(", ") || "No customer label" : (model.errors.customer ?? ""),
      t.foreground,
      noLabel ? onSettings : customer?.query ? searchUrl(config.repo, customer.query) : null,
      undefined,
      { link: noLabel ? SET_UP : seeAll(customer?.count) },
    ),
    Tile(
      "tile-nightly",
      "Nightly",
      nightlyValue,
      nightlySub,
      nightlyColor,
      noNightly ? onSettings : model.nightly?.url,
      "latest run",
      { link: noNightly ? SET_UP : "Open the run →", outline: failed ? `${t.blocked}80` : null },
    ),
  ];
  if (wide) return h_flex().gap(10).items_stretch().children(tiles);
  return v_flex()
    .gap(10)
    .child(h_flex().gap(10).items_stretch().children(tiles.slice(0, 2)))
    .child(h_flex().gap(10).items_stretch().children(tiles.slice(2)));
}
