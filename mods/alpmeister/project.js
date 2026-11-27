// A workspace's status: tiles for open bugs by priority, triage bugs, customer issues and the
// nightly run (the Milestone card is in spotlight.js). `config` here is the workspace's settings.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { searchUrl } from "./data.js";
import { Chip, ICONS, IconButton, LinkLabel, Note, formatDate, formatTime, openUrl, warningColor } from "./ui.js";

/**
 * The tooltip of a tile's GitHub mark when it opens a list: "See all 7 on GitHub", "See both on
 * GitHub", "See it on GitHub".
 * @param {number | null | undefined} count How many the list holds.
 * @returns {string} The words; "Open the search on GitHub" for an empty or unknown list.
 */
export function seeAll(count) {
  if (!count) return "Open the search on GitHub";
  if (count === 1) return "See it on GitHub";
  if (count === 2) return "See both on GitHub";
  return `See all ${count} on GitHub`;
}

/** The words that end a tile whose setting is missing; a click opens Settings on it. */
export const SET_UP = "Set up in Settings →";

/**
 * One number tile: a label, a big value, then lines or any element under it. A tile that opens
 * GitHub has the GitHub mark in its top-right corner (no words; the tooltip says where it goes),
 * then its filter icon when it has one. A tile whose setting is missing ends in "Set up in
 * Settings →" with the gear. `sub` is a string, an element, or a list of them. `action` is a URL
 * to open or a function to run on click.
 * @param {string} id The tile's element id.
 * @param {string} label The tile's label.
 * @param {string} value The big value.
 * @param {string | object | Array<string | object>} sub The lines under the value.
 * @param {string} color The value's color.
 * @param {string | Function | null} action A URL to open, or a function to run, on click.
 * @param {string} [note] A short clause after the label that says what the tile counts.
 * @param {{ link?: string | null, linkIcon?: string | null, github?: string | null, outline?: string | null,
 *   filter?: object | null }} [options] `link`: words at the bottom, such as "Set up in Settings →",
 *   and `linkIcon` the icon on their left (the gear); `github`: the GitHub mark's tooltip, shown
 *   when `action` is a URL, such as "See all 7 on GitHub"; `outline`: a border color, such as red
 *   for a failed run; `filter`: the tile's filter icon (`FilterIcon`), for its top-right corner.
 * @returns {object} The tile.
 */
export function Tile(id, label, value, sub, color, action, note, { link, linkIcon, github, outline, filter } = {}) {
  const t = theme();
  const mark =
    github && typeof action === "string"
      ? IconButton(`${id}-github`, ICONS.github, () => openUrl(action), { tooltip: github })
      : null;
  const corner = [mark, filter].filter(Boolean);
  return v_flex()
    .id(id)
    .relative()
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
    .child(
      div()
        .when(corner.length > 0, (el) => el.pr(24 * corner.length))
        .truncate()
        .text_size(11.5)
        .text_color(t.dim)
        .child(note ? `${label} · ${note}` : label),
    )
    .child(div().text_size(22).font_semibold().text_color(color).child(value))
    .children(
      (Array.isArray(sub) ? sub : [sub]).map((line) =>
        typeof line === "string" ? div().text_size(11.5).truncate().text_color(t.muted).child(line) : line,
      ),
    )
    .when(Boolean(link && action), (el) => el.child(div().flex_1()))
    .when(Boolean(link && action), (el) =>
      el.child(h_flex().pt(2).text_size(11.5).text_color(t.accent).child(LinkLabel(linkIcon ?? null, link))),
    )
    .when(corner.length > 0, (el) => el.child(div().absolute().top(7).right(7).child(h_flex().gap(2).children(corner))));
}

/**
 * A row of tiles, four across when `wide`, else two by two.
 * @param {object[]} tiles The four tiles.
 * @param {boolean} wide Whether the tiles go four across.
 * @returns {object} The tiles.
 */
export function TileRows(tiles, wide) {
  const rows = wide ? [[0, tiles.length]] : [[0, 2], [2, tiles.length]];
  return v_flex()
    .gap(10)
    .children(rows.map(([from, to]) => h_flex().gap(10).items_stretch().children(tiles.slice(from, to))));
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
 * Open bugs, Triage bugs and Customer issues have their filter icon in the corner when `filter`
 * gives one.
 * @param {object} config The workspace's config.
 * @param {object} model The workspace's model.
 * @param {{ wide: boolean, onSettings(cx: object): void,
 *   filter?(key: "bugs" | "triage" | "customer"): object | null }} options
 *   `onSettings` opens Settings on this workspace; `filter` gives a tile's filter icon.
 * @returns {object} The row of tiles.
 */
export function Tiles(config, model, { wide, onSettings, filter }) {
  const t = theme();
  const counts = model.counts;
  const [nightlyValue, nightlyColor, nightlySub] = nightlyParts(t, model.nightly, model.errors.nightly);
  const bugs = model.bugs;
  const customer = model.customer;
  const noNightly = !model.nightly && !model.errors.nightly;
  const noLabel = Boolean(customer) && !customer.labels.length;
  const failed = model.nightly?.overall === "failure";
  const filters = Object.fromEntries(["bugs", "triage", "customer"].map((key) => [key, filter?.(key) ?? null]));
  const tiles = [
    Tile(
      "tile-bugs",
      "Open bugs by priority",
      bugs ? String(bugs.total) : "–",
      bugs ? BugPriorities(t, config, bugs) : (model.errors.bugs ?? ""),
      t.foreground,
      searchUrl(config.repo, model.queries.bugsQuery),
      undefined,
      { github: seeAll(bugs?.total), filter: filters.bugs },
    ),
    Tile(
      "tile-triage",
      "Triage bugs",
      String(counts?.triage ?? "–"),
      "waiting for triage",
      t.foreground,
      searchUrl(config.repo, model.queries.triageQuery),
      undefined,
      { github: seeAll(counts?.triage), filter: filters.triage },
    ),
    Tile(
      "tile-customer",
      "Customer issues",
      customer ? String(customer.count) : "–",
      customer ? customer.labels.join(", ") || "No customer label" : (model.errors.customer ?? ""),
      t.foreground,
      noLabel ? onSettings : customer?.query ? searchUrl(config.repo, customer.query) : null,
      undefined,
      {
        link: noLabel ? SET_UP : null,
        linkIcon: ICONS.settings,
        github: noLabel ? null : seeAll(customer?.count),
        filter: filters.customer,
      },
    ),
    Tile(
      "tile-nightly",
      "Nightly",
      nightlyValue,
      nightlySub,
      nightlyColor,
      noNightly ? onSettings : model.nightly?.url,
      "latest run",
      {
        link: noNightly ? SET_UP : null,
        linkIcon: ICONS.settings,
        github: noNightly ? null : "Open the run on GitHub",
        outline: failed ? `${t.blocked}80` : null,
      },
    ),
  ];
  return TileRows(tiles, wide);
}
