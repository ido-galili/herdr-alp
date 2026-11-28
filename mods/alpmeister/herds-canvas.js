// The Herds map: the herds as one graph you can pan, zoom and rearrange, like a flow editor.
// Each herd is a tree, its herdsman on top, members and agents below, agents under the sessions
// that started them, and the herds side by side. Under them, a labelled "Grazing" lane holds the
// sessions on their own, wrapped to the map's width. The lines are painted paths, curved or with
// square corners (Lines ▾), each labelled with how the two are linked. Drag the background to
// pan, drag a card to move it and everything under it (they stay where you put them), scroll to
// pan, and Cmd- or Ctrl-scroll to zoom. The class also keeps what the whole Herds tab remembers:
// Map or Cards, full tab, the key, the session hovered and the outlined Needs you cards.

import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { run, settings } from "herdr";
import { agentChildren, agentsByAge } from "./herds-data.js";
import { BgTag, CARD, LinkButton, RoleIcon, SessionCard, StatusMark, agentLine, linkLine, linkTo, sortedBySpace, statusOf } from "./herds-view.js";
import { ICONS, IconButton, Segmented, TextButton, ago, formatTime } from "./ui.js";

/** Card sizes on the canvas at 100%: a session's is the one card both views draw. */
const SESSION = CARD;
const AGENT = { w: 180, h: 54 };

/** Room between cards side by side, between a card and the row below it, and between herds. */
const GAP_X = 24;
const GAP_Y = 64;
const HERD_GAP = 80;

/** The grazing lane: its distance under the herds, the room for its label, the gap between cards. */
const LANE_GAP = 56;
const LANE_LABEL = 26;
const LANE_CARD_GAP = 12;

/** How far you can zoom out and in. */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

/** Fit never shrinks the herds below this: past it the map scrolls, so the names stay readable. */
const FIT_MIN = 0.8;

/** Room Fit keeps around the herds. */
const FIT_PAD = 32;

/** The zooms the zoom menu offers. */
const ZOOM_STEPS = [0.5, 0.8, 1, 1.5];

/** Below this zoom a card shows its name and status only: smaller text would not read. */
const COMPACT_BELOW = 0.6;

/** A press that moves less than this is a click (open the tab), not a drag. */
const CLICK_SLOP = 4;

/** The line styles to pick from in Lines ▾, each with a small line of its shape. */
export const EDGE_STYLES = [
  { value: "curved", icon: ICONS.lineCurved, label: "Curved" },
  { value: "step", icon: ICONS.lineStep, label: "Square corners" },
];

/** The two views behind the switch. */
const VIEWS = [
  { value: "map", label: "Map", tooltip: "The herds as a map, grazing under them" },
  { value: "cards", label: "Cards", tooltip: "Every session as a card, Needs you first" },
];

/** Where the canvas keeps your choices and the cards you moved, in this mod's own storage. */
const STORE_KEY = "alpmeister.herds.canvas";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const isView = (view) => VIEWS.some((option) => option.value === view);

/** Reads what the canvas kept from before: the line style, the moved cards, the views, the key. */
function remembered() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/**
 * One herd as a tree of cards: `{ key, kind, session, agent?, role, size, children: [{ node,
 * line }] }`, where `line` is how the line to that child reads ({ label, dotted }).
 */
function herdTree(herd, actions) {
  const agentNodes = (session, agents) =>
    agents.map((agent) => ({ node: agentNode(session, agent), line: agentLine(agent) }));
  const agentNode = (session, agent) => ({
    key: `a:${session.id}:${agent.id}`,
    kind: "agent",
    session,
    agent,
    role: agent.fork ? "fork" : "agent",
    size: AGENT,
    children: agentNodes(session, agentChildren(session, agent)),
  });
  const shownAgents = (session) => {
    const { recent, earlier } = agentsByAge(session);
    return actions.expandedAgents?.has(session.id) ? [...earlier, ...recent] : recent;
  };
  const sessionNode = (session, role, children) => ({
    key: `s:${session.id}`,
    kind: "session",
    session,
    role,
    size: SESSION,
    earlier: agentsByAge(session).earlier.length,
    children,
  });
  return sessionNode(herd.herdsman, "herdsman", [
    ...herd.members.map((member) => ({
      node: sessionNode(member, "member", agentNodes(member, shownAgents(member))),
      line: linkLine(linkTo(herd, member)),
    })),
    ...agentNodes(herd.herdsman, shownAgents(herd.herdsman)),
  ]);
}

/** How wide a tree is: its card, or its children side by side, whichever is wider. */
function treeWidth(node) {
  const below = node.children.reduce((sum, { node: child }) => sum + treeWidth(child), 0);
  const gaps = Math.max(0, node.children.length - 1) * GAP_X;
  return Math.max(node.size.w, below + gaps);
}

/**
 * Places a tree with its left edge at `left` and its top at `top`, a parent centered over its
 * children. Fills `cards` with `{ node, x, y }` and `lines` with `{ from, to, label, dotted }`.
 */
function place(node, left, top, cards, lines) {
  const width = treeWidth(node);
  const card = { node, x: left + (width - node.size.w) / 2, y: top };
  cards.push(card);
  const below = node.children.reduce((sum, { node: child }) => sum + treeWidth(child), 0);
  const gaps = Math.max(0, node.children.length - 1) * GAP_X;
  let x = left + (width - below - gaps) / 2;
  for (const { node: child, line } of node.children) {
    const placed = place(child, x, top + node.size.h + GAP_Y, cards, lines);
    lines.push({ from: card, to: placed, ...line });
    x += treeWidth(child) + GAP_X;
  }
  return card;
}

/**
 * The edges of a set of cards.
 * @param {object[]} cards Placed cards.
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
function boundsOf(cards) {
  if (!cards.length) return null;
  return {
    left: Math.min(...cards.map((card) => card.x)),
    top: Math.min(...cards.map((card) => card.y)),
    right: Math.max(...cards.map((card) => card.x + card.node.size.w)),
    bottom: Math.max(...cards.map((card) => card.y + card.node.size.h)),
  };
}

/**
 * A menu under a toolbar button: an optional heading, then rows of a tick column, an optional
 * icon and the label. It closes on a press outside it.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {string | null} heading The heading, or null.
 * @param {{ key: string, label: string, icon?: string, ticked?: boolean, onPick: Function }[]} rows
 * @param {Function} onClose Called with the window context on a press outside.
 * @returns {object} The menu.
 */
function Menu(t, id, heading, rows, onClose) {
  return v_flex()
    .id(id)
    .w(180)
    .p(6)
    .gap(2)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.popover ?? t.background)
    .shadow_lg()
    .on_mouse_down_out((_event, cx) => onClose(cx))
    .when(Boolean(heading), (el) => el.child(div().px(8).py(3).text_size(11.5).font_semibold().text_color(t.dim).child(heading)))
    .children(
      rows.map((row) =>
        h_flex()
          .id(`${id}-${row.key}`)
          .h(26)
          .px(8)
          .gap(8)
          .items_center()
          .rounded(5)
          .text_size(12)
          .text_color(row.ticked ? t.foreground : t.muted)
          .bg(row.ticked ? t.hover : t.popover ?? t.background)
          .cursor_pointer()
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            row.onPick(cx);
          })
          .child(
            div()
              .w(12)
              .flex_none()
              .when(Boolean(row.ticked), (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.done))),
          )
          .when(Boolean(row.icon), (el) => el.child(svg(row.icon).size(15).flex_none()))
          .child(div().flex_1().min_w(0).truncate().child(row.label)),
      ),
    );
}

/**
 * A toolbar button that opens a menu: its label and a chevron, lit while the menu is open.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {string} label The label.
 * @param {boolean} open Whether its menu is open.
 * @param {Function} onClick Called with the window context.
 * @param {string} tooltip The tooltip.
 * @returns {object} The button.
 */
function MenuButton(t, id, label, open, onClick, tooltip) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(22)
    .px(8)
    .gap(4)
    .items_center()
    .rounded(6)
    .text_size(11.5)
    .text_color(open ? t.foreground : t.muted)
    .bg(open ? t.selected ?? t.hover : t.background)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .tooltip(tooltip)
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(label)
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).flex_none());
}

/**
 * The Herds map and everything the Herds tab remembers: Map or Cards (one choice in a tab and one
 * in full tab), the line style, the pan and zoom, the cards you moved (as offsets from where the
 * layout puts them, so a moved card stays put when herds come and go), and whether the key is
 * hidden. A card's offset is on top of its parent's, so moving a card moves everything under it,
 * and a card that shows up later under a moved one shows up under it.
 */
export class HerdsCanvas {
  /**
   * @param {{ view?: "map" | "cards", full?: boolean }} [start] How a copy opens, for demos and
   *   screenshots: on the Map or on Cards, and in full tab. Not remembered until you switch.
   */
  constructor(start = {}) {
    const kept = remembered();
    this.edges = EDGE_STYLES.some((style) => style.value === kept.edges) ? kept.edges : "curved";
    this.moved = kept.moved && typeof kept.moved === "object" ? kept.moved : {};
    // Offsets kept before they stacked were each a card's own: made relative on the first layout.
    this.flat = !kept.nested && Object.keys(this.moved).length > 0;
    // Cards in a tab, the Map in full tab, until you pick the other.
    this.views = {
      tab: isView(kept.views?.tab) ? kept.views.tab : "cards",
      full: isView(kept.views?.full) ? kept.views.full : "map",
    };
    this.keyHidden = kept.keyHidden === true;
    this.pan = { x: 24, y: 24 };
    this.zoom = 1;
    this.size = null;
    // Fit once the canvas knows its size, and again whenever it changes or the layout resets.
    this.refit = true;
    // The Herds tab filling the whole Alp tab, instead of sitting under its header.
    this.full = start.full === true;
    if (isView(start.view)) this.views[this.full ? "full" : "tab"] = start.view;
    // { kind: "pan" | "card", key?, start, origin, moved } while the mouse is down.
    this.drag = null;
    // The cards as last laid out, for Fit and for finding a card.
    this.cards = [];
    // The session under the pointer, lit wherever it shows; the Needs you cards outlined.
    this.hot = null;
    this.outlineBlocked = false;
    // The menu open in the toolbar: "zoom", "lines" or null.
    this.menu = null;
    // Cards' "Background, no tab" line, unfolded.
    this.backgroundOpen = false;
  }

  /** Keeps the choices and the moved cards for next time. */
  remember() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ edges: this.edges, moved: this.moved, nested: true, views: this.views, keyHidden: this.keyHidden }),
      );
    } catch (error) {
      console.log(`alpmeister: canvas not remembered: ${error}`);
    }
  }

  /** The view showing: Map or Cards, as last picked in a tab or in full tab. */
  get view() {
    return this.views[this.full ? "full" : "tab"];
  }

  /**
   * Shows the Map or Cards, remembered for this place (a tab or full tab).
   * @param {"map" | "cards"} view
   * @param {object} cx The window context.
   */
  setView(view, cx) {
    this.views[this.full ? "full" : "tab"] = view;
    this.menu = null;
    if (view === "map") this.refit = true;
    this.remember();
    cx.notify();
  }

  /** Fills the whole tab with the Herds tab, or puts it back under the header, then fits. */
  setFull(full, cx) {
    this.full = full;
    this.menu = null;
    this.refit = true;
    cx.notify();
  }

  /** Picks the line style, from Lines ▾. */
  setEdges(edges, cx) {
    this.edges = edges;
    this.menu = null;
    this.remember();
    cx.notify();
  }

  /** Hides or shows the key, remembered. */
  setKeyHidden(hidden, cx) {
    this.keyHidden = hidden;
    this.remember();
    cx.notify();
  }

  /** Lights a session wherever it shows (null: none), redrawing only on a change. */
  setHot(sessionId, cx) {
    if (this.hot === sessionId) return;
    this.hot = sessionId;
    cx.notify();
  }

  /** Folds or unfolds Cards' "Background, no tab" line. */
  toggleBackground(cx) {
    this.backgroundOpen = !this.backgroundOpen;
    cx.notify();
  }

  /**
   * The red pill's click: outlines the sessions that need you, or stops. On the Map it also
   * scrolls to the first of them.
   * @param {object[]} herds herdsOf()'s herds.
   * @param {Map} live The live tabs by terminal.
   * @param {object} actions The Herds tab's actions.
   * @param {object} cx The window context.
   */
  toggleOutline(herds, live, actions, cx) {
    this.outlineBlocked = !this.outlineBlocked;
    if (this.outlineBlocked && this.view === "map" && herds.length) {
      const first = this.cards.find((card) => card.node.kind === "session" && statusOf(card.node.session, live) === "blocked");
      if (first) this.scrollTo(first);
    }
    cx.notify();
  }

  /** Pans so a card sits in the middle of the map, at the zoom it has. */
  scrollTo(card) {
    if (!this.size) return;
    this.pan = {
      x: this.size.width / 2 - (card.x + card.node.size.w / 2) * this.zoom,
      y: this.size.height / 2 - (card.y + card.node.size.h / 2) * this.zoom,
    };
  }

  /** Zooms by `factor` around a point on the canvas (its middle by default). */
  zoomBy(factor, cx, at) {
    const point = at ?? { x: (this.size?.width ?? 800) / 2, y: (this.size?.height ?? 500) / 2 };
    const next = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const wx = (point.x - this.pan.x) / this.zoom;
    const wy = (point.y - this.pan.y) / this.zoom;
    this.zoom = next;
    this.pan = { x: point.x - wx * next, y: point.y - wy * next };
    this.menu = null;
    cx?.notify();
  }

  /** The zoom Fit picks for the herds: all of them, at 100% at most and FIT_MIN at least. */
  fitZoom(herdBounds) {
    if (!herdBounds || !this.size) return 1;
    return clamp(
      Math.min(
        (this.size.width - FIT_PAD * 2) / (herdBounds.right - herdBounds.left),
        (this.size.height - FIT_PAD * 2) / (herdBounds.bottom - herdBounds.top),
        1,
      ),
      FIT_MIN,
      1,
    );
  }

  /**
   * Zooms and pans to the herds first (the grazing lane is under them, a scroll away), at 100% at
   * most and FIT_MIN at least: herds too big for that stay readable and the map scrolls.
   */
  fit(cx) {
    const herdCards = this.cards.filter((card) => !card.lane);
    const bounds = boundsOf(herdCards.length ? herdCards : this.cards);
    if (!bounds || !this.size) return;
    const zoom = this.fitZoom(bounds);
    const wide = (bounds.right - bounds.left) * zoom;
    this.zoom = zoom;
    this.pan = {
      x: wide <= this.size.width - FIT_PAD * 2 ? (this.size.width - wide) / 2 - bounds.left * zoom : FIT_PAD - bounds.left * zoom,
      y: FIT_PAD - bounds.top * zoom,
    };
    this.menu = null;
    cx?.notify();
  }

  /** Puts every moved card back where the layout wants it, then fits. */
  resetLayout(cx) {
    this.moved = {};
    this.remember();
    this.refit = true;
    cx.notify();
  }

  /** A point of the graph on the canvas. */
  toScreen(x, y) {
    return { x: this.pan.x + x * this.zoom, y: this.pan.y + y * this.zoom };
  }

  /** The Map | Cards switch, in the toolbar where the line style used to be. */
  switcher() {
    return [Segmented("herds-view", VIEWS, this.view, (view, cx) => this.setView(view, cx))];
  }

  /** Full tab, or back: the last control in the toolbar. */
  fullButton() {
    return this.full
      ? IconButton("herds-full", ICONS.exitFullTab, (cx) => this.setFull(false, cx), { tooltip: "Exit full tab" })
      : IconButton("herds-full", ICONS.fullTab, (cx) => this.setFull(true, cx), { tooltip: "Full tab: fill the whole tab with Herds" });
  }

  /**
   * The Map's own controls, which hide on Cards: Fit, the zoom menu, Lines ▾, and Reset layout
   * once you have moved a card.
   * @param {object} t The theme.
   * @returns {object[]} The controls.
   */
  mapControls(t) {
    const close = (cx) => {
      this.menu = null;
      cx.notify();
    };
    const toggle = (menu) => (cx) => {
      this.menu = this.menu === menu ? null : menu;
      cx.notify();
    };
    const percent = Math.round(this.zoom * 100);
    const zoomMenu = Menu(
      t,
      "herds-zoom-menu",
      null,
      [
        { key: "in", label: "Zoom in", onPick: (cx) => this.zoomBy(1.2, cx) },
        { key: "out", label: "Zoom out", onPick: (cx) => this.zoomBy(1 / 1.2, cx) },
        ...ZOOM_STEPS.map((step) => ({
          key: String(step * 100),
          label: `${step * 100}%`,
          ticked: Math.round(step * 100) === percent,
          onPick: (cx) => this.zoomBy(step / this.zoom, cx),
        })),
      ],
      close,
    );
    const linesMenu = Menu(
      t,
      "herds-lines-menu",
      "Lines",
      EDGE_STYLES.map((style) => ({
        key: style.value,
        label: style.label,
        icon: style.icon,
        ticked: style.value === this.edges,
        onPick: (cx) => this.setEdges(style.value, cx),
      })),
      close,
    );
    return [
      TextButton("herds-fit", "Fit", (cx) => this.fit(cx), { tooltip: "Fit: show the herds" }),
      Popup.new(
        "herds-zoom",
        MenuButton(t, "herds-zoom-button", `${percent}%`, this.menu === "zoom", toggle("zoom"), "Zoom (or Cmd-scroll on the map)"),
      )
        .anchor("top_right")
        .when(this.menu === "zoom", (el) => el.content(zoomMenu)),
      Popup.new("herds-lines", MenuButton(t, "herds-lines-button", "Lines", this.menu === "lines", toggle("lines"), "How the lines are drawn"))
        .anchor("top_right")
        .when(this.menu === "lines", (el) => el.content(linesMenu)),
      Object.keys(this.moved).length
        ? IconButton("herds-reset", ICONS.resetLayout, (cx) => this.resetLayout(cx), {
            tooltip: "Reset layout: put the cards you moved back in place",
          })
        : null,
    ].filter(Boolean);
  }

  /**
   * Lays the herds out side by side, each card moved by as much as you dragged it and its
   * parents (a card's offset carries everything under it along), then the grazing lane under
   * them, wrapped to the map's width at the zoom Fit picks.
   * @param {object[]} herds herdsOf()'s herds.
   * @param {object[]} grazing The grazing sessions with a tab, in order.
   * @param {object} actions The Herds tab's actions.
   * @returns {{ cards: object[], lines: object[], lane: object | null }}
   */
  layout(herds, grazing, actions) {
    const cards = [];
    const lines = [];
    let left = 0;
    for (const herd of herds) {
      const tree = herdTree(herd, actions);
      place(tree, left, 0, cards, lines);
      left += treeWidth(tree) + HERD_GAP;
    }
    const parent = new Map(lines.map((line) => [line.to, line.from]));
    if (this.flat && cards.length) this.nest(cards, parent);
    // place() puts a parent before its children, so its total offset is known by then.
    const total = new Map();
    for (const card of cards) {
      const own = this.moved[card.node.key] ?? { dx: 0, dy: 0 };
      const above = total.get(parent.get(card)) ?? { dx: 0, dy: 0 };
      const offset = { dx: above.dx + own.dx, dy: above.dy + own.dy };
      total.set(card, offset);
      card.x += offset.dx;
      card.y += offset.dy;
    }
    const herdBounds = boundsOf(cards);
    let lane = null;
    if (grazing.length) {
      const laneLeft = herdBounds?.left ?? 0;
      const zoom = this.fitZoom(herdBounds);
      const width = Math.max(
        herdBounds ? herdBounds.right - herdBounds.left : 0,
        this.size ? (this.size.width - FIT_PAD * 2) / zoom : 800,
        SESSION.w,
      );
      const top = (herdBounds?.bottom ?? 0) + LANE_GAP;
      lane = { left: laneLeft, top, width, count: grazing.length };
      const perRow = Math.max(1, Math.floor((width + LANE_CARD_GAP) / (SESSION.w + LANE_CARD_GAP)));
      grazing.forEach((session, index) => {
        const key = `g:${session.id}`;
        const own = this.moved[key] ?? { dx: 0, dy: 0 };
        cards.push({
          node: { key, kind: "session", session, role: "grazing", size: SESSION, earlier: 0, children: [] },
          lane: true,
          x: laneLeft + (index % perRow) * (SESSION.w + LANE_CARD_GAP) + own.dx,
          y: top + LANE_LABEL + Math.floor(index / perRow) * (SESSION.h + LANE_CARD_GAP) + own.dy,
        });
      });
    }
    return { cards, lines, lane };
  }

  /**
   * Turns offsets kept before they stacked (each card's own) into offsets on top of the parent's,
   * so the cards stay where they were.
   */
  nest(cards, parent) {
    const flat = { ...this.moved };
    const own = (card) => flat[card.node.key] ?? { dx: 0, dy: 0 };
    for (const card of cards) {
      const up = parent.get(card);
      if (!up || !(flat[card.node.key] || flat[up.node.key])) continue;
      const mine = own(card);
      const theirs = own(up);
      this.moved[card.node.key] = { dx: mine.dx - theirs.dx, dy: mine.dy - theirs.dy };
    }
    this.flat = false;
    this.remember();
  }

  /** Where a line leaves its parent and meets its child: bottom middle to top middle. */
  ends(line) {
    const from = this.toScreen(line.from.x + line.from.node.size.w / 2, line.from.y + line.from.node.size.h);
    const to = this.toScreen(line.to.x + line.to.node.size.w / 2, line.to.y);
    return { from, to };
  }

  /** Adds one line to a path in the chosen style. */
  trace(path, from, to) {
    if (this.edges === "step") {
      const mid = (from.y + to.y) / 2;
      const dx = to.x - from.x;
      const r = Math.min(8 * this.zoom, Math.abs(dx) / 2, Math.abs(to.y - from.y) / 2);
      if (Math.abs(dx) < 1 || r <= 0) return path.move_to(from.x, from.y).line_to(from.x, mid).line_to(to.x, mid).line_to(to.x, to.y);
      const sx = Math.sign(dx);
      const sy = Math.sign(to.y - from.y) || 1;
      return path
        .move_to(from.x, from.y)
        .line_to(from.x, mid - sy * r)
        .curve_to(from.x + sx * r, mid, from.x, mid)
        .line_to(to.x - sx * r, mid)
        .curve_to(to.x, mid + sy * r, to.x, mid)
        .line_to(to.x, to.y);
    }
    const bend = Math.max(30 * this.zoom, Math.abs(to.y - from.y) / 2);
    return path.move_to(from.x, from.y).cubic_bezier_to(to.x, to.y, from.x, from.y + bend, to.x, to.y - bend);
  }

  /** The lines, solid and dotted, as two painted paths, then the arrowheads as a third. */
  paintedLines(t, lines) {
    const width = Math.max(1, 1.25 * this.zoom);
    let solid = PathBuilder.stroke(width);
    let dotted = PathBuilder.stroke(width).dash_array([4 * this.zoom, 4 * this.zoom]);
    let heads = PathBuilder.fill();
    let solidCount = 0;
    let dottedCount = 0;
    const s = Math.max(3, 4.5 * this.zoom);
    for (const line of lines) {
      const { from, to } = this.ends(line);
      if (line.dotted) {
        dotted = this.trace(dotted, from, to);
        dottedCount += 1;
      } else {
        solid = this.trace(solid, from, to);
        solidCount += 1;
      }
      // Both styles arrive straight down, so the arrowhead points down.
      heads = heads.add_polygon(
        [
          [to.x - s, to.y - s * 1.6],
          [to.x + s, to.y - s * 1.6],
          [to.x, to.y],
        ],
        true,
      );
    }
    return [
      solidCount ? window.paint_path(solid.build(), t.muted).absolute().inset_0() : null,
      dottedCount ? window.paint_path(dotted.build(), t.dim).absolute().inset_0() : null,
      lines.length ? window.paint_path(heads.build(), t.muted).absolute().inset_0() : null,
    ].filter(Boolean);
  }

  /**
   * A point `f` of the way along a line (0 at the parent, 1 at the child), in the chosen style.
   */
  along(from, to, f) {
    if (this.edges === "step") {
      const mid = (from.y + to.y) / 2;
      return f <= 0.5
        ? { x: from.x, y: from.y + (mid - from.y) * f * 2 }
        : { x: to.x, y: mid + (to.y - mid) * (f - 0.5) * 2 };
    }
    const bend = Math.max(30 * this.zoom, Math.abs(to.y - from.y) / 2);
    const [a, b, c, d] = [from, { x: from.x, y: from.y + bend }, { x: to.x, y: to.y - bend }, to];
    const u = 1 - f;
    const mix = (key) => u * u * u * a[key] + 3 * u * u * f * b[key] + 3 * u * f * f * c[key] + f * f * f * d[key];
    return { x: mix("x"), y: mix("y") };
  }

  /**
   * Each line's label, beside the line three quarters of the way down, where the lines from one
   * parent have spread apart (halfway, they start out too close and the labels pile up).
   */
  labels(t, lines) {
    return lines
      .filter((line) => line.label)
      .map((line) => {
        const { from, to } = this.ends(line);
        const size = Math.max(8, 11.5 * this.zoom);
        const at = this.along(from, to, 0.72);
        return div()
          .absolute()
          .left(at.x + 5)
          .top(at.y - size * 0.8)
          .px(4)
          .rounded(4)
          .bg(t.canvas)
          .text_size(size)
          .text_color(t.dim)
          .child(line.label);
      });
  }

  /**
   * The grazing lane's label and the dashed rule it sits on, and with sessions that have no tab
   * (they are not on the map), a link to them on Cards.
   * @param {object} t The theme.
   * @param {{ left: number, top: number, width: number, count: number }} lane From layout().
   * @param {number} background How many grazing sessions have no tab.
   * @returns {object[]} The elements.
   */
  laneMarks(t, lane, background) {
    const z = this.zoom;
    const at = this.toScreen(lane.left - 16, lane.top);
    const size = Math.max(8, 11.5 * z);
    const rule = PathBuilder.stroke(1)
      .dash_array([4, 4])
      .move_to(at.x, at.y)
      .line_to(at.x + (lane.width + 32) * z, at.y);
    return [
      window.paint_path(rule.build(), t.border).absolute().inset_0(),
      h_flex()
        .absolute()
        .left(at.x + 8 * z)
        .top(at.y - size * 0.75)
        .gap(8)
        .items_center()
        .child(div().px(6).bg(t.canvas).text_size(size).font_semibold().text_color(t.dim).child(`Grazing · ${lane.count}`))
        .when(background > 0, (el) =>
          el.child(
            div()
              .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
              .bg(t.canvas)
              .child(
                TextButton("herds-lane-background", `Background, no tab · ${background}`, (cx) => {
                  this.backgroundOpen = true;
                  this.setView("cards", cx);
                }, { tooltip: "Sessions with no tab are on Cards" }),
              ),
          ),
        ),
    ];
  }

  /**
   * One card where the layout (and your dragging) put it: press to drag, click to open its tab.
   * A session draws the card both views share; an agent draws its own box.
   */
  card(t, card, live, actions) {
    const { node } = card;
    const z = this.zoom;
    const at = this.toScreen(card.x, card.y);
    const compact = z < COMPACT_BELOW;
    const session = node.session;
    const hasTab = live.has(session.terminal);
    const press = (event, cx) => {
      this.drag = {
        kind: "card",
        key: node.key,
        start: event.position,
        origin: this.moved[node.key] ?? { dx: 0, dy: 0 },
        moved: false,
        terminal: !node.agent && hasTab && !actions.model?.demo ? session.terminal : null,
      };
      cx.notify();
    };
    if (node.agent) return this.agentCard(t, card, at, compact).on_mouse_down("left", press);
    const earlier = node.earlier ?? 0;
    const open = actions.expandedAgents?.has(session.id);
    // A background session runs in no terminal: link it by hand to the tab that shows it. The
    // press stays on the button, so it doesn't start dragging the card.
    const link = LinkButton(session, actions, "hc");
    return SessionCard(t, session, live, actions, {
      id: `hc-${node.key}`,
      z,
      role: node.role,
      compact,
      tooltip: hasTab ? "Click to open its tab · drag to move it and what's under it" : "Drag to move it and what's under it",
      extras: [
        earlier > 0 ? this.earlierToggle(t, session, earlier, open, actions, Math.max(8, 11.5 * z)) : null,
        link ? div().flex_none().on_mouse_down("left", (_event, cx) => cx.stop_propagation()).child(link) : null,
      ],
    })
      .absolute()
      .left(at.x)
      .top(at.y)
      .cursor_grab()
      .on_mouse_down("left", press);
  }

  /**
   * An agent's box: what it is for and its mark (the lamb for a fork, the dog for another agent,
   * and "bg" while it runs in the background), then how long it has run.
   * @param {object} t The theme.
   * @param {object} card The placed card.
   * @param {{ x: number, y: number }} at Where it sits on the canvas.
   * @param {boolean} compact Whether to show its first line only.
   * @returns {object} The box.
   */
  agentCard(t, card, at, compact) {
    const { node } = card;
    const agent = node.agent;
    const z = this.zoom;
    const text = (size) => Math.max(8, size * z);
    const hot = this.hot === node.session.id;
    const tooltip = `${agent.description}\n${agent.fork ? "fork of the session" : `${agent.type} agent`} · ${
      agent.background ? "in the background" : "in the foreground"
    }${agent.model ? ` · model ${agent.model}` : ""}${agent.startedAt ? ` · started ${formatTime(agent.startedAt)}` : ""}`;
    return v_flex()
      .id(`hc-${node.key}`)
      .absolute()
      .left(at.x)
      .top(at.y)
      .w(node.size.w * z)
      .h(node.size.h * z)
      .px(Math.max(4, 9 * z))
      .justify_center()
      .gap(Math.max(1, 3 * z))
      .overflow_hidden()
      .rounded(Math.max(4, 7 * z))
      .border_1()
      .border_color(hot ? t.accent : agent.status === "working" ? `${t.working}66` : t.border)
      .bg(t.background)
      .cursor_grab()
      .hover((style) => style.bg(t.hover))
      .tooltip(tooltip)
      .child(
        h_flex()
          .gap(Math.max(3, 5 * z))
          .items_center()
          .min_w(0)
          .child(StatusMark(t, agent.status))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(text(11.5))
              .font_medium()
              .text_color(agent.finished ? t.muted : t.foreground)
              .child(agent.description),
          )
          .when(agent.background, (el) => el.child(BgTag(t, `hc-bg-${node.key}`, z)))
          .when(!compact, (el) => el.child(RoleIcon(t, `hc-role-${node.key}`, node.role, undefined, text(13)))),
      )
      .when(!compact, (el) =>
        el.child(div().min_w(0).truncate().text_size(text(11.5)).text_color(t.dim).child(this.agentWhen(agent))),
      );
  }

  /** How long an agent has run, or when it finished. */
  agentWhen(agent) {
    const now = Date.now();
    if (agent.finished) return `done ${ago(now - (agent.lastAt ?? now))} ago`;
    if (!agent.startedAt) return "";
    return `${ago(now - agent.startedAt)}${agent.status === "idle" ? " · quiet" : ""}`;
  }

  /**
   * "+ N earlier" in a session's card: shows or folds the agents it finished a while ago. The
   * press stays with the button (on the way up it would start dragging the card or the canvas,
   * and the button's click then swallows the release, so the drag never ends).
   */
  earlierToggle(t, session, count, open, actions, size) {
    const label = open ? "hide earlier" : `+ ${count} earlier`;
    return div()
      .flex_none()
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .child(
        div()
          .id(`hc-earlier-${session.id}`)
          .px(4)
          .rounded(4)
          .text_size(size)
          .text_color(t.accent)
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .tooltip(open ? "Hide the agents that finished earlier" : `Show the ${count} agents that finished earlier`)
          .on_click((_event, cx) => {
            cx.stop_propagation();
            actions.toggleAgents(session.id, cx);
          })
          .child(label),
      );
  }

  /** Ends a drag: a card moved is kept where it was dropped, a card pressed and let go opens. */
  endDrag(cx) {
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind === "card") {
      if (drag.moved) this.remember();
      else if (drag.terminal) run("pane.focus", { terminal: drag.terminal });
    }
    cx.notify();
  }

  /**
   * The map, `height` tall: the lines, their labels, the cards, the grazing lane under the herds,
   * then a hint in the corner.
   * @param {object} t The theme.
   * @param {{ herds: object[], grazing: object[] }} groups herdsOf()'s result.
   * @param {Map} live Herdr's agents by terminal address.
   * @param {object} actions The Herds tab's actions (model, expandedAgents, toggleAgents).
   * @param {number} height
   * @returns {object} The map.
   */
  render(t, groups, live, actions, height) {
    const withTab = groups.grazing.filter((session) => live.has(session.terminal));
    const background = groups.grazing.length - withTab.length;
    const { cards, lines, lane } = this.layout(groups.herds, sortedBySpace(withTab, live, actions.model), actions);
    this.cards = cards;
    if (this.refit && this.size) {
      this.refit = false;
      this.fit();
    }
    return div()
      .id("herds-canvas")
      .relative()
      .w_full()
      .h(height)
      .overflow_hidden()
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.canvas)
      .when(this.drag?.kind === "pan", (el) => el.cursor_grabbing())
      .on_size_change((size, cx) => {
        // The size comes unzoomed while the cards are laid out zoomed: at the app's 150% the
        // canvas holds 1/1.5 as much, so Fit measures it in zoomed units.
        const appZoom = Number(settings().zoom) || 1;
        this.size = { width: size.width / appZoom, height: size.height / appZoom };
        this.refit = true;
        cx.notify();
      })
      .on_mouse_down("left", (event, cx) => {
        // A press on a card set its drag first, on the way up from the card; keep that one.
        if (!this.drag) this.drag = { kind: "pan", start: event.position, origin: { ...this.pan }, moved: false };
        cx.notify();
      })
      .on_mouse_move((event, cx) => {
        const drag = this.drag;
        if (!drag) return;
        const dx = event.position.x - drag.start.x;
        const dy = event.position.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
        drag.moved = true;
        if (drag.kind === "pan") this.pan = { x: drag.origin.x + dx, y: drag.origin.y + dy };
        else this.moved[drag.key] = { dx: drag.origin.dx + dx / this.zoom, dy: drag.origin.dy + dy / this.zoom };
        cx.notify();
      })
      .on_mouse_up("left", (_event, cx) => this.endDrag(cx))
      // Letting go outside the canvas never reaches it: leaving it ends the drag instead.
      .on_hover((hovered, cx) => {
        if (!hovered && this.drag) this.endDrag(cx);
      })
      .on_scroll_wheel((event, cx) => {
        // Scrolling pans; with Cmd or Ctrl held it zooms around the pointer. The page under the
        // canvas does not scroll along.
        cx.stop_propagation();
        if (event.modifiers.platform || event.modifiers.control) {
          const step = clamp(event.delta.y, -40, 40);
          this.zoomBy(Math.exp(step * 0.01), cx, event.local_position ?? undefined);
          return;
        }
        this.pan = { x: this.pan.x + event.delta.x, y: this.pan.y + event.delta.y };
        cx.notify();
      })
      .children(this.paintedLines(t, lines))
      .children(this.labels(t, lines))
      .children(lane ? this.laneMarks(t, lane, background) : [])
      .children(cards.map((card) => this.card(t, card, live, actions)))
      .child(
        div()
          .absolute()
          .right(10)
          .bottom(8)
          .px(6)
          .py(2)
          .rounded(5)
          .bg(t.background)
          .text_size(11.5)
          .text_color(t.dim)
          .child("drag to pan · scroll to pan · Cmd-scroll to zoom · drag a card to move it and what's under it"),
      );
  }
}
