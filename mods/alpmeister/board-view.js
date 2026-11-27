// Board: a workspace's board items that match the Board tab filter, one column per status, as
// GitHub's board shows them. Each card carries its assignees' avatars. Dragging a card to another
// column moves it to that status; a right click opens its menu for the iteration and milestone.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, Popup } from "gpui-base";
import { theme } from "herdr";
import { boardFilter, boardStatuses } from "./data.js";
import { prChip } from "./in-flight.js";
import { ClaudeButton, decisionChip } from "./my-day.js";
import {
  Card,
  Chip,
  ICONS,
  IconButton,
  Note,
  SessionButton,
  TextButton,
  openUrl,
  sessionTab,
  shortRepo,
  statusColor,
  typeColor,
} from "./ui.js";

const NO_STATUS = "No status";
const AVATAR_SIZE = 20;
const PICKER_SIZE = 26;
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
        color: current ? t.accent : t.working,
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
                  .text_size(11)
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
            ),
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
  return Popup.new(`${id}-popup`, card).w_full().anchor("top_left").content(options.cardMenu(item, options.flipMenu));
}

/**
 * The people on the board, most items first: each assignee, then Unassigned when an item has none.
 * @param {object[]} items The board items.
 * @returns {{ login: string, avatar: string | null, count: number }[]}
 */
function peopleOf(items) {
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
 * The filter field: the board's filter syntax, applied and saved on Enter, reverted on Esc.
 * @param {object} t The theme.
 * @param {object} options The Board options.
 * @returns {object} The field.
 */
function FilterField(t, options) {
  return h_flex()
    .gap(8)
    .items_center()
    .child(div().flex_none().text_size(11).text_color(t.dim).child("Filter"))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .on_key_down((event, cx) => {
          if (event.key !== "escape") return;
          cx.stop_propagation();
          options.onFilterRevert(cx);
        })
        .child(
          Input.new(options.filterInput)
            .h(26)
            .px(8)
            .rounded(6)
            .border_1()
            .border_color(options.filterError ? t.blocked : t.border)
            .bg(t.canvas)
            .text_size(12)
            .text_color(t.foreground),
        ),
    )
    .when(Boolean(options.filterBusy), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("Applying…")));
}

/**
 * The people picker: every assignee's avatar with their item count, then Unassigned. A click
 * picks or unpicks one; with any picked, the board shows only their items.
 * @param {object} t The theme.
 * @param {{ login: string, avatar: string | null, count: number }[]} people The people on the board.
 * @param {object} options The Board options.
 * @returns {object} The picker.
 */
function PeoplePicker(t, people, options) {
  const picked = options.picked;
  return h_flex()
    .flex_wrap()
    .gap(6)
    .items_center()
    .children(
      people.map((person) => {
        const on = picked.has(person.login);
        const key = person.login || "unassigned";
        const label = person.login || "Unassigned";
        return h_flex()
          .id(`bv-pick-${key}`)
          .flex_none()
          .gap(4)
          .p(2)
          .pr(6)
          .items_center()
          .rounded_full()
          .border_1()
          .border_color(on ? t.accent : t.border)
          .bg(on ? t.selected : t.background)
          .cursor_pointer()
          .when(picked.size > 0 && !on, (el) => el.opacity(0.5))
          .hover((style) => style.border_color(t.accent))
          .tooltip(`${label}: ${person.count} item${person.count === 1 ? "" : "s"}. Click to ${on ? "unpick" : "pick"}.`)
          .on_click((_event, cx) => options.onTogglePerson(person.login, cx))
          .child(
            person.login
              ? Avatar(t, person, `bv-pick-av-${key}`, options.avatarPath, PICKER_SIZE - 6)
              : div().size(PICKER_SIZE - 6).rounded_full().border_1().border_color(t.dim),
          )
          .child(div().text_size(11).text_color(on ? t.foreground : t.muted).child(String(person.count)));
      }),
    )
    .when(picked.size > 0, (el) => el.child(TextButton("bv-pick-clear", "Everyone", (cx) => options.onClearPeople(cx))));
}

/**
 * The Board tab's card for one workspace: the filter field, the people picker, then a column
 * per status, each with its count.
 * @param {object} ws The workspace, with a board.
 * @param {object | undefined} wsModel The workspace's last load.
 * @param {{ loading: boolean, avatarPath(login: string): string | null, onEditStatuses(): void,
 *   filterInput: object, filterBusy: boolean, filterError: string | null, onFilterRevert(cx: object): void,
 *   picked: Set<string>, onTogglePerson(login: string, cx: object): void, onClearPeople(cx: object): void,
 *   pinFor(prefix: string): Function, launch: Function, prompt: Function }} options
 * @returns {object} The card.
 */
export function Board(ws, wsModel, options) {
  const t = theme();
  const view = wsModel?.boardView;
  const items = view ? view.items.filter((item) => pickedItem(item, options.picked)) : [];
  const extras = [
    view ? Chip(items.length === view.total ? String(view.total) : `${items.length} of ${view.total}`, { color: t.dim }) : null,
    TextButton("bv-statuses", "Statuses", () => options.onEditStatuses(), {
      tooltip: "Pick the Board's columns in Settings, in the status table's On Board column",
    }),
    wsModel?.boardUrl
      ? IconButton("bv-github", ICONS.github, () => openUrl(wsModel.boardUrl), { tooltip: "Open the board on GitHub" })
      : null,
  ].filter(Boolean);
  let body = v_flex().gap(10).child(FilterField(t, options));
  if (options.filterError) body = body.child(Note(options.filterError, t.blocked));
  const notice = wsModel?.errors?.boardView
    ? Note(`GitHub: ${wsModel.errors.boardView}`, t.blocked)
    : !boardFilter(ws)
      ? Note("Type a filter, or tick the Board's statuses in Settings.")
      : !view
        ? Note(options.loading ? "Loading from GitHub…" : "Refresh to load the board.")
        : !view.items.length
          ? Note(`Nothing matches ${view.filter}.`)
          : null;
  if (notice) return Card("board-view", ws.board.title || ws.name, extras, body.child(notice));
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
    .child(PeoplePicker(t, peopleOf(view.items), options))
    .when(view.total > view.items.length, (el) =>
      el.child(Note(`Showing the first ${view.items.length} of ${view.total} items.`, t.working)),
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
            const columnOptions = { ...cardOptions, flipMenu: index >= columns.length / 2 };
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
                  .child(div().text_size(11).text_color(t.dim).child(String(columnItems.length))),
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
