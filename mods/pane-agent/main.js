// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane-agent" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// For agents that report to ~/.local/state/herdr-agents/<terminal>.json (see the
// alp Claude Code plugin) it adds model, effort and context chips.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, readTextFile, exec } from "herdr";

// Agents (program keys) that write status files. Add one here once it reports.
const REPORTING = new Set(["claude"]);

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// "claude-sonnet-5-5" -> "Sonnet 5.5"; names that don't match pass through.
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[.*\])?$/.exec(id ?? "");
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

/**
 * The theme's warning colour (orange): a theme may not carry `warning`, so fall back to Alp's.
 * @param {Record<string, string>} t The theme.
 * @returns {string} The warning colour.
 */
const warning = (t) => t.warning ?? "#ffb86c";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.info = null;
    this.wt = null;          // worktree name, or null in a main checkout / outside git
    this.wtCwd = undefined;  // the folder this.wt was worked out for
    // A linked worktree's git dir is <repo>/.git/worktrees/<name>, while its
    // common dir is the main <repo>/.git; in the main checkout the two are equal.
    const checkWorktree = () => {
      const cwd = this.me()?.cwd ?? null;
      if (cwd === this.wtCwd) return;
      this.wtCwd = cwd;
      if (!cwd) { if (this.wt) { this.wt = null; cx.notify(); } return; }
      exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd, timeout: 3000 }).then((r) => {
        if (this.wtCwd !== cwd) return; // the folder changed again meanwhile
        const [gitDir, commonDir] = r.code === 0 ? r.stdout.trim().split("\n") : [];
        const next = gitDir && commonDir && gitDir !== commonDir ? gitDir.split("/").pop() : null;
        if (next !== this.wt) { this.wt = next; cx.notify(); }
      }).catch(() => {});
    };
    const load = () => {
      checkWorktree();
      const term = this.me()?.terminal;
      if (!term) return;
      readTextFile(`${home()}/.local/state/herdr-agents/${term}.json`).then((txt) => {
        let next = null;
        try { next = txt ? JSON.parse(txt) : null; } catch { next = null; }
        const pick = (i) => JSON.stringify([i?.agent, i?.model, i?.effort, i?.context_pct]);
        if (pick(next) !== pick(this.info)) { this.info = next; cx.notify(); }
      });
    };
    load();
    cx.timer.every(3000, load);
  }

  /**
   * A small rounded label in the header.
   * @param {Record<string, string>} t The theme.
   * @param {string} text The label.
   * @param {string} color Its text colour.
   * @returns {object} The chip element.
   */
  chip(t, text, color) {
    return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.hover).text_size(11.5).text_color(color).child(text);
  }

  /**
   * Context window usage: a small bar plus percentage, orange from 70% and red from 90%.
   * @param {Record<string, string>} t The theme.
   * @param {number} used Percent of the context window used.
   * @returns {object} The usage chip.
   */
  ctx(t, used) {
    const v = Math.max(0, Math.min(100, used));
    const color = v >= 90 ? t.blocked : v >= 70 ? warning(t) : t.accent;
    return h_flex().flex_none().items_center().gap(6).h(18).px(6).rounded(5).bg(t.hover)
      .child(div().w(44).h(5).rounded(3).bg(t.border).overflow_hidden().child(div().h(5).w(`${v}%`).rounded(3).bg(color)))
      .child(div().text_size(11.5).text_color(color).child(`${Math.round(v)}%`));
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane-agent/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    // Alp: the Files editor pane draws its own top line (file, folder, Unsaved, Save, ✕).
    if (p.mod === "alp-files") return div().size_full().bg(t.background);
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const key = p.program?.key;
    const reporting = REPORTING.has(key);
    // the status file belongs to whatever ran in this terminal last: only trust it for the same agent
    const info = reporting && this.info?.agent === key ? this.info : null;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(info?.model), el => el.child(this.chip(t, modelName(info.model), t.foreground)))
      .when(Boolean(info?.effort), el => el.child(this.chip(t, String(info.effort).replace(/^./, c => c.toUpperCase()), t.accent)))
      .when(info?.context_pct != null, el => el.child(this.ctx(t, info.context_pct)))
      .when(Boolean(this.wt), el => el.child(
        h_flex().flex_none().gap(4).px(6).h(18).items_center().rounded(5).bg(t.hover).text_size(11.5).text_color(t.muted)
          .child(svg("mods/pane-agent/worktree.svg").size(11).flex_none().text_color(t.muted))
          .child(this.wt)))
      .when(reporting && Boolean(p.branch), el => el.child(this.chip(t, "\u2387 " + p.branch, t.muted)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(11.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(true, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
