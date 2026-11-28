// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "alp-pane-agent" } } } }
// Shows the program's icon (the app's program table; its name is the icon's tooltip, the tab
// bar names the tab), its status, then one muted line: "folder · [branch icon] branch", or in a
// linked worktree "[worktree icon] <worktree> · [branch icon] branch" (the worktree first,
// never cut off).
// Split, zoom and close show while the header is hovered or the pane is focused.
// Props from the app: { pane, terminal }. Click: focus the pane.
// For agents that report to ~/.local/state/herdr-agents/<terminal>.json (see the
// alp Claude Code plugin) it adds a model chip ("Opus 5.5 · high") and the context bar.
// An Alp page opened as a tab of its own (tab.new {mod: "alp"}) gets no header:
// the strip is drawn in the page's colour, so it looks like the pinned Alp view.

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

/**
 * A folder as the user reads it: "~" for home, "~/…" under it, else the full path.
 * @param {string | null} cwd The folder.
 * @returns {string} The folder, shortened.
 */
function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

/**
 * The folder's own name ("website" for ~/projects/website), "~" for home.
 * @param {string | null} cwd The folder.
 * @returns {string} Its last part.
 */
function folderName(cwd) {
  const f = folder(cwd);
  return f === "~" || f === "/" ? f : f.replace(/\/+$/, "").split("/").pop();
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.info = null;
    this.wt = null; // worktree name, or null in a main checkout / outside git
    this.wtRepo = null; // the main checkout a linked worktree belongs to
    this.wtCwd = undefined; // the folder this.wt was worked out for
    // A linked worktree's git dir is <repo>/.git/worktrees/<name>, while its
    // common dir is the main <repo>/.git; in the main checkout the two are equal.
    const checkWorktree = () => {
      const cwd = this.me()?.cwd ?? null;
      if (cwd === this.wtCwd) return;
      this.wtCwd = cwd;
      if (!cwd) {
        if (this.wt) {
          this.wt = this.wtRepo = null;
          cx.notify();
        }
        return;
      }
      exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd, timeout: 3000 })
        .then((r) => {
          if (this.wtCwd !== cwd) return; // the folder changed again meanwhile
          const [gitDir, commonDir] = r.code === 0 ? r.stdout.trim().split("\n") : [];
          const next = gitDir && commonDir && gitDir !== commonDir ? gitDir.split("/").pop() : null;
          // <repo>/.git -> <repo>; a bare repo's common dir is the repo itself
          const repo = next ? commonDir.replace(/\/\.git\/?$/, "") : null;
          if (next !== this.wt || repo !== this.wtRepo) {
            this.wt = next;
            this.wtRepo = repo;
            cx.notify();
          }
        })
        .catch(() => {});
    };
    const load = () => {
      checkWorktree();
      const term = this.me()?.terminal;
      if (!term) return;
      readTextFile(`${home()}/.local/state/herdr-agents/${term}.json`).then((txt) => {
        let next = null;
        try {
          next = txt ? JSON.parse(txt) : null;
        } catch {
          next = null;
        }
        const pick = (i) => JSON.stringify([i?.agent, i?.model, i?.effort, i?.context_pct]);
        if (pick(next) !== pick(this.info)) {
          this.info = next;
          cx.notify();
        }
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
    return div()
      .flex_none()
      .px(6)
      .h(18)
      .flex()
      .items_center()
      .rounded(5)
      .bg(t.hover)
      .text_size(11.5)
      .text_color(color)
      .child(text);
  }

  /**
   * Context window usage: the word "context", a small bar and the percentage; orange from 70%
   * and red from 90%.
   * @param {Record<string, string>} t The theme.
   * @param {number} used Percent of the context window used.
   * @returns {object} The usage chip.
   */
  ctx(t, used) {
    const v = Math.max(0, Math.min(100, used));
    const color = v >= 90 ? t.blocked : v >= 70 ? warning(t) : t.accent;
    return h_flex()
      .flex_none()
      .items_center()
      .gap(6)
      .h(18)
      .px(6)
      .rounded(5)
      .bg(t.hover)
      .child(div().text_size(11.5).text_color(t.muted).child("context"))
      .child(
        div()
          .w(44)
          .h(5)
          .rounded(3)
          .bg(t.border)
          .overflow_hidden()
          .child(div().h(5).w(`${v}%`).rounded(3).bg(color)),
      )
      .child(
        div()
          .text_size(11.5)
          .text_color(color)
          .child(`${Math.round(v)}%`),
      );
  }

  /**
   * This header's pane.
   * @returns {object | undefined} Its PaneInfo, or undefined while it's gone.
   */
  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  /**
   * Whether this pane is an Alp page that is its tab's only pane (a tab.new copy: a demo, an
   * Overview). Those show no header (Q8), like the pinned Alp view.
   * @param {object} p The pane.
   * @returns {boolean} True for a lone Alp page.
   */
  alpPage(p) {
    return !p.terminal && p.mod === "alp" && !panes().some((o) => o.tab === p.tab && o.pane !== p.pane);
  }

  /**
   * The agent's status, right after the name: "Needs you", a spinner with "working", or a check.
   * @param {Record<string, string>} t The theme.
   * @param {string | null} st The status.
   * @returns {object | null} The status element, or null when idle or unknown.
   */
  status(t, st) {
    if (st === "blocked")
      return div()
        .flex_none()
        .px(6)
        .h(18)
        .flex()
        .items_center()
        .rounded(5)
        .bg(t.blocked + "26")
        .text_size(11.5)
        .font_semibold()
        .text_color(t.blocked)
        .child("Needs you");
    if (st === "working")
      return h_flex()
        .flex_none()
        .gap(5)
        .items_center()
        .text_size(11.5)
        .text_color(t.working)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child("working");
    if (st === "done") return svg("mods/workspace-chrome/check.svg").size(13).flex_none().text_color(t.done);
    return null;
  }

  /**
   * One header button that runs a pane command.
   * @param {Record<string, string>} t The theme.
   * @param {string} id The element id.
   * @param {string} icon The svg's name in this mod's folder.
   * @param {string} command The pane command.
   * @param {object} args Its arguments.
   * @returns {object} The button.
   */
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
      .child(svg(`mods/alp-pane-agent/${icon}.svg`).size(14));
  }

  /**
   * The muted line: "folder · [branch icon] branch", or in a linked worktree the worktree first,
   * with its icon: "[worktree icon] herdr-alp-p6 · [branch icon] feat/pane-header". The folder
   * shows after the worktree only when it isn't the worktree's own (the shell is in a subfolder).
   * Outside git it's just the folder. The rest after the worktree has no width of its own (flex
   * basis 0), so a narrow pane cuts all of it before the worktree's name starts to truncate.
   * Hover: the full path, and the worktree's repo.
   * @param {Record<string, string>} t The theme.
   * @param {object} p The pane.
   * @returns {object} The line.
   */
  where(t, p) {
    const dir = folderName(p.cwd);
    const shown = this.wt && dir === this.wt ? null : dir;
    // the dots go with the rest, so none dangles after the worktree or before the branch
    const lead = [this.wt ? "" : null, shown, p.branch ? "" : null]
      .filter((x) => x != null)
      .join(" \u00b7 ")
      .trim();
    const tip = [folder(p.cwd), this.wt && this.wtRepo && `Linked worktree of ${folder(this.wtRepo)}`]
      .filter(Boolean)
      .join("\n");
    return (
      h_flex()
        .id(`ph-where-${p.pane}`)
        .flex_1()
        .min_w(0)
        .overflow_hidden()
        .items_center()
        .gap(4)
        .text_color(t.dim)
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .when(Boolean(this.wt), (el) =>
          el
            .child(svg("mods/alp-pane-agent/worktree.svg").size(13).flex_none().text_color(t.dim))
            .child(div().min_w(0).truncate().child(this.wt)),
        )
        // the branch name gives way before the folder and the dots (they barely shrink)
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .overflow_hidden()
            .items_center()
            .gap(4)
            // a lone dot never shrinks, so a cut-off branch still reads "worktree · ⑂"
            .when(Boolean(lead), (el) =>
              el.child(shown ? div().min_w(0).flex_shrink(0.01).truncate().child(lead) : div().flex_none().child(lead)),
            )
            .when(Boolean(p.branch), (el) =>
              el
                // the footer's branch icon (alp-status), muted like the text
                .child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim))
                .child(div().min_w(0).truncate().child(p.branch)),
            ),
        )
    );
  }

  /**
   * The header: icon (its tooltip names the program), status, the muted worktree · folder · branch
   * line, the model chip, the context bar, and (hovered or focused) split, zoom and close.
   * @param {object} cx The view context.
   * @returns {object} The header row.
   */
  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    // Alp: the Files editor pane draws its own top line (file, folder, Unsaved, Save, ✕).
    if (p.mod === "alp-files") return div().size_full().bg(t.background);
    if (this.alpPage(p)) return div().size_full().bg(t.canvas);
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const state = this.status(t, p.status);
    const pane = p.pane;
    const key = p.program?.key;
    const reporting = REPORTING.has(key);
    // the status file belongs to whatever ran in this terminal last: only trust it for the same agent
    const info = reporting && this.info?.agent === key ? this.info : null;
    const model = [info?.model && modelName(info.model), info?.effort && String(info.effort).toLowerCase()]
      .filter(Boolean)
      .join(" \u00b7 ");
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .overflow_hidden()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      .child(
        pic
          ? div().id(`ph-icon-${pane}`).flex_none().flex().items_center().tooltip(name).child(pic)
          : // no icon in the program table: the name stands in, so the header never starts blank
            div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name),
      )
      .when(Boolean(state), (el) => el.child(state))
      .child(this.where(t, p))
      .when(Boolean(model), (el) => el.child(this.chip(t, model, t.foreground)))
      .when(info?.context_pct != null, (el) => el.child(this.ctx(t, info.context_pct)))
      .when(this.hovered || p.focused, (el) =>
        el.child(
          h_flex()
            .flex_none()
            .items_center()
            .gap(2)
            .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
            .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
            .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
            .child(div().w(1).h(14).mx(2).bg(t.border))
            .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })),
        ),
      );
  }
}
