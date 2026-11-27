// A lazy file browser for the focused pane's folder. Alp: a file opens in an editor pane
// beside the tab's terminals (editor.js); this panel stays the tree you pick files from.
// Cloned from Herdr's `files` mod; the Alp parts are marked "Alp:".
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, window, run, layout, setShared, props } from "herdr";
import { EditorPane, EDITORS, OPEN_KEY } from "./editor.js";

/**
 * Where the tree shows: the focused terminal's folder. Alp: with a mod pane focused (the
 * editor pane), the folder of the tab's first terminal, so opening a file doesn't move the tree.
 * @returns {{ cwd: string | undefined, on: string | null, space: string | undefined }} the folder and its machine
 */
function location() {
  const space = spaces().find(s => s.active), f = focused();
  let pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  if (pane && !pane.terminal) pane = panes().find(p => p.tab === pane.tab && p.terminal) ?? null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;

/**
 * Alp: the theme's warning colour (orange), for unsaved edits.
 * A theme may not carry `warning`, so fall back to Alp's.
 * @param {any} t the theme
 * @returns {string} the warning colour
 */
const warning = t => t.warning ?? "#ffb86c";

/**
 * Alp: finds a layout node by id.
 * @param {any} node where to start
 * @param {string} id the node's id
 * @returns {any | null} the node
 */
const findNode = (node, id) => !node ? null : node.id === id ? node : (node.children ?? []).reduce((hit, c) => hit ?? findNode(c, id), null);

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}
export default class Files extends View {
  /**
   * Alp: a copy whose props name a `file` is an editor pane (editor.js); without, it's the tree.
   * @param {any} _props unused: `props()` has them
   * @param {any} cx the view's context
   * @returns {void}
   */
  init(_props, cx) {
    const given = props();
    if (given?.file) { this.pane = new EditorPane(given, cx); return; }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  /**
   * Alp: opens a file in the shown tab's editor pane: the one already there switches to it,
   * else a new pane splits off right of the focused pane (the tab's first, if focus is elsewhere).
   * When Alp is shown in place of the terminals, the terminals come back first.
   * @param {string} path the file, relative to the root
   * @returns {void}
   */
  openFile(path) {
    const f = focused(), tab = f?.tab;
    if (!tab || !this.root) return;
    const file = `${this.root}/${path}`, on = this.on ?? null, root = this.root;
    const stack = findNode(layout(), "work-stack");
    if (stack?.active && stack.active !== "work-body") run("layout.select", { stack: "work-stack", child: "work-body" });
    const mine = panes().filter(p => p.tab === tab), editor = mine.find(p => p.mod === "alp-files");
    if (editor) {
      setShared(OPEN_KEY, { tab, file, on, root, n: Date.now() });
      run("pane.focus", { pane: editor.pane });
      return;
    }
    const pane = mine.find(p => p.pane === f.pane)?.pane ?? mine.find(p => p.terminal)?.pane ?? mine[0]?.pane;
    run("pane.split", { direction: "right", ...(pane ? { pane } : {}), mod: "alp-files", props: { file, on, root, tab } });
  }

  /**
   * Alp: what the shown tab's editor pane has open, every pane's unsaved files, and those of
   * them auto save will save (marked quietly).
   * @returns {{ current: string | null, unsaved: Set<string>, quiet: Set<string> }} absolute paths
   */
  editing() {
    const tab = focused()?.tab, unsaved = new Set(), quiet = new Set();
    let current = null;
    for (const e of EDITORS.values()) {
      for (const abs of e.unsaved) unsaved.add(abs);
      for (const abs of e.quiet ?? []) quiet.add(abs);
      if (e.tab === tab) current = e.current;
    }
    return { current, unsaved, quiet };
  }

  /**
   * Alp: the pane is closing; an editor pane lets go of its documents.
   * @returns {Promise<void>}
   */
  async close() {
    this.pane?.dispose();
  }

  /**
   * The tree's rows under a folder, open folders expanded. A file's mark: an orange ● for
   * unsaved edits in an editor pane (dim while auto save will save them), else its git status
   * letter. The file the tab's editor shows is highlighted.
   * @param {string} prefix the folder, relative to the root ("" for the root)
   * @param {number} depth how deep the folder is, for the indent
   * @param {any[]} out rows so far; this appends to them
   * @param {any} t the theme
   * @param {{ current: string | null, unsaved: Set<string>, quiet: Set<string> }} editing what the editor panes have open
   * @returns {any[]} `out`
   */
  rows(prefix, depth, out, t, editing) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), abs = `${this.root}/${path}`;
      const mark = !this.on && editing.unsaved.has(abs) ? "●" : this.marks[abs];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .when(!entry.dir && editing.current === abs, el => el.bg(t.selected ?? t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.openFile(path))
        .child(entry.dir ? svg(`mods/alp-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/alp-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11.5).text_color(mark === "●" ? (editing.quiet.has(abs) ? t.dim : warning(t)) : mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t, editing);
    }
    return out;
  }

  /**
   * The Files panel: a header with the folder's name, then the tree. Alp: an editor pane
   * copy draws the editor instead (editor.js).
   * @param {any} cx the view's context
   * @returns {any} the panel
   */
  render(cx) {
    if (this.pane) return this.pane.render(cx);
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), editing = this.editing();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t, editing))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11.5).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
