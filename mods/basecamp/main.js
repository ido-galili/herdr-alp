// Basecamp: the one dock on the window's right edge, beside the terminals. This mod is its
// header, a strip of four tabs over the `basecamp-body` stack: Files (the folder's tree, the
// `alp-files` mod; a file opens in an editor pane), Changes (Herdr's `changes`), Today (the
// trail, the `daypack` mod) and Run (the workspace's launch configs, tasks and saved commands,
// the `alp-runs` mod). Files and Changes show when the welcome turned them on
// (`shared("workspace.panels")`). The tab bar's Basecamp button shows or hides the dock.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { home, layout, readTextFile, run, settings, shared, terminals, theme } from "herdr";

const COLUMN_ID = "basecamp";
const STACK_ID = "basecamp-body";
const TABS = [
  { child: "files", panel: "files", label: "Files", icon: "mods/alp-tabs/files.svg" },
  { child: "changes", panel: "changes", label: "Changes", icon: "mods/alp-tabs/changes.svg" },
  { child: "basecamp-daypack", label: "Today", icon: "mods/daypack/backpack.svg" },
  { child: "basecamp-run", label: "Run", icon: "mods/alp-runs/play.svg" },
];
const STAMP_KEY = "alp.focusStamp";
// The tab bar's count of changed files where the Changes tab looks (alp-tabs counts them).
const CHANGED_KEY = "alp.changedFiles";
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

/**
 * The dock's tabs this layout has: Files and Changes only when the welcome turned them on, and
 * only the children the stack really holds.
 * @param {object | null} stack The layout's `basecamp-body` node.
 * @returns {typeof TABS}
 */
function dockTabs(stack) {
  const enabled = shared("workspace.panels") ?? ["files", "changes"];
  const held = new Set((stack?.children ?? []).map((child) => child.id));
  return TABS.filter((tab) => held.has(tab.child) && (!tab.panel || enabled.includes(tab.panel)));
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
  /** Starts with no trail count and no widths measured. */
  init() {
    this.trailStamp = undefined;
    this.trailOpen = 0;
    this.room = undefined; // the tab row's width, unzoomed px
    this.full = undefined; // the tabs' width with their icons, from the hidden copy
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
   * Remembers a width reported by on_size_change, and draws again when it moved.
   * @param {"room" | "full"} which The tab row's width, or the hidden copy's.
   * @param {number} width As reported: px at the app's zoom.
   * @param {object} cx The view's context.
   */
  measured(which, width, cx) {
    width /= settings().zoom || 1;
    if (this[which] !== undefined && Math.abs(this[which] - width) < 0.5) return;
    this[which] = width;
    cx.notify();
  }

  /**
   * One tab: its icon (when the strip has room), its name and its count, in the accent colour,
   * or the working colour for runs still running.
   * @param {object} t The theme.
   * @param {object} item One of TABS.
   * @param {{ on?: boolean, count: number, icons: boolean, measure?: boolean }} state
   * @returns {object}
   */
  tab(t, item, { on = false, count, icons, measure = false }) {
    const running = item.child === "basecamp-run";
    const tip =
      count > 0 &&
      (item.child === "changes"
        ? count === 1
          ? "1 changed file"
          : `${count} changed files`
        : running
          ? `${count} running`
          : `${count} open`);
    return h_flex()
      .id(`basecamp-tab-${item.child}${measure ? "-measure" : ""}`)
      .h(26)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(6)
      .text_size(12)
      .bg(on ? t.selected : t.chrome)
      .text_color(on ? t.foreground : t.muted)
      .when(!measure, (el) =>
        el
          .cursor_pointer()
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .on_click(() => run("layout.select", { stack: STACK_ID, child: item.child }))
          .when(Boolean(tip), (el) => el.tooltip(`${item.label}: ${tip}`)),
      )
      .when(icons, (el) => el.child(svg(item.icon).size(13).flex_none()))
      .child(item.label)
      .when(count > 0, (el) =>
        el.child(
          div()
            .text_size(11.5)
            .text_color(running ? t.working : t.accent)
            .child(count > 99 ? "99+" : String(count)),
        ),
      );
  }

  /**
   * The dock's tab strip: a tab per stack child with its count (changed files, open trail items,
   * runs still running), then ✕. The icons go when the dock is too narrow for them.
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    this.syncTrail(cx);
    const t = theme();
    const stack = find(layout(), STACK_ID);
    const tabs = dockTabs(stack);
    const active = stack?.active ?? tabs[0]?.child;
    const counts = {
      changes: shared(CHANGED_KEY) ?? 0,
      "basecamp-daypack": this.trailOpen,
      "basecamp-run": runningCount(),
    };
    const icons = this.room === undefined || this.full === undefined || this.full <= this.room;
    return h_flex()
      .id("basecamp")
      .size_full()
      .px(8)
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("basecamp-tabs")
          .flex_1()
          .min_w(0)
          .h_full()
          .gap(3)
          .items_center()
          .overflow_hidden()
          .relative()
          .on_size_change((size, cx) => this.measured("room", size.width, cx))
          .children(
            tabs.map((item) => this.tab(t, item, { on: item.child === active, count: counts[item.child] ?? 0, icons })),
          )
          // The hidden copy: every tab with its icon, to tell whether they fit.
          .child(
            h_flex()
              .absolute()
              .top(0)
              .left(0)
              .h_full()
              .gap(3)
              .items_center()
              .opacity(0)
              .on_size_change((size, cx) => this.measured("full", size.width, cx))
              .children(
                tabs.map((item) => this.tab(t, item, { count: counts[item.child] ?? 0, icons: true, measure: true })),
              ),
          ),
      )
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
          .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .on_click(() => run("layout.hide", { id: COLUMN_ID }))
          .child(svg(CLOSE_ICON).size(13)),
      );
  }
}
