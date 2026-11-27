// The Board card's menu, opened by a right click: Iteration and Milestone, each opening its own
// menu beside it, as a nested dropdown does. The submenu floats level with its row, to the right,
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
 * A menu row: a tick when it is the card's, the label, and a dim note.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {{ label: string, note?: string, ticked: boolean, onPick(cx: object): void }} row
 * @returns {object} The row.
 */
function Row(t, id, { label, note, ticked, onPick }) {
  return h_flex()
    .id(id)
    .h(ROW_STEP)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onPick(cx);
    })
    .child(div().w(12).text_size(11.5).text_color(t.accent).child(ticked ? "✓" : ""))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(label))
    .when(Boolean(note), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(note)));
}

/** A menu panel. */
const Panel = (t, id) =>
  v_flex().id(id).w(240).max_h(380).overflow_y_scrollbar().p(4).rounded(8).bg(t.background).border_1().border_color(t.border).shadow_lg();

/** A line of dim or red text in a menu. */
const Line = (t, text, color) => div().px(8).py(4).text_size(11.5).text_color(color ?? t.dim).child(text);

/**
 * A top-level row: its name, the card's current value, and a chevron. Pointing at it or
 * clicking it opens its menu.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {{ icon?: string, label: string, value: string, open: boolean, onOpen: Function }} row Its icon, name, current value, whether its menu is open, and what opens it.
 * @returns {object} The row.
 */
function SubmenuRow(t, id, { icon, label, value, open, onOpen }) {
  return h_flex()
    .id(id)
    .h(ROW_STEP)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(5)
    .cursor_pointer()
    .when(open, (el) => el.bg(t.hover))
    .hover((style) => style.bg(t.hover))
    .on_hover((hovered, cx) => {
      if (hovered) onOpen(cx);
    })
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onOpen(cx);
    })
    .child(svg(icon).flex_none().size(13).text_color(t.muted))
    .child(div().flex_none().text_size(12).text_color(t.foreground).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(value))
    .child(div().flex_none().text_size(12).text_color(t.dim).child("›"));
}

/** The Iteration menu: No iteration, then the offered iterations. */
function IterationMenu(t, id, item, options) {
  if (!options.meta?.iteration) return Panel(t, id).child(Line(t, "The board has no Iteration field."));
  const now = Date.now();
  return Panel(t, id)
    .child(Row(t, `${id}-none`, { label: "No iteration", ticked: !item.iterationId, onPick: (cx) => options.onIteration(null, cx) }))
    .children(
      offeredIterations(options.meta.iteration).map((iteration) =>
        Row(t, `${id}-${iteration.id}`, {
          label: iteration.title,
          note: isCurrent(iteration, now) ? "current" : iteration.completed ? "done" : "",
          ticked: item.iterationId === iteration.id,
          onPick: (cx) => options.onIteration(iteration, cx),
        }),
      ),
    );
}

/** The Milestone menu: No milestone, then the repository's open milestones and the card's own. */
function MilestoneMenu(t, id, item, options) {
  const milestones = options.milestones;
  if (!milestones || milestones.loading) return Panel(t, id).child(Line(t, "Loading…"));
  if (milestones.error) return Panel(t, id).child(Line(t, milestones.error, t.blocked));
  const list = [...milestones.list];
  if (item.milestone && !list.some((milestone) => milestone.id === item.milestone.id)) list.unshift({ ...item.milestone, dueOn: null });
  return Panel(t, id)
    .child(Row(t, `${id}-none`, { label: "No milestone", ticked: !item.milestone, onPick: (cx) => options.onMilestone(null, cx) }))
    .children(
      list.map((milestone) =>
        Row(t, `${id}-${milestone.id}`, {
          label: milestone.title,
          note: milestone.dueOn ? `due ${milestone.dueOn.slice(5, 10)}` : "",
          ticked: item.milestone?.id === milestone.id,
          onPick: (cx) => options.onMilestone(milestone, cx),
        }),
      ),
    );
}

/**
 * The card menu: Iteration and Milestone, and the open one's menu beside them, level with its row.
 * A press outside the main menu reports `onOutside`; a press in the submenu reports `onInside`
 * after it, so the menu closes only when the press is outside both.
 * @param {object} item The board item.
 * @param {{ flip: boolean, meta: object | null, milestones: object | undefined,
 *   submenu: "iteration" | "milestone" | null, onSubmenu(name: string, cx: object): void,
 *   onIteration(iteration: object | null, cx: object): void, onMilestone(milestone: object | null, cx: object): void,
 *   onOutside(cx: object): void, onInside(): void }} options
 *   `milestones` is the repository's `{ list }`, `{ loading: true }` or `{ error }`. `flip` opens
 *   the submenu to the left.
 * @returns {object} The menu.
 */
export function CardMenu(item, options) {
  const t = theme();
  const id = `bv-menu-${item.itemId}`;
  const rows = [
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
      rows.map((row) =>
        SubmenuRow(t, `${id}-${row.name}`, {
          icon: row.icon,
          label: row.label,
          value: row.value,
          open: options.submenu === row.name,
          onOpen: (cx) => options.onSubmenu(row.name, cx),
        }),
      ),
    );
  const submenu =
    options.submenu === "iteration"
      ? IterationMenu(t, `${id}-iterations`, item, options)
      : options.submenu === "milestone"
        ? MilestoneMenu(t, `${id}-milestones`, item, options)
        : null;
  const offset = MAIN_WIDTH + SUBMENU_GAP;
  return div()
    .id(id)
    .relative()
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
