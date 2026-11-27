// Board: a workspace's board items that match the Board tab filter, one column per status, as
// GitHub's board shows them. Each card carries its assignees' avatars. The filter's summary sits
// on the header and opens its editor. Dragging a card to another column moves it to that status,
// and a toast offers Undo; the ⋯ on a card (shown on hover or focus), or a right click, opens its
// menu to move it or set its iteration and milestone.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { theme } from "herdr";
import { boardFilter, boardStatuses } from "./data.js";
import { prChip } from "./in-flight.js";
import { ClaudeButton, decisionChip } from "./my-day.js";
import {
  Card,
  Chip,
  ICONS,
  IconButton,
  LinkLabel,
  Note,
  SessionButton,
  TextButton,
  openUrl,
  sessionTab,
  shortRepo,
  statusColor,
  typeColor,
  warningColor,
} from "./ui.js";

/** The column of items with no status. */
export const NO_STATUS = "No status";
const AVATAR_SIZE = 20;
const COLUMN_GAP = 8;
/** A column's padding on each side, between its edge and its cards. */
export const COLUMN_PADDING = 4;
/** The space between a column's header and its cards, and between cards. */
export const CARD_GAP = 6;
/** The layout probe's width, in layout units. */
const PROBE_WIDTH = 100;
/** The people picker's key for items with no assignee. */
export const UNASSIGNED = "";

/**
 * The board's columns: the statuses ticked for the Board, each shown even when empty. With none
 * ticked, the workspace's statuses that hold an item, in its order, then any other status the
 * items carry, then No status.
 * @param {object} ws The workspace.
 * @param {object[]} items The board items.
 * @returns {string[]} The column names.
 */
function columnsOf(ws, items) {
  const ticked = boardStatuses(ws);
  if (ticked.length) return ticked;
  const present = new Set(items.map((item) => item.status ?? NO_STATUS));
  const known = ws.statuses.filter((status) => present.has(status));
  const others = [...present].filter((status) => status !== NO_STATUS && !ws.statuses.includes(status)).sort();
  return [...known, ...others, ...(present.has(NO_STATUS) ? [NO_STATUS] : [])];
}

/**
 * Two letters for a login: the start of its last dash-separated part, since many teams prefix
 * every login with the same org tag.
 * @param {string} login The GitHub login.
 * @returns {string} The initials.
 */
const initials = (login) => (login.split("-").filter(Boolean).pop() ?? login).slice(0, 2).toUpperCase();

/**
 * A chip's content: an icon in the chip's color, then its text.
 * @param {string} icon The icon's path.
 * @param {string} text The text.
 * @returns {object}
 */
const IconLabel = (icon, text) => h_flex().gap(4).items_center().min_w(0).child(svg(icon).flex_none().size(11)).child(text);

/**
 * The column under the pointer: the columns share the row's width equally, with a gap between.
 * @param {{ local_position: { x: number }, bounds: { width: number } }} event A move over the columns.
 * @param {string[]} columns The columns, left to right.
 * @returns {string} The column.
 */
function columnAt(event, columns) {
  const index = Math.floor(event.local_position.x / (columnWidth(event, columns.length) + COLUMN_GAP));
  return columns[Math.min(columns.length - 1, Math.max(0, index))];
}

/**
 * One column's width, in the row's own coordinates.
 * @param {{ bounds: { width: number } }} event A move over the columns.
 * @param {number} count How many columns share the row.
 * @returns {number}
 */
function columnWidth(event, count) {
  return (event.bounds.width - COLUMN_GAP * (count - 1)) / count;
}

/**
 * An assignee's avatar, or their initials in a circle until the avatar file is there.
 * @param {object} t The theme.
 * @param {{ login: string }} person The assignee.
 * @param {string} id A unique element id.
 * @param {(login: string) => string | null} avatarPath Where the avatar file is, or null.
 * @returns {object} The avatar.
 */
function Avatar(t, person, id, avatarPath, size = AVATAR_SIZE) {
  const path = avatarPath(person.login);
  const frame = div()
    .id(id)
    .flex_none()
    .size(size)
    .rounded_full()
    .overflow_hidden()
    .border_1()
    .border_color(t.background)
    .tooltip(person.login);
  if (path) return frame.child(image(path).size(size - 2).rounded_full());
  return frame
    .bg(t.selected)
    .flex()
    .items_center()
    .justify_center()
    .text_size(size > 22 ? 10 : 9)
    .font_semibold()
    .text_color(t.muted)
    .child(initials(person.login));
}

/**
 * The one iteration a board filter asks for, read from its iteration term, such as
 * `iteration:@current`, `iteration:"Sprint 24"` or `iteration:Sprint-24`. Careful: any filter it
 * cannot be sure of gives null, so the cards keep their iteration chips: no term, a negated
 * term (`-iteration:`), more than one term, more than one value (`iteration:@current,@previous`),
 * a comparison or any other `@` value than `@current`.
 * @param {string | null | undefined} filter The board filter.
 * @param {string} field The board's Iteration field name, which names the term.
 * @returns {string | null} "@current", or the iteration's name in lower case; null when unsure.
 */
function filterIteration(filter, field) {
  const terms = (filter ?? "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const key = `${field.toLowerCase()}:`;
  const values = [];
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (lower.startsWith(`-${key}`)) return null;
    if (lower.startsWith(key)) values.push(term.slice(key.length));
  }
  if (values.length !== 1) return null;
  const quoted = values[0].match(/^"([^"]*)"$/);
  const value = (quoted ? quoted[1] : values[0]).trim().toLowerCase();
  if (!value || (!quoted && /[",<>=*]/.test(value))) return null;
  if (value.startsWith("@")) return value === "@current" ? value : null;
  return value;
}

/**
 * One item's card: its number, type and buttons, its title, then its PRs, its iteration unless
 * the filter already asks for that one, and its assignees' avatars. A click opens it on GitHub.
 * @param {object} t The theme.
 * @param {object} item The board item.
 * @param {object} options The Board options, with `repo`, `iteration` (the current one's name)
 *   and `filterIteration` (from `filterIteration()`).
 * @returns {object} The card.
 */
function ItemCard(t, item, options) {
  const id = `bv-${item.repo}#${item.number ?? item.title}`;
  const linked = item.kind !== "draft" && item.number != null;
  const session = linked ? sessionTab(item) : null;
  const chips = (item.kind === "pr" ? [decisionChip(t, item, "bv")] : item.prs.map((pr) => prChip(t, item, pr, "bv"))).filter(Boolean);
  const current = Boolean(item.iteration) && item.iteration === options.iteration;
  const asked =
    options.filterIteration === "@current" ? current : options.filterIteration === item.iteration?.toLowerCase();
  if (item.iteration && !asked) {
    chips.push(
      Chip(IconLabel(ICONS.iteration, item.iteration), {
        color: current ? t.accent : t.muted,
        id: `${id}-it`,
        tooltip: current ? "The current iteration" : "Iteration",
      }),
    );
  }
  if (item.milestone) {
    chips.push(Chip(IconLabel(ICONS.milestone, item.milestone.title), { color: t.muted, id: `${id}-ms`, tooltip: "Milestone" }));
  }
  const people = item.assignees.filter((person) => person.login);
  const card = v_flex()
    .id(id)
    .w_full()
    .when(!options.ghost, (el) => el.on_size_change((size) => options.onCardSize(item.itemId, size.height)))
    .p(8)
    .gap(6)
    .rounded(7)
    .bg(options.ghost ? t.background : t.canvas)
    .border_1()
    .border_color(options.ghost || options.menuFor === item.itemId ? t.accent : t.border)
    .hover((style) => style.border_color(t.accent))
    .when(options.writing.has(item.itemId), (el) => el.opacity(0.6))
    .when(!options.ghost, (el) => el.on_hover((hovered, cx) => options.onCardHover(item.itemId, hovered, cx)))
    .on_mouse_down("left", (event) => options.onCardDown(item, event))
    .on_mouse_down("right", (_event, cx) => {
      cx.stop_propagation();
      options.onCardMenu(item, cx);
    })
    .when(Boolean(item.url), (el) =>
      el.cursor_pointer().on_click(() => {
        if (options.isClick()) openUrl(item.url);
      }),
    )
    .child(
      h_flex()
        .w_full()
        .gap(4)
        .items_center()
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(6)
            .items_center()
            .overflow_hidden()
            .when(linked, (el) =>
              el.child(
                div()
                  .flex_shrink(1)
                  .min_w(0)
                  .truncate()
                  .text_size(11.5)
                  .text_color(t.dim)
                  .child(`${item.kind === "pr" ? "PR " : ""}${item.repo === options.repo ? "" : shortRepo(item.repo)}#${item.number}`),
              ),
            )
            .when(Boolean(item.type), (el) =>
              el.child(Chip(item.type, { color: typeColor(t, item.type) }).flex_shrink(1).min_w(0).truncate()),
            )
            .when(item.kind === "draft", (el) => el.child(Chip("Draft", { color: t.dim }))),
        )
        .child(
          h_flex()
            .flex_none()
            .items_center()
            .when(Boolean(session), (el) => el.child(SessionButton(`${id}-session`, session)))
            .when(linked, (el) =>
              el.children([options.pinFor("bv")(item), ClaudeButton("bv", item, options)].filter(Boolean)),
            )
            .when(Boolean(item.itemId) && !options.ghost, (el) => el.child(MoreButton(t, item, id, options))),
        ),
    )
    .child(
      div()
        .text_size(12)
        .whitespace_normal()
        .text_color(item.state === "CLOSED" || item.state === "MERGED" ? t.dim : t.foreground)
        .child(item.title),
    )
    .when(chips.length > 0 || people.length > 0, (el) =>
      el.child(
        h_flex()
          .gap(8)
          .items_end()
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .overflow_hidden()
              .flex_wrap()
              .gap(4)
              .children(chips.map((chip) => chip.flex_shrink(1).min_w(0).truncate())),
          )
          .child(
            h_flex()
              .flex_none()
              .gap(2)
              .children(people.map((person) => Avatar(t, person, `${id}-av-${person.login}`, options.avatarPath))),
          ),
      ),
    );
  if (options.menuFor !== item.itemId) return card;
  return Popup.new(`${id}-popup`, card).w_full().anchor("top_left").content(options.cardMenu(item, options.flipMenu, options.columns));
}

/**
 * The ⋯ on a card: it opens the card menu. It shows while the pointer is on the card, while
 * its menu is open, and while it has the keyboard; it is a Tab stop, and Enter or Space opens the
 * menu with the keyboard in it.
 * @param {object} t The theme.
 * @param {object} item The board item.
 * @param {string} id The card's element id.
 * @param {object} options The Board options.
 * @returns {object} The button.
 */
function MoreButton(t, item, id, options) {
  const open = options.menuFor === item.itemId;
  const shown = open || options.hoverCard === item.itemId;
  return div()
    .id(`${id}-more`)
    .flex_none()
    .w(22)
    .h(20)
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .text_size(14)
    .text_color(open ? t.foreground : t.muted)
    .when(open, (el) => el.bg(t.hover))
    .when(!shown, (el) => el.opacity(0))
    .cursor_pointer()
    .tab_index(0)
    .when(Boolean(options.focus) && options.dotsFor === item.itemId, (el) => el.track_focus(options.focus.dots))
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .focus((style) => style.opacity(1).bg(t.hover).text_color(t.foreground))
    .tooltip("Move, iteration, milestone")
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => {
      cx.stop_propagation();
      options.onCardMenu(item, cx);
    })
    .on_key_down((event, cx) => {
      if (event.key !== "enter" && event.key !== "space") return;
      cx.stop_propagation();
      options.onCardMenu(item, cx, true);
    })
    .child("⋯");
}

/**
 * The people on the board, most items first: each assignee, then Unassigned when an item has none.
 * @param {object[]} items The board items.
 * @returns {{ login: string, avatar: string | null, count: number }[]}
 */
export function peopleOf(items) {
  const people = new Map();
  for (const item of items) {
    const assignees = item.assignees.length ? item.assignees : [{ login: UNASSIGNED, avatar: null }];
    for (const person of assignees) {
      const known = people.get(person.login) ?? { login: person.login, avatar: person.avatar ?? null, count: 0 };
      known.count += 1;
      people.set(person.login, known);
    }
  }
  return [...people.values()].sort(
    (a, b) => (a.login === UNASSIGNED) - (b.login === UNASSIGNED) || b.count - a.count || a.login.localeCompare(b.login),
  );
}

/**
 * Whether an item belongs to the picked people: assigned to one of them, or unassigned when
 * Unassigned is picked. With nobody picked, every item does.
 * @param {object} item The board item.
 * @param {Set<string>} picked The picked logins.
 * @returns {boolean}
 */
function pickedItem(item, picked) {
  if (!picked.size) return true;
  if (!item.assignees.length) return picked.has(UNASSIGNED);
  return item.assignees.some((person) => picked.has(person.login));
}

/**
 * The toast after a move: what moved where, with Undo while it can be undone.
 * @param {object} t The theme.
 * @param {{ text: string, status: string, tail: string, undo?: Function } | null} toast The toast.
 * @param {(cx: object) => void} onUndo Undoes the move.
 * @returns {object | null} The toast, or null without one.
 */
function MoveToast(t, toast, onUndo) {
  if (!toast) return null;
  return h_flex()
    .id("bv-toast")
    .self_center()
    .h(34)
    .pl(12)
    .pr(toast.undo ? 5 : 12)
    .gap(12)
    .items_center()
    .rounded(8)
    .bg(t.selected)
    .border_1()
    .border_color(t.input)
    .shadow_lg()
    .text_size(12)
    .text_color(t.foreground)
    .child(
      h_flex()
        .gap(4)
        .child(div().child(toast.text))
        .child(div().font_semibold().child(toast.status))
        .child(div().text_color(t.muted).child(toast.tail)),
    )
    .when(Boolean(toast.undo), (el) =>
      el.child(
        h_flex()
          .id("bv-toast-undo")
          .h(24)
          .px(10)
          .items_center()
          .rounded(6)
          .bg(t.hover)
          .font_semibold()
          .cursor_pointer()
          .tab_index(0)
          .hover((style) => style.bg(t.input))
          .focus((style) => style.bg(t.input))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            onUndo(cx);
          })
          .on_key_down((event, cx) => {
            if (event.key !== "enter" && event.key !== "space") return;
            cx.stop_propagation();
            onUndo(cx);
          })
          .child("Undo"),
      ),
    );
}

/**
 * "Nothing matches. Clear filters", for a board the filter empties.
 * @param {object} t The theme.
 * @param {(cx: object) => void} onClear Clears the filters.
 * @returns {object}
 */
function NothingMatches(t, onClear) {
  return h_flex()
    .gap(6)
    .items_center()
    .child(div().text_size(12).text_color(t.muted).child("Nothing matches."))
    .child(TextButton("bv-clear-filters", "Clear filters", (cx) => onClear(cx)));
}

/**
 * The Board tab with no board in any workspace: what it needs, and an "Add a board" button.
 * @param {(cx: object) => void} onAdd Opens Settings at a workspace's board picker.
 * @returns {object} The empty state.
 */
export function NoBoard(onAdd) {
  const t = theme();
  return v_flex()
    .items_start()
    .gap(10)
    .child(Note("Add a project board to a workspace in Settings to see it here."))
    .child(
      h_flex()
        .id("bv-add-board")
        .h(26)
        .px(12)
        .items_center()
        .rounded(6)
        .bg(t.accent)
        .text_size(12)
        .font_medium()
        .text_color(t.accent_foreground ?? t.background)
        .cursor_pointer()
        .on_click((_event, cx) => onAdd(cx))
        .child(LinkLabel(ICONS.settings, "Add a board")),
    );
}

/**
 * The Board tab's card for one workspace: the filter's summary on the header and its editor
 * while open, the toast after a move, then a column per status, each with its count.
 * @param {object} ws The workspace, with a board, its applied filter in place of the saved one.
 * @param {object | undefined} wsModel The workspace's last load.
 * @param {{ loading: boolean, avatarPath(login: string): string | null,
 *   filter: { summary: object, panel: object | null }, onChooseColumns(cx: object): void,
 *   onClearFilters(cx: object): void, picked: Set<string>, toast: object | null, onUndo(cx: object): void,
 *   pinFor(prefix: string): Function, launch: Function, prompt: Function }} options The rest
 *   come from `BoardState.options()`.
 * @returns {object} The card.
 */
export function Board(ws, wsModel, options) {
  const t = theme();
  const view = wsModel?.boardView;
  const items = view ? view.items.filter((item) => pickedItem(item, options.picked)) : [];
  const extras = [
    view ? Chip(items.length === view.total ? String(view.total) : `${items.length} of ${view.total}`, { color: t.dim }) : null,
    options.filter.summary,
    TextButton("bv-choose-columns", "Choose columns ▾", (cx) => options.onChooseColumns(cx), {
      tooltip: "Pick the board's columns, with its filter",
    }),
    wsModel?.boardUrl
      ? IconButton("bv-github", ICONS.github, () => openUrl(wsModel.boardUrl), { tooltip: "Open the board on GitHub" })
      : null,
  ].filter(Boolean);
  let body = v_flex().gap(10);
  if (options.filter.panel) body = body.child(options.filter.panel);
  const toast = MoveToast(t, options.toast, options.onUndo);
  const notice = wsModel?.errors?.boardView
    ? Note(`GitHub: ${wsModel.errors.boardView}`, t.blocked)
    : !view
      ? Note(
          !boardFilter(ws)
            ? "Type a board filter, or choose the columns."
            : options.loading
              ? "Loading from GitHub…"
              : "Refresh to load the board.",
        )
      : !view.items.length
        ? NothingMatches(t, options.onClearFilters)
        : null;
  if (notice) return Card("board-view", ws.board.title || ws.name, extras, body.when(Boolean(toast), (el) => el.child(toast)).child(notice));
  const cardOptions = {
    ...options,
    repo: ws.repo,
    iteration: wsModel.iteration?.title ?? null,
    filterIteration: filterIteration(view.filter, ws.board.iterationField ?? "Iteration"),
  };
  const columns = columnsOf(ws, view.items);
  const ghost = options.ghost;
  /** A column's shown cards, in board order, without the one being dragged. */
  const shownIn = (column) =>
    items.filter((item) => (item.status ?? NO_STATUS) === column && item.itemId !== options.draggedId);
  body = body
    .when(Boolean(toast), (el) => el.child(toast))
    .when(!items.length, (el) => el.child(NothingMatches(t, options.onClearFilters)))
    .when(view.total > view.items.length, (el) =>
      el.child(Note(`Showing the first ${view.items.length} of ${view.total} items.`, warningColor(t))),
    )
    .when(Boolean(options.writeError), (el) => el.child(Note(options.writeError, t.blocked)))
    .child(
      h_flex()
        .id("bv-columns")
        .relative()
        .gap(COLUMN_GAP)
        .items_start()
        .when(ghost !== null, (el) => el.cursor_grabbing())
        .on_mouse_move((event, cx) => {
          const column = columnAt(event, columns);
          options.onDragMove(event, column, columnWidth(event, columns.length) - 2 * COLUMN_PADDING, shownIn(column), cx);
        })
        .on_mouse_up("left", (_event, cx) => options.onDrop(cx))
        .on_hover((hovered, cx) => {
          if (!hovered) options.onDragEnd(cx);
        })
        .children(
          columns.map((column, index) => {
            const columnItems = shownIn(column);
            const target = ghost !== null && options.dragOver === column;
            const columnOptions = { ...cardOptions, columns, flipMenu: index >= columns.length / 2 };
            const cards = columnItems.map((item) => ItemCard(t, item, columnOptions));
            if (target) {
              const slot = div()
                .id(`bv-slot-${column}`)
                .w_full()
                .h(ghost.height)
                .rounded(7)
                .border_2()
                .border_dashed()
                .border_color(t.accent)
                .bg(`${t.accent}1f`);
              cards.splice(Math.min(options.dropIndex ?? cards.length, cards.length), 0, slot);
            }
            return v_flex()
              .id(`bv-col-${column}`)
              .flex_1()
              .min_w(0)
              .min_h(80)
              .gap(CARD_GAP)
              .p(COLUMN_PADDING)
              .rounded(8)
              .when(target, (el) => el.bg(t.hover))
              .child(
                h_flex()
                  .id(`bv-head-${column}`)
                  .on_size_change((size) => options.onHeaderSize(size.height))
                  .gap(6)
                  .items_center()
                  .pb(2)
                  .child(div().flex_none().size(8).rounded_full().bg(statusColor(t, column)))
                  .child(div().truncate().text_size(11.5).font_semibold().text_color(t.foreground).child(column))
                  .child(div().text_size(11.5).text_color(t.dim).child(String(columnItems.length))),
              )
              .children(cards);
          }),
        )
        .child(
          div()
            .id("bv-unit-probe")
            .absolute()
            .top(0)
            .left(0)
            .w(PROBE_WIDTH)
            .h(0)
            .on_size_change((size) => options.onUnitProbe(size.width, PROBE_WIDTH)),
        )
        .when(ghost !== null, (el) =>
          el.child(
            div()
              .absolute()
              .left(ghost.x)
              .top(ghost.y)
              .w(ghost.width)
              .h(ghost.height)
              .shadow_lg()
              .child(ItemCard(t, ghost.item, { ...cardOptions, ghost: true, menuFor: null })),
          ),
        ),
    );
  return Card("board-view", ws.board.title || ws.name, extras, body);
}
