// The Herds canvas: the herds as one graph you can pan, zoom and rearrange, like a flow editor.
// Each herd is a tree, its herdsman on top, members and agents below, agents under the sessions
// that started them, and the herds side by side. The lines are painted paths, curved or stepped
// (your pick), each labelled with how the two are linked. Drag the background to pan, drag a card to
// move it and everything under it (they stay where you put them), scroll to pan, and Cmd- or
// Ctrl-scroll to zoom.

import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, settings } from "herdr";
import { agentChildren, agentsByAge } from "./herds-data.js";
import { LinkButton, RoleIcon, StatusMark, agentLine, branchOf, linkLine, linkTo, placeOf, statusOf } from "./herds-view.js";
import { ICONS, IconButton, Segmented, ago, formatTime } from "./ui.js";

/** Card sizes on the canvas at 100%. */
const SESSION = { w: 240, h: 86 };
const AGENT = { w: 180, h: 58 };

/** Room between cards side by side, between a card and the row below it, and between herds. */
const GAP_X = 24;
const GAP_Y = 64;
const HERD_GAP = 80;

/** How far you can zoom out and in. */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

/** Below this zoom a card shows its name and status only: smaller text would not read. */
const COMPACT_BELOW = 0.6;

/** A press that moves less than this is a click (open the tab), not a drag. */
const CLICK_SLOP = 4;

/** The line styles to pick from, each drawn as a small line of its shape. */
export const EDGE_STYLES = [
  { value: "curved", icon: ICONS.lineCurved, tooltip: "Curved lines" },
  { value: "step", icon: ICONS.lineStep, tooltip: "Stepped lines" },
];

/** Where the canvas keeps your choices and the cards you moved, in this mod's own storage. */
const STORE_KEY = "alpmeister.herds.canvas";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Reads what the canvas kept from before: the line style and the moved cards. */
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
 * The Herds canvas and everything it remembers: the line style, the pan and zoom,
 * and the cards you moved (as offsets from where the layout puts them, so a moved card stays put
 * when herds come and go). A card's offset is on top of its parent's, so moving a card moves
 * everything under it, and a card that shows up later under a moved one shows up under it.
 */
export class HerdsCanvas {
  constructor() {
    const kept = remembered();
    this.edges = EDGE_STYLES.some((style) => style.value === kept.edges) ? kept.edges : "curved";
    this.moved = kept.moved && typeof kept.moved === "object" ? kept.moved : {};
    // Offsets kept before they stacked were each a card's own: made relative on the first layout.
    this.flat = !kept.nested && Object.keys(this.moved).length > 0;
    this.pan = { x: 24, y: 24 };
    this.zoom = 1;
    this.size = null;
    // Fit once the canvas knows its size, and again whenever it changes or the layout resets.
    this.refit = true;
    // The canvas filling the whole Alpmeister tab, instead of its part of the Herds tab.
    this.full = false;
    // { kind: "pan" | "card", key?, start, origin, moved } while the mouse is down.
    this.drag = null;
    // The cards as last laid out, for Fit.
    this.cards = [];
  }

  /** Keeps the choices and the moved cards for next time. */
  remember() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ edges: this.edges, moved: this.moved, nested: true }));
    } catch (error) {
      console.log(`alpmeister: canvas not remembered: ${error}`);
    }
  }

  /** Fills the whole tab with the canvas, or puts it back in the Herds tab, then fits. */
  setFull(full, cx) {
    this.full = full;
    this.refit = true;
    cx.notify();
  }

  setEdges(edges, cx) {
    this.edges = edges;
    this.remember();
    cx.notify();
  }

  /** Zooms by `factor` around a point on the canvas (its middle by default). */
  zoomBy(factor, cx, at) {
    const point = at ?? { x: (this.size?.width ?? 800) / 2, y: (this.size?.height ?? 500) / 2 };
    const next = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const wx = (point.x - this.pan.x) / this.zoom;
    const wy = (point.y - this.pan.y) / this.zoom;
    this.zoom = next;
    this.pan = { x: point.x - wx * next, y: point.y - wy * next };
    cx?.notify();
  }

  /** Zooms and pans so every card shows, at 100% at most. */
  fit(cx) {
    if (!this.cards.length || !this.size) return;
    const left = Math.min(...this.cards.map((card) => card.x));
    const top = Math.min(...this.cards.map((card) => card.y));
    const right = Math.max(...this.cards.map((card) => card.x + card.node.size.w));
    const bottom = Math.max(...this.cards.map((card) => card.y + card.node.size.h));
    const pad = 32;
    const zoom = clamp(
      Math.min((this.size.width - pad * 2) / (right - left), (this.size.height - pad * 2) / (bottom - top), 1),
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.zoom = zoom;
    this.pan = {
      x: (this.size.width - (right - left) * zoom) / 2 - left * zoom,
      y: pad - top * zoom,
    };
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

  /**
   * The controls in the Herds card's title row: the line style, zoom out and in, Fit, Reset layout
   * and Full tab.
   */
  controls(t) {
    return [
      Segmented("herds-edges", EDGE_STYLES, this.edges, (edges, cx) => this.setEdges(edges, cx)),
      h_flex()
        .flex_none()
        .items_center()
        .child(IconButton("herds-zoom-out", ICONS.zoomOut, (cx) => this.zoomBy(1 / 1.2, cx), { tooltip: "Zoom out (or Cmd-scroll)" }))
        .child(div().w(34).text_size(10.5).text_color(t.dim).flex().justify_center().child(`${Math.round(this.zoom * 100)}%`))
        .child(IconButton("herds-zoom-in", ICONS.zoomIn, (cx) => this.zoomBy(1.2, cx), { tooltip: "Zoom in (or Cmd-scroll)" })),
      IconButton("herds-fit", ICONS.fit, (cx) => this.fit(cx), { tooltip: "Fit: show every card" }),
      Object.keys(this.moved).length
        ? IconButton("herds-reset", ICONS.resetLayout, (cx) => this.resetLayout(cx), {
            tooltip: "Reset layout: put the cards you moved back in place",
          })
        : null,
      this.full
        ? IconButton("herds-full", ICONS.exitFullTab, (cx) => this.setFull(false, cx), { tooltip: "Exit full tab" })
        : IconButton("herds-full", ICONS.fullTab, (cx) => this.setFull(true, cx), { tooltip: "Full tab: fill the whole tab with the canvas" }),
    ].filter(Boolean);
  }

  /**
   * Lays the herds out side by side, each card moved by as much as you dragged it and its
   * parents: a card's offset carries everything under it along.
   */
  layout(herds, actions) {
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
    return { cards, lines };
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
        const size = Math.max(8, 10 * this.zoom);
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

  /** One card where the layout (and your dragging) put it: press to drag, click to open its tab. */
  card(t, card, live, actions) {
    const { node } = card;
    const z = this.zoom;
    const at = this.toScreen(card.x, card.y);
    const compact = z < COMPACT_BELOW;
    const text = (size) => Math.max(8, size * z);
    const session = node.session;
    const agent = node.agent;
    const status = agent ? agent.status : statusOf(session, live);
    const blocked = status === "blocked";
    const earlier = node.earlier ?? 0;
    const open = actions.expandedAgents?.has(session.id);
    const hasTab = live.has(session.terminal);
    const herdsman = node.role === "herdsman";
    const title = agent ? agent.description : session.name;
    const second = agent ? this.agentWhen(agent) : placeOf(session, live);
    const branch = agent ? null : branchOf(session);
    // A background session runs in no terminal: link it by hand to the tab that shows it.
    const link = agent ? null : LinkButton(session, actions, "hc");
    const tooltip = agent
      ? `${agent.description}\n${agent.fork ? "fork of the session" : `${agent.type} agent`} · ${
          agent.background ? "in the background" : "in the foreground"
        }${agent.model ? ` · model ${agent.model}` : ""}${agent.startedAt ? ` · started ${formatTime(agent.startedAt)}` : ""}`
      : hasTab
        ? "Click to open its tab · drag to move it and what's under it"
        : "Drag to move it and what's under it";
    return v_flex()
      .id(`hc-${node.key}`)
      .absolute()
      .left(at.x)
      .top(at.y)
      .w(node.size.w * z)
      .h(node.size.h * z)
      .px(Math.max(4, 10 * z))
      .py(Math.max(3, 8 * z))
      .gap(Math.max(2, 4 * z))
      .overflow_hidden()
      .rounded(Math.max(4, (agent ? 7 : 8) * z))
      .border_1()
      .border_color(blocked ? t.blocked : herdsman ? t.accent : agent?.status === "working" ? `${t.working}66` : t.border)
      .when(compact, (el) => el.justify_center())
      .bg(t.background)
      .cursor_grab()
      .hover((style) => style.bg(t.hover))
      .tooltip(tooltip)
      .on_mouse_down("left", (event, cx) => {
        this.drag = { kind: "card", key: node.key, start: event.position, origin: this.moved[node.key] ?? { dx: 0, dy: 0 }, moved: false, terminal: hasTab && !actions.model?.demo ? session.terminal : null };
        cx.notify();
      })
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .min_w(0)
          // Needs you is a red dot here, not the Grazing cards' chip: the red border says it too, and the
          // chip would leave a small card no room for its name.
          .child(blocked ? div().size(7).mx(2).flex_none().rounded(4).bg(t.blocked).tooltip("Needs you") : StatusMark(t, status))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(text(agent ? 11.5 : 12))
              .font_medium()
              .text_color(agent?.finished ? t.muted : t.foreground)
              .child(title),
          )
          .when(compact && earlier > 0, (el) => el.child(this.earlierToggle(t, session, earlier, open, actions, text(10), true)))
          .when(!compact, (el) =>
            el.child(RoleIcon(t, `hc-role-${node.key}`, node.role, herdsman ? t.accent : undefined)),
          ),
      )
      .when(!compact && (Boolean(second) || earlier > 0 || Boolean(link)), (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .min_w(0)
            .child(div().flex_1().min_w(0).truncate().text_size(text(agent ? 10 : 10.5)).text_color(t.dim).child(second ?? ""))
            .when(earlier > 0, (row) => row.child(this.earlierToggle(t, session, earlier, open, actions, text(10), false)))
            // The press stays on the button, so it doesn't start dragging the card.
            .when(Boolean(link), (row) =>
              row.child(div().flex_none().on_mouse_down("left", (_event, cx) => cx.stop_propagation()).child(link)),
            ),
        ),
      )
      .when(!compact && Boolean(branch), (el) =>
        el.child(
          h_flex()
            .gap(4)
            .items_center()
            .min_w(0)
            .text_size(text(10.5))
            .text_color(t.muted)
            .child(svg("mods/workspace-chrome/git-branch.svg").size(text(11)).flex_none())
            .child(div().min_w(0).truncate().child(branch)),
        ),
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
  earlierToggle(t, session, count, open, actions, size, short) {
    const label = open ? "hide earlier" : short ? `+${count}` : `+ ${count} earlier`;
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
   * The canvas, `height` tall: the lines, their labels, the cards, then a hint in the corner.
   * @param {object} t The theme.
   * @param {object[]} herds herdsOf()'s herds.
   * @param {Map} live Herdr's agents by terminal address.
   * @param {object} actions The Herds tab's actions (expandedAgents, toggleAgents).
   * @param {number} height
   */
  render(t, herds, live, actions, height) {
    const { cards, lines } = this.layout(herds, actions);
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
          .text_size(10)
          .text_color(t.dim)
          .child("drag to pan · scroll to pan · Cmd-scroll to zoom · drag a card to move it and what's under it"),
      );
  }
}
