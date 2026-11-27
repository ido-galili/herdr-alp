// Basecamp: the column on the window's right edge, beside the terminals. Its header switches
// between two tabs: Today (the trail, the `daypack` mod) and Run (the workspace's
// launch configs, tasks and saved commands, the `alp-runs` mod). The tab bar's Basecamp button
// shows or hides the column.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { home, layout, readTextFile, run, shared, terminals, theme } from "herdr";

const COLUMN_ID = "basecamp";
const STACK_ID = "basecamp-body";
const TABS = [
  { child: "basecamp-daypack", label: "Today", icon: "mods/daypack/backpack.svg" },
  { child: "basecamp-run", label: "Run", icon: "mods/alp-runs/play.svg" },
];
const STAMP_KEY = "alp.focusStamp";
const CLOSE_ICON = "mods/workspace-chrome/x.svg";

/**
 * Finds a node in the layout tree by id.
 * @param {object} node The tree.
 * @param {string} id The node's id.
 * @returns {object | null}
 */
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

/** How many runs are still running, from the run terminals' labels. */
export const runningCount = () =>
  terminals().filter(
    (terminal) => terminal.state === "live" && terminal.labels?.["alp.run"] && !terminal.labels["alp.run.exit"],
  ).length;

/**
 * How many trail items are still open, from the focus file Alpmeister and the Daypack keep.
 * @returns {Promise<number>} The count; 0 when the file is missing or unreadable.
 */
async function openTrailItems() {
  const text = await readTextFile(`${home()}/.local/state/alp/focus.json`);
  try {
    return (JSON.parse(text ?? "{}").items ?? []).filter((item) => !item.done).length;
  } catch {
    return 0;
  }
}

export default class Basecamp extends View {
  init() {
    this.trailStamp = undefined;
    this.trailOpen = 0;
  }

  /** Counts the open trail items again when Alpmeister or the Daypack says the list changed. */
  syncTrail(cx) {
    const stamp = shared(STAMP_KEY) ?? null;
    if (stamp === this.trailStamp) return;
    this.trailStamp = stamp;
    cx.spawn(async (cx) => {
      this.trailOpen = await openTrailItems();
      cx.notify();
    });
  }

  /**
   * The Basecamp tab strip: a tab per stack child, with its count (open trail items, or runs
   * still running in the working colour).
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    this.syncTrail(cx);
    const t = theme();
    const active = find(layout(), STACK_ID)?.active ?? TABS[0].child;
    const counts = { "basecamp-daypack": this.trailOpen, "basecamp-run": runningCount() };
    const stop = (_event, cx) => cx.stop_propagation();
    const tab = (item) => {
      const on = item.child === active;
      const count = counts[item.child];
      return h_flex()
        .id(`basecamp-tab-${item.child}`)
        .h(26)
        .px(8)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .cursor_pointer()
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((style) => style.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("layout.select", { stack: STACK_ID, child: item.child }))
        .child(svg(item.icon).size(13).flex_none())
        .child(item.label)
        .when(count > 0, (el) =>
          el.child(
            div()
              .text_size(11.5)
              .text_color(item.child === "basecamp-run" ? t.working : t.accent)
              .child(String(count)),
          ),
        );
    };
    return h_flex()
      .id("basecamp")
      .size_full()
      .px(8)
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .children(TABS.map(tab))
      .child(div().flex_1())
      .child(
        h_flex()
          .id("basecamp-close")
          .flex_none()
          .size(22)
          .items_center()
          .justify_center()
          .rounded(5)
          .cursor_pointer()
          .text_color(t.dim)
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .tooltip("Hide Basecamp")
          .on_mouse_down("left", stop)
          .on_click(() => run("layout.hide", { id: COLUMN_ID }))
          .child(svg(CLOSE_ICON).size(13)),
      );
  }
}
