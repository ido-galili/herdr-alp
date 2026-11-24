import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, layout, terminals } from "herdr";

// Alp's status bar: Herdr's `workspace-status` (0.1.16) with a Runs button after the commands
// hint, at the right end. It shows or hides the `bottom-panel` (the runs' output and their sessions), and counts
// the runs still running.

const PANEL_ID = "bottom-panel";
const RUNS_ICON = "mods/alp-runs/terminal.svg";

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

export default class AlpStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  /**
   * The Runs button: shows or hides the bottom panel. Lit while it shows; the count of runs still
   * running follows the icon.
   * @param {object} t The theme.
   * @param {object} panel The layout's `bottom-panel` node.
   * @returns {object}
   */
  runsButton(t, panel) {
    const open = !panel.hidden;
    const running = terminals().filter((terminal) => terminal.state === "live" && terminal.labels?.["alp.run"] && !terminal.labels["alp.run.exit"]).length;
    return h_flex().id("runs-toggle").h(20).px(6).gap(5).items_center().rounded(5).cursor_pointer()
      .bg(open ? t.selected : t.chrome).text_color(open ? t.foreground : t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`${open ? "Hide" : "Show"} runs${running ? ` · ${running} running` : ""}`)
      .on_click(() => run("layout.toggle", { id: PANEL_ID }))
      .child(svg(RUNS_ICON).size(13).flex_none())
      .when(running > 0, (el) => el.child(div().text_color(t.working).child(String(running))));
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const panel = find(layout(), PANEL_ID);
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)))
      .when(Boolean(panel), (el) => el.child(this.runsButton(t, panel)));
  }
}
