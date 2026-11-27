// The Board card's menu, opened by its ⋯ button or a right click: Move to, Iteration and
// Milestone, each opening its own menu beside it, as a nested dropdown does, then "Start with
// Claude" (an issue) or "Review with Claude" (a PR), the card's only Claude button. It works from the
// keyboard too: Tab or Shift+Tab between rows, Enter, Space or → opens a row's menu or picks, ←
// goes back, Esc closes it and puts the keyboard back on the ⋯. The submenu floats level with its row, to the right,
// or to the left for a card in the right half of the board, and never resizes the main menu. The
// Iteration menu offers the last completed iterations and every open one, the Milestone menu the
// repository's open milestones; the card's own are ticked.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { ICONS } from "./ui.js";

const DAY = 86400000;
/** How many completed iterations the menu offers, the latest last. */
const COMPLETED_SHOWN = 3;
/** How far a menu row sits below the one before it, for lining a submenu up with its row. */
const ROW_STEP = 26;
const MAIN_WIDTH = 200;
/** The space between the main menu and its submenu. */
const SUBMENU_GAP = 4;
/** The status shown for an item with none. */
const NO_STATUS = "No status";

/**
 * A key-down handler for a menu row: Enter or Space presses it, → opens its menu when it has
 * one, ← goes back to the main menu.
 * @param {{ press(cx: object): void, right?: boolean, onBack?: (cx: object) => void }} keys
 * @returns {(event: object, cx: object) => void}
 */
const rowKeys = ({ press, right = false, onBack }) => (event, cx) => {
  if (event.key === "enter" || event.key === "space" || (right && event.key === "right")) {
    cx.stop_propagation();
    press(cx);
  } else if (event.key === "left" && onBack) {
    cx.stop_propagation();
    onBack(cx);
  }
};

/**
 * Whether an iteration holds today.
 * @param {{ startDate: string, duration: number }} iteration An iteration: its start and length in days.
 * @param {number} now The time.
 * @returns {boolean}
 */
function isCurrent(iteration, now) {
  const start = Date.parse(iteration.startDate);
  return start <= now && now < start + iteration.duration * DAY;
}

/**
 * The iterations the menu offers: the last completed ones, then every open one.
 * @param {{ iterations: object[] } | null} field The board's Iteration field, from the load.
 * @returns {object[]}
 */
function offeredIterations(field) {
  if (!field) return [];
  const completed = field.iterations.filter((iteration) => iteration.completed);
  return [...completed.slice(-COMPLETED_SHOWN), ...field.iterations.filter((iteration) => !iteration.completed)];
}

/**
 * A menu row: a tick when it is the card's, the label, and a dim note. It is a Tab stop.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {{ label: string, note?: string, ticked: boolean, onPick(cx: object): void,
 *   focus?: object | null, onBack?: (cx: object) => void }} row `focus` is the focus handle the
 *   first row of a submenu tracks; `onBack` goes back to the main menu (←).
 * @returns {object} The row.
 */
function Row(t, id, { label, note, ticked, onPick, focus, onBack }) {
  return h_flex()
    .id(id)
    .h(ROW_STEP)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .tab_index(0)
    .when(Boolean(focus), (el) => el.track_focus(focus))
    .hover((style) => style.bg(t.hover))
    .focus((style) => style.bg(t.hover))
    .on_key_down(rowKeys({ press: onPick, onBack }))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onPick(cx);
    })
    .child(div().w(12).text_size(11.5).text_color(t.accent).child(ticked ? "✓" : ""))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(label))
    .when(Boolean(note), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(note)));
}

/**
 * A menu panel.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @returns {object}
 */
const Panel = (t, id) =>
  v_flex().id(id).w(240).max_h(380).overflow_y_scrollbar().p(4).rounded(8).bg(t.background).border_1().border_color(t.border).shadow_lg();

/**
 * A line of dim or red text in a menu.
 * @param {object} t The theme.
 * @param {string} text The text.
 * @param {string} [color] Its colour; dim by default.
 * @returns {object}
 */
const Line = (t, text, color) => div().px(8).py(4).text_size(11.5).text_color(color ?? t.dim).child(text);

/**
 * A top-level row: its name, the card's current value, and a chevron. Pointing at it or
 * clicking it opens its menu; from the keyboard, Enter, Space or → opens it and moves the
 * keyboard into it.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {{ icon?: string, label: string, value: string, open: boolean,
 *   onOpen(cx: object, keyboard?: boolean): void, focus?: object | null }} row Its icon (a status
 *   dot without one), name, current value, whether its menu is open, what opens it, and the focus
 *   handle the main menu's first row tracks.
 * @returns {object} The row.
 */
function SubmenuRow(t, id, { icon, label, value, open, onOpen, focus }) {
  return h_flex()
    .id(id)
    .h(ROW_STEP)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .tab_index(0)
    .when(Boolean(focus), (el) => el.track_focus(focus))
    .when(open, (el) => el.bg(t.hover))
    .hover((style) => style.bg(t.hover))
    .focus((style) => style.bg(t.hover))
    .on_key_down(rowKeys({ press: (cx) => onOpen(cx, true), right: true }))
    .on_hover((hovered, cx) => {
      if (hovered) onOpen(cx);
    })
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onOpen(cx);
    })
    .child(
      icon
        ? svg(icon).flex_none().size(13).text_color(t.muted)
        : div().flex_none().size(13).flex().items_center().justify_center().child(div().size(8).rounded_full().border_1().border_color(t.muted)),
    )
    .child(div().flex_none().text_size(12).text_color(t.foreground).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(value))
    .child(div().flex_none().text_size(12).text_color(t.dim).child("›"));
}

/**
 * The Move to menu: every column of the board, the card's own ticked.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {object} item The board item.
 * @param {{ columns: string[], onMove(status: string, cx: object): void, focus?: object | null,
 *   onBack(cx: object): void }} options
 * @returns {object} The menu.
 */
function MoveMenu(t, id, item, options) {
  const own = item.status ?? NO_STATUS;
  return Panel(t, id).children(
    options.columns.map((column, index) =>
      Row(t, `${id}-${column}`, {
        label: column,
        ticked: column === own,
        onPick: (cx) => options.onMove(column, cx),
        focus: index === 0 ? options.focus?.sub : null,
        onBack: options.onBack,
      }),
    ),
  );
}

/**
 * The Iteration menu: No iteration, then the offered iterations.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {object} item The board item.
 * @param {object} options The CardMenu options.
 * @returns {object} The menu.
 */
function IterationMenu(t, id, item, options) {
  if (!options.meta?.iteration) return Panel(t, id).child(Line(t, "The board has no Iteration field."));
  const now = Date.now();
  return Panel(t, id)
    .child(
      Row(t, `${id}-none`, {
        label: "No iteration",
        ticked: !item.iterationId,
        onPick: (cx) => options.onIteration(null, cx),
        focus: options.focus?.sub,
        onBack: options.onBack,
      }),
    )
    .children(
      offeredIterations(options.meta.iteration).map((iteration) =>
        Row(t, `${id}-${iteration.id}`, {
          label: iteration.title,
          note: isCurrent(iteration, now) ? "current" : iteration.completed ? "done" : "",
          ticked: item.iterationId === iteration.id,
          onPick: (cx) => options.onIteration(iteration, cx),
          onBack: options.onBack,
        }),
      ),
    );
}

/**
 * The Milestone menu: No milestone, then the repository's open milestones and the card's own.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {object} item The board item.
 * @param {object} options The CardMenu options.
 * @returns {object} The menu.
 */
function MilestoneMenu(t, id, item, options) {
  const milestones = options.milestones;
  if (!milestones || milestones.loading) return Panel(t, id).child(Line(t, "Loading…"));
  if (milestones.error) return Panel(t, id).child(Line(t, milestones.error, t.blocked));
  const list = [...milestones.list];
  if (item.milestone && !list.some((milestone) => milestone.id === item.milestone.id)) list.unshift({ ...item.milestone, dueOn: null });
  return Panel(t, id)
    .child(
      Row(t, `${id}-none`, {
        label: "No milestone",
        ticked: !item.milestone,
        onPick: (cx) => options.onMilestone(null, cx),
        focus: options.focus?.sub,
        onBack: options.onBack,
      }),
    )
    .children(
      list.map((milestone) =>
        Row(t, `${id}-${milestone.id}`, {
          label: milestone.title,
          note: milestone.dueOn ? `due ${milestone.dueOn.slice(5, 10)}` : "",
          ticked: item.milestone?.id === milestone.id,
          onPick: (cx) => options.onMilestone(milestone, cx),
          onBack: options.onBack,
        }),
      ),
    );
}

/**
 * The card menu: Move to, Iteration and Milestone, and the open one's menu beside them, level
 * with its row. A press outside the main menu reports `onOutside`; a press in the submenu
 * reports `onInside` after it, so the menu closes only when the press is outside both. Esc
 * anywhere in it reports `onClose` with `keyboard` true.
 * @param {object} item The board item.
 * @param {{ flip: boolean, meta: object | null, milestones: object | undefined, columns: string[],
 *   submenu: "status" | "iteration" | "milestone" | null,
 *   onSubmenu(name: string | null, cx: object, keyboard?: boolean): void,
 *   onMove(status: string, cx: object): void,
 *   onIteration(iteration: object | null, cx: object): void, onMilestone(milestone: object | null, cx: object): void,
 *   onClose(cx: object, keyboard?: boolean): void, onOutside(cx: object): void, onInside(): void,
 *   focus: { main: object, sub: object } | null }} options
 *   `milestones` is the repository's `{ list }`, `{ loading: true }` or `{ error }`. `flip` opens
 *   the submenu to the left. `focus` holds the handles the first row of the main menu and of the
 *   open submenu track, so the keyboard can be moved there.
 * @returns {object} The menu.
 */
export function CardMenu(item, options) {
  const t = theme();
  const id = `bv-menu-${item.itemId}`;
  const back = (cx) => options.onSubmenu(null, cx, true);
  const rows = [
    ...(options.columns.length ? [{ name: "status", label: "Move to", value: item.status ?? NO_STATUS }] : []),
    { name: "iteration", icon: ICONS.iteration, label: "Iteration", value: item.iteration ?? "None" },
    ...(item.kind === "draft"
      ? []
      : [{ name: "milestone", icon: ICONS.milestone, label: "Milestone", value: item.milestone?.title ?? "None" }]),
  ];
  const openIndex = rows.findIndex((row) => row.name === options.submenu);
  const main = Panel(t, `${id}-main`)
    .w(MAIN_WIDTH)
    .on_mouse_down_out((_event, cx) => options.onOutside(cx))
    .children(
      rows.map((row, index) =>
        SubmenuRow(t, `${id}-${row.name}`, {
          icon: row.icon,
          label: row.label,
          value: row.value,
          open: options.submenu === row.name,
          onOpen: (cx, keyboard) => options.onSubmenu(row.name, cx, keyboard),
          focus: index === 0 ? options.focus?.main : null,
        }),
      ),
    )
    .when(Boolean(options.claude), (el) =>
      el.child(
        Row(t, `${id}-claude`, {
          label: options.claude.label,
          note: options.claude.note,
          ticked: false,
          onPick: (cx) => options.claude.onPress(cx),
        }),
      ),
    );
  const subOptions = { ...options, onBack: back };
  const submenu =
    options.submenu === "status"
      ? MoveMenu(t, `${id}-moves`, item, subOptions)
      : options.submenu === "iteration"
        ? IterationMenu(t, `${id}-iterations`, item, subOptions)
        : options.submenu === "milestone"
          ? MilestoneMenu(t, `${id}-milestones`, item, subOptions)
          : null;
  const offset = MAIN_WIDTH + SUBMENU_GAP;
  return div()
    .id(id)
    .relative()
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      cx.stop_propagation();
      options.onClose(cx, true);
    })
    .child(main)
    .when(Boolean(submenu), (el) =>
      el.child(
        div()
          .absolute()
          .top(Math.max(0, openIndex) * ROW_STEP)
          .when(options.flip, (side) => side.right(offset))
          .when(!options.flip, (side) => side.left(offset))
          .on_mouse_down("left", () => options.onInside())
          .on_mouse_down("right", () => options.onInside())
          .child(submenu),
      ),
    );
}
