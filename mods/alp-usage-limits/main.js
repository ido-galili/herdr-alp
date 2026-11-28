// An agent's usage limits: Session (5h) and Weekly (7d), each with a usage bar, its
// percentage and the time left; the tooltip has the full text, with how much time is gone.
// Data: the agent's entry in ~/.local/state/herdr-agents/limits.json
// ({ "<agent>": { five_hour, seven_day, ts } }), written for Claude Code by the
// alp plugin. Props: { agent } (default "claude").
//
// Folded, the rail cell is shorter than the two rows, and a block's height is fixed
// by the layout: the mod resizes its own block so the space under the content stays
// what it is unfolded. Props: { block } the layout node id (default "limits"),
// { height } unfolded px (default 96), { foldedHeight } folded px (default 82).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, home, readTextFile, layout, run } from "herdr";

const WINDOWS = [
  { key: "five_hour", label: "Session", short: "5h", span: 5 * 3600 },
  { key: "seven_day", label: "Weekly", short: "7d", span: 7 * 86400 },
];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same rule as spaces/agents: the sidebar is a rail when it is under 160px wide.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const toSec = (v) => (v == null ? null : typeof v === "number" ? (v > 1e12 ? v / 1000 : v) : Date.parse(v) / 1000);
const pct = (w) => {
  const v = w?.used_percentage ?? w?.percentUsed ?? w?.utilization;
  return v == null ? null : Math.max(0, Math.min(100, v));
};

/**
 * The theme's warning colour (orange): a theme may not carry `warning`, so fall back to Alp's.
 * @param {Record<string, string>} t The theme.
 * @returns {string} The warning colour.
 */
const warning = (t) => t.warning ?? "#ffb86c";

function left(sec) {
  if (sec <= 0) return "now";
  const d = Math.floor(sec / 86400),
    h = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default class UsageLimits extends View {
  init(props, cx) {
    this.agent = props?.agent ?? "claude";
    this.block = props?.block ?? "limits";
    this.height = props?.height ?? 96;
    this.foldedHeight = props?.foldedHeight ?? 82;
    this.folded = undefined; // the fold state the block was last sized for
    this.data = null;
    this.load(cx);
    cx.timer.every(5000, (cx) => this.load(cx));
    cx.timer.every(30000, (cx) => cx.notify());
  }

  load(cx) {
    readTextFile(`${home()}/.local/state/herdr-agents/limits.json`).then((txt) => {
      let next = null;
      try {
        next = txt ? (JSON.parse(txt)?.[this.agent] ?? null) : null;
      } catch {
        next = null;
      }
      if (JSON.stringify(next) !== JSON.stringify(this.data)) {
        this.data = next;
        cx.notify();
      }
    });
  }

  /**
   * The usage fill on its track.
   * @param {Record<string, string>} t The theme.
   * @param {number} frac How much is used, 0 to 1.
   * @param {string} color The fill's colour.
   * @returns {object}
   */
  bar(t, frac, color) {
    const c = Math.max(0, Math.min(1, frac)) * 100;
    return div()
      .w_full()
      .h(8)
      .rounded(4)
      .bg(t.border)
      .overflow_hidden()
      .child(div().h(8).w(`${c}%`).rounded(4).bg(color));
  }

  /**
   * A window's full text, for its tooltip: "Weekly: 74% used, 55% of the time gone · resets in 3d 4h".
   * @param {{ label: string }} win The limit window.
   * @param {{ used: number | null, remain: number | null, elapsed: number }} st Its numbers, from stats().
   * @returns {string} The text.
   */
  tip(win, { used, remain, elapsed }) {
    if (used == null) return `${win.label}: no data yet`;
    if (remain == null) return `${win.label}: ${Math.round(used)}% used`;
    return `${win.label}: ${Math.round(used)}% used, ${Math.round(elapsed * 100)}% of the time gone · ${remain <= 0 ? "resets now" : `resets in ${left(remain)}`}`;
  }

  /**
   * A window's usage, time left and colour: accent, orange from 70% used, red from 90%.
   * @param {Record<string, string>} t The theme.
   * @param {{ key: string, span: number }} win The limit window.
   * @returns {{ used: number | null, remain: number | null, elapsed: number, color: string }} Its numbers and colour.
   */
  stats(t, win) {
    const w = this.data?.[win.key];
    const used = pct(w);
    const reset = toSec(w?.resets_at ?? w?.resetsAt);
    const remain = reset == null ? null : reset - Date.now() / 1000;
    const elapsed = remain == null ? 0 : 1 - Math.max(0, Math.min(win.span, remain)) / win.span;
    const color = used == null ? t.dim : used >= 90 ? t.blocked : used >= 70 ? warning(t) : t.accent;
    return { used, remain, elapsed, color };
  }

  /**
   * Rail: only the session window, in a 32px cell (gauge, %, bar, clock + time to reset);
   * the full text is in the tooltip. The time stays at 9.5px: 11.5 doesn't fit the cell.
   * @param {Record<string, string>} t The theme.
   * @param {{ key: string, label: string, span: number }} win The limit window.
   * @returns {object}
   */
  cell(t, win) {
    const st = this.stats(t, win);
    const { used, remain, color } = st;
    const usedText = used == null ? "–" : `${Math.round(used)}%`;
    const tip = this.tip(win, st);
    const short =
      remain == null
        ? null
        : remain <= 0
          ? "now"
          : remain >= 3600
            ? `${Math.floor(remain / 3600)}h`
            : `${Math.floor(remain / 60)}m`;
    return h_flex()
      .flex_none()
      .justify_center()
      .child(
        v_flex()
          .id(`limit-${win.key}`)
          .w(32)
          .py(4)
          .gap(3)
          .items_center()
          .rounded(6)
          .hover((s) => s.bg(t.hover))
          .tooltip(tip)
          .child(svg("mods/alp-usage-limits/gauge.svg").size(14).flex_none().text_color(color))
          .child(div().text_size(11.5).font_semibold().text_color(color).child(usedText))
          .child(
            div()
              .w(24)
              .h(3)
              .rounded(2)
              .bg(t.border)
              .overflow_hidden()
              .child(
                div()
                  .h(3)
                  .w(`${used ?? 0}%`)
                  .rounded(2)
                  .bg(color),
              ),
          )
          .when(short != null, (el) =>
            el.child(
              h_flex()
                .gap(2)
                .items_center()
                .text_size(9.5)
                .text_color(t.dim)
                .child(svg("mods/workspace-chrome/clock.svg").size(9).flex_none().text_color(t.dim))
                .child(short),
            ),
          ),
      );
  }

  /**
   * Unfolded: the label, one percentage and the time left over the usage bar; the full text is in the tooltip.
   * @param {Record<string, string>} t The theme.
   * @param {{ key: string, label: string, span: number }} win The limit window.
   * @returns {object}
   */
  row(t, win) {
    const st = this.stats(t, win);
    const { used, remain, color } = st;
    return v_flex()
      .id(`limit-row-${win.key}`)
      .gap(4)
      .tooltip(this.tip(win, st))
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .text_size(11.5)
          .child(div().text_color(t.foreground).font_medium().child(win.label))
          .child(
            div()
              .text_color(color)
              .font_semibold()
              .child(used == null ? "–" : `${Math.round(used)}%`),
          )
          .child(div().flex_1())
          .child(
            div()
              .text_color(t.dim)
              .child(remain == null ? "" : remain <= 0 ? "resets now" : `${left(remain)} left`),
          ),
      )
      .child(this.bar(t, (used ?? 0) / 100, color));
  }

  render() {
    const t = theme();
    const folded = narrow();
    // Render re-runs when the layout changes (folding the sidebar); resize only on a change.
    if (folded !== this.folded) {
      this.folded = folded;
      run("layout.resize", { id: this.block, px: folded ? this.foldedHeight : this.height });
    }
    const body = folded
      ? v_flex().w_full().pt(10).child(this.cell(t, WINDOWS[0]))
      : v_flex()
          .w_full()
          .px(14)
          .pt(10)
          .gap(10)
          .children(WINDOWS.map((w) => this.row(t, w)));
    return v_flex().size_full().bg(t.chrome).child(body).child(div().flex_1()).child(div().w_full().h(1).bg(t.border));
  }
}
