// A lazy file browser for the focused pane's folder, with a minimal editor:
// local files are editable (ctrl-s saves), remote and oversized ones stay read-only.
// Cloned from Herdr's `files` mod; the editing parts are marked "Alp:".
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
// The editor highlights with syntect's default grammars, found by extension. Alp: these
// map extensions it lacks to the closest one it has (no TypeScript, TOML, Vue or Dockerfile).
const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  toml: "yaml", yml: "yaml", jsonc: "json", json5: "json", webmanifest: "json",
  svelte: "html", vue: "html", astro: "html", htm: "html", svg: "xml", plist: "xml",
  zsh: "sh", bash: "sh", fish: "sh", ksh: "sh", env: "sh", mdx: "md", markdown: "md",
  scss: "css", less: "css", pyi: "py", mk: "makefile", h: "c", hpp: "cpp", cc: "cpp", kts: "java", kt: "java",
};
// Alp: files known by their whole name, mostly without an extension.
const NAMES = {
  makefile: "makefile", gnumakefile: "makefile", dockerfile: "sh", containerfile: "sh", justfile: "makefile",
  ".bashrc": "sh", ".bash_profile": "sh", ".profile": "sh", ".zshrc": "sh", ".zprofile": "sh", ".env": "sh", ".envrc": "sh",
  ".gitignore": "sh", ".gitattributes": "sh", ".dockerignore": "sh", ".npmrc": "sh", ".editorconfig": "sh",
  gemfile: "rb", rakefile: "rb", ".prettierrc": "json", ".eslintrc": "json",
};

/**
 * Alp: the grammar to highlight a file with, from its name or else its extension.
 * Names are matched case-insensitively, so `Dockerfile.dev` and `.env.local` count too.
 * @param {string} path the file's path, relative or absolute
 * @returns {string} a syntect token (extension or grammar name); "txt" means plain text
 */
function language(path) {
  const name = path.split(/[\\/]/).pop().toLowerCase();
  const known = NAMES[name] ?? NAMES[name.split(".").slice(0, name.startsWith(".") ? 2 : 1).join(".")];
  if (known) return known;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "txt";
  const ext = name.slice(dot + 1);
  return LANG[ext] ?? ext;
}

/**
 * Alp: syntax colors from the theme's ANSI colors, laid out as Dracula does it (Alp's theme):
 * pink keywords, yellow strings, green functions, cyan types, purple numbers and constants.
 * Other themes get the same roles in their own colors.
 * @param {any} t the theme
 * @returns {Record<string, string>} the editor's `syntax` option
 */
const syntaxColors = t => ({
  keyword: t.ansi5, operator: t.ansi5, "string.escape": t.ansi5,
  string: t.ansi3, function: t.ansi2, type: t.ansi6,
  number: t.ansi4, constant: t.ansi4, boolean: t.ansi4,
  comment: t.dim, variable: t.foreground, punctuation: t.foreground,
});
const PER_FOLDER = 500, TOTAL = 5000;
// Alp: files longer than this are shown cut off, so they can't be saved.
const SHOW_LIMIT = 400000;

/**
 * The text the editor shows for a file: the whole of it, or its start when it's too long.
 * @param {string} text the file's contents
 * @returns {string} the text to put in the editor
 */
const shown = text => text.length > SHOW_LIMIT ? text.slice(0, SHOW_LIMIT) + "\n… (file truncated)" : text;

/**
 * Alp: the theme's warning colour (orange), for unsaved edits and a file changed on disk.
 * A theme may not carry `warning`, so fall back to Alp's.
 * @param {any} t the theme
 * @returns {string} the warning colour
 */
const warning = t => t.warning ?? "#ffb86c";

/**
 * Alp: a small text button for the panel footer.
 * @param {string} id element id
 * @param {string} label button text
 * @param {string} color text color
 * @param {(cx: any) => void} onClick runs on click
 * @returns {any} the button element
 */
const footerButton = (id, label, color, onClick) =>
  div().id(id).px(7).py(2).flex_none().rounded(6).cursor_pointer().text_size(12).text_color(color)
    .hover(s => s.bg(theme().hover)).on_click((_e, cx) => onClick(cx)).child(label);

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
  init(_props, cx) {
    this.saved = new Map();
    // Alp: unsaved documents not on screen, by absolute path, so leaving a file keeps its edits.
    this.buffers = new Map();
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
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
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
        await this.checkDisk();
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
   * Opens a file in the editor, or goes back to the tree. The document on screen is
   * kept in `buffers` when it has unsaved edits, and reopening its file brings them back.
   * @param {string | null} path the file, relative to the root; null shows the tree
   * @param {any} [cx] the context to load in; without it only the current file closes
   * @returns {void}
   */
  show(path, cx) {
    const doc = this.doc;
    if (doc?.dirty) this.buffers.set(doc.abs, doc); else doc?.code.release();
    this.doc = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on, abs = `${root}/${path}`;
    const kept = on ? null : this.buffers.get(abs);
    if (kept) { this.buffers.delete(abs); this.doc = kept; return; }
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(abs, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        // writeTextFile only reaches this machine, and a cut-off file would lose its end on save.
        const locked = on ? "Read-only · on another machine" : text.length > SHOW_LIMIT ? "Read-only · too long to edit" : null;
        const code = EditorState.new({ language: language(path), readonly: Boolean(locked), value: shown(text), syntax: syntaxColors(theme()) });
        const next = { abs, code, base: text, locked, dirty: false, saving: false, disk: undefined, error: null };
        code.on("change", (_e, cx) => {
          const dirty = !next.locked && code.value() !== next.base;
          if (dirty !== next.dirty) { next.dirty = dirty; cx.notify(); }
        });
        this.doc = next;
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  /**
   * Alp: compares the open document with the file on disk. A clean document follows
   * the disk (an agent's edit shows up); an edited one is flagged as changed on disk.
   * @returns {Promise<void>}
   */
  async checkDisk() {
    const doc = this.doc;
    if (!doc || doc.saving) return;
    const disk = await readTextFile(doc.abs, { on: this.on }).catch(() => undefined);
    if (this.doc !== doc || doc.saving || disk === undefined || (disk !== null && disk.includes("\0"))) return;
    if (disk === doc.base) { doc.disk = undefined; return; }
    if (doc.dirty || disk === null) { doc.disk = disk; return; }
    doc.base = disk; doc.disk = undefined; doc.error = null;
    doc.code.set_value(shown(disk));
  }

  /**
   * Alp: writes the open document. Without `force` the write is refused when the file
   * changed on disk since it was read, so another program's edit is never overwritten silently.
   * @param {any} cx the context to re-render in
   * @param {boolean} [force] overwrite whatever is on disk now
   * @returns {void}
   */
  save(cx, force = false) {
    const doc = this.doc;
    if (!doc || doc.locked || doc.saving || (!doc.dirty && !force)) return;
    const text = doc.code.value();
    doc.saving = true; doc.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const expected = force ? await readTextFile(doc.abs) : doc.base;
        await writeTextFile(doc.abs, text, expected);
        doc.base = text; doc.disk = undefined;
        doc.dirty = doc.code.value() !== text;
      } catch (e) {
        const disk = await readTextFile(doc.abs).catch(() => undefined);
        if (disk !== undefined && disk !== doc.base) doc.disk = disk;
        else doc.error = `Not saved: ${e?.message ?? e}`;
      } finally { doc.saving = false; cx.notify(); }
    });
  }

  /**
   * Alp: drops the open document's edits and shows the file as it is on disk.
   * @returns {void}
   */
  reload() {
    const doc = this.doc;
    if (!doc || typeof doc.disk !== "string") return;
    doc.base = doc.disk; doc.disk = undefined; doc.error = null;
    doc.code.set_value(shown(doc.base));
    doc.dirty = false;
  }

  /**
   * The tree's rows under a folder, open folders expanded. A file's mark: an orange ● for
   * unsaved edits, else its git status letter.
   * @param {string} prefix the folder, relative to the root ("" for the root)
   * @param {number} depth how deep the folder is, for the indent
   * @param {any[]} out rows so far; this appends to them
   * @param {any} t the theme
   * @returns {any[]} `out`
   */
  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), abs = `${this.root}/${path}`;
      const mark = !this.on && this.buffers.has(abs) ? "●" : this.marks[abs];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/alp-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/alp-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11.5).text_color(mark === "●" ? warning(t) : mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  /**
   * Alp: the footer under an open file, always the same height so the editor never moves.
   * It says what the document needs: saving, a choice after the file changed on disk,
   * an error, or why it's read-only; otherwise a dimmed Save.
   * @param {any} t the theme
   * @returns {any} the footer
   */
  footer(t) {
    const doc = this.doc;
    const line = (text, color, ...buttons) => h_flex().h(32).flex_none().px(14).gap(6).items_center().border_t(1).border_color(t.border).text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(color).child(text)).children(buttons);
    if (!doc) return line("", t.dim);
    if (doc.saving) return line("Saving…", t.muted);
    if (doc.disk !== undefined) return line(doc.disk === null ? "Deleted on disk" : "Changed on disk", warning(t),
      ...(doc.disk === null ? [] : [footerButton("files-reload", "Reload", t.accent, cx => { this.reload(); cx.notify(); })]),
      footerButton("files-overwrite", doc.disk === null ? "Save again" : "Overwrite", t.accent, cx => this.save(cx, true)));
    if (doc.error) return line(doc.error, t.ansi1, footerButton("files-retry", "Retry", t.accent, cx => this.save(cx)));
    if (doc.locked) return line(doc.locked, t.dim);
    return line(doc.dirty ? "Unsaved" : "No changes", doc.dirty ? warning(t) : t.dim,
      div().flex_none().text_size(11.5).text_color(t.dim).child("ctrl-s"),
      footerButton("files-save", "Save", doc.dirty ? t.accent : t.dim, cx => this.save(cx)));
  }

  /**
   * The Files panel: a header with the open file and an orange ● for unsaved edits, then the
   * tree, or the open file's editor and footer.
   * @param {any} cx the view's context
   * @returns {any} the panel
   */
  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), doc = this.doc;
    const font = doc ? settings() : null;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(doc?.dirty), el => el.child(div().flex_none().text_size(11.5).text_color(warning(t)).child("●"))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11.5).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(doc
        // The editor holds the keyboard, so its key events pass through this wrapper. `cmd` is ctrl on Linux and Windows.
        ? v_flex().id("files-editor").flex_1().min_h(0)
          .on_key_down((event, cx) => { if (event.keystroke === "cmd-s") { cx.stop_propagation(); this.save(cx); } })
          .child(Editor.new(doc.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0))
        : div().p(12).flex_1().min_h(0).text_color(t.dim).child(this.fileError || "Loading file…"))
        .child(this.footer(t)));
  }
}
