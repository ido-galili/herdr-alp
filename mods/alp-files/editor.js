// Alp: the Files editor, a pane beside the tab's terminals (pane.split {mod: "alp-files",
// props: {file, on, root, tab}}). The Files panel opens files here: the tab's editor pane
// switches file, and a file with unsaved edits stays open as a chip until it's saved or dropped.
// Local files are editable (ctrl-s saves); remote and oversized ones stay read-only.
// Alp: auto save, as VS Code's `files.autoSave`, comes from Alp's Settings (the `files` section
// of ~/.config/alp/settings.json): off, a moment after the last edit, or on leaving the file.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, home, readTextFile, writeTextFile, theme, settings, window, panes, run, shared, setShared } from "herdr";

// Every editor pane in this VM (the mod copies share it), so the Files panel can mark open
// and unsaved files: pane object → { tab, current, unsaved: Set<abs>, quiet: Set<abs> }
// (quiet: unsaved, but auto save will save them, so the mark isn't orange).
export const EDITORS = (globalThis[Symbol.for("alp-files.editors")] ??= new Map());
// The shared key the Files panel writes to open a file in a tab's existing editor pane.
export const OPEN_KEY = "alp-files.open";
// Alp: the key Alp's Settings bumps after saving the settings file.
const SETTINGS_STAMP_KEY = "alp.settingsStamp";
// Alp: auto save as last read from the settings file, shared by every editor pane in this VM.
// `stamp` is the settings stamp it was read at (undefined: not read yet).
const AUTO = (globalThis[Symbol.for("alp-files.autosave")] ??= { mode: "off", delay: 1000, stamp: undefined });
const AUTO_MODES = ["off", "afterDelay", "onFocusChange"],
  AUTO_MIN = 200,
  AUTO_MAX = 60000;

/**
 * Alp: reads auto save from the settings file once, and again whenever Alp's Settings saves it
 * (the settings stamp moves). The keys are optional: a missing or unreadable file means off.
 * @param {any} cx the context to read in and re-render
 * @returns {void}
 */
function followSettings(cx) {
  const stamp = shared(SETTINGS_STAMP_KEY) ?? null;
  if (stamp === AUTO.stamp) return;
  AUTO.stamp = stamp;
  cx.spawn(async (cx) => {
    let files = {};
    try {
      files = JSON.parse((await readTextFile(`${home()}/.config/alp/settings.json`)) || "{}")?.files ?? {};
    } catch {}
    const delay = Math.round(Number(files.autoSaveDelay));
    AUTO.mode = AUTO_MODES.includes(files.autoSave) ? files.autoSave : "off";
    AUTO.delay = Number.isFinite(delay) && delay > 0 ? Math.min(AUTO_MAX, Math.max(AUTO_MIN, delay)) : 1000;
    // The Files panel's marks depend on it: quiet while auto save is on.
    for (const pane of EDITORS.keys()) pane.publish();
    cx.notify();
  });
}

// The editor highlights with syntect's default grammars, found by extension. Alp: these
// map extensions it lacks to the closest one it has (no TypeScript, TOML, Vue or Dockerfile).
const LANG = {
  ts: "js",
  tsx: "js",
  mts: "js",
  cts: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  toml: "yaml",
  yml: "yaml",
  jsonc: "json",
  json5: "json",
  webmanifest: "json",
  svelte: "html",
  vue: "html",
  astro: "html",
  htm: "html",
  svg: "xml",
  plist: "xml",
  zsh: "sh",
  bash: "sh",
  fish: "sh",
  ksh: "sh",
  env: "sh",
  mdx: "md",
  markdown: "md",
  scss: "css",
  less: "css",
  pyi: "py",
  mk: "makefile",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  kts: "java",
  kt: "java",
};
// Alp: files known by their whole name, mostly without an extension.
const NAMES = {
  makefile: "makefile",
  gnumakefile: "makefile",
  dockerfile: "sh",
  containerfile: "sh",
  justfile: "makefile",
  ".bashrc": "sh",
  ".bash_profile": "sh",
  ".profile": "sh",
  ".zshrc": "sh",
  ".zprofile": "sh",
  ".env": "sh",
  ".envrc": "sh",
  ".gitignore": "sh",
  ".gitattributes": "sh",
  ".dockerignore": "sh",
  ".npmrc": "sh",
  ".editorconfig": "sh",
  gemfile: "rb",
  rakefile: "rb",
  ".prettierrc": "json",
  ".eslintrc": "json",
};

/**
 * Alp: the grammar to highlight a file with, from its name or else its extension.
 * Names are matched case-insensitively, so `Dockerfile.dev` and `.env.local` count too.
 * @param {string} path the file's path, relative or absolute
 * @returns {string} a syntect token (extension or grammar name); "txt" means plain text
 */
function language(path) {
  const name = path.split(/[\\/]/).pop().toLowerCase();
  const known =
    NAMES[name] ??
    NAMES[
      name
        .split(".")
        .slice(0, name.startsWith(".") ? 2 : 1)
        .join(".")
    ];
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
const syntaxColors = (t) => ({
  keyword: t.ansi5,
  operator: t.ansi5,
  "string.escape": t.ansi5,
  string: t.ansi3,
  function: t.ansi2,
  type: t.ansi6,
  number: t.ansi4,
  constant: t.ansi4,
  boolean: t.ansi4,
  comment: t.dim,
  variable: t.foreground,
  punctuation: t.foreground,
});
// Alp: files longer than this are shown cut off, so they can't be saved.
const SHOW_LIMIT = 400000;

/**
 * The text the editor shows for a file: the whole of it, or its start when it's too long.
 * @param {string} text the file's contents
 * @returns {string} the text to put in the editor
 */
const shown = (text) => (text.length > SHOW_LIMIT ? text.slice(0, SHOW_LIMIT) + "\n… (file truncated)" : text);

/**
 * Alp: the theme's warning colour (orange), for unsaved edits and a file changed on disk.
 * A theme may not carry `warning`, so fall back to Alp's.
 * @param {any} t the theme
 * @returns {string} the warning colour
 */
const warning = (t) => t.warning ?? "#ffb86c";

/**
 * Alp: a box button. `filled` is the main choice; the others are outlined, or accent text
 * (`pressed`: the same, on while its view shows, and a click turns it off).
 * @param {string} id element id
 * @param {string} label button text
 * @param {"filled" | "outlined" | "text" | "pressed"} kind how it looks
 * @param {any} t the theme
 * @param {(cx: any) => void} onClick runs on click
 * @returns {any} the button element
 */
const boxButton = (id, label, kind, t, onClick) =>
  div()
    .id(id)
    .h(26)
    .px(10)
    .flex()
    .flex_none()
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12)
    .when(kind === "filled", (el) =>
      el
        .bg(t.border)
        .text_color(t.foreground)
        .hover((s) => s.bg(t.hover)),
    )
    .when(kind === "outlined", (el) =>
      el
        .border_1()
        .border_color(t.border)
        .text_color(t.foreground)
        .hover((s) => s.bg(t.hover)),
    )
    .when(kind === "text", (el) => el.text_color(t.accent).hover((s) => s.bg(t.hover)))
    .when(kind === "pressed", (el) =>
      el
        .bg(t.accent + "30")
        .text_color(t.accent)
        .hover((s) => s.bg(t.accent + "40")),
    )
    .on_click((_e, cx) => onClick(cx))
    .child(label);

// Alp: Compare gives up past this many changed lines (Myers' cost grows with their square).
const DIFF_LIMIT = 3000;
// Alp: the diff's rows, laid out like the Changes panel's: 1.8 × the text size high.
const rowHeight = (size) => Math.ceil(size * 1.8),
  charWidth = (size) => size * 0.64;

/**
 * Alp: text draws a tab as nothing, so pad each to the next 4-column stop (as Changes does).
 * @param {string} text one line
 * @returns {string} the line with tabs turned into spaces
 */
const untab = (text) =>
  text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd(s.length - 1 - ((s.length - 1) % 4) + 4));

/**
 * Alp: a line diff of two texts (Myers), as unified-diff rows with 3 lines of context.
 * The common start and end are trimmed first, so a small edit in a long file stays cheap.
 * @param {string} before the old text (the file on disk)
 * @param {string} after the new text (the edits)
 * @returns {{ kind: string, number?: number, text: string }[] | null} the rows ("@" hunk heads,
 *   " " context, "-" only in `before`, "+" only in `after`), or null past DIFF_LIMIT changes
 */
function lineDiff(before, after) {
  // A last newline would show as an empty last line.
  const a = before.replace(/\n$/, "").split("\n"),
    b = after.replace(/\n$/, "").split("\n");
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start,
    m = endB - start,
    max = Math.min(n + m, DIFF_LIMIT);
  // trace[d] holds V for k = -d..d after step d; V[k] is the furthest x on diagonal k.
  const v = new Int32Array(2 * max + 3),
    off = max + 1,
    trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1,
        y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return null;
  // Walk back from the end, one edit per step, collecting [kind, line] in reverse.
  const ops = [];
  let x = n,
    y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1],
      at = (k) => prev[k + d - 1],
      k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(prevK),
      py = px - prevK;
    while (x > px && y > py) {
      ops.push([" ", a[start + x - 1]]);
      x--;
      y--;
    }
    if (x === px) {
      ops.push(["+", b[start + y - 1]]);
      y--;
    } else {
      ops.push(["-", a[start + x - 1]]);
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push([" ", a[start + x - 1]]);
    x--;
    y--;
  }
  ops.reverse();
  const all = [...a.slice(0, start).map((l) => [" ", l]), ...ops, ...a.slice(endA).map((l) => [" ", l])];
  // Number every line on both sides, then keep only the changes and 3 lines around them.
  let oldNo = 1,
    newNo = 1;
  const lines = all.map(([kind, text]) => ({
    kind,
    text,
    old: kind === "+" ? null : oldNo++,
    next: kind === "-" ? null : newNo++,
  }));
  const near = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.kind !== " ") for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) near[j] = 1;
  });
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!near[i]) continue;
    let end = i;
    while (end < lines.length && near[end]) end++;
    const hunk = lines.slice(i, end),
      first = hunk[0];
    const olds = hunk.filter((l) => l.kind !== "+").length,
      news = hunk.filter((l) => l.kind !== "-").length;
    const oldAt = first.old ?? hunk.find((l) => l.old !== null)?.old ?? oldNo,
      newAt = first.next ?? hunk.find((l) => l.next !== null)?.next ?? newNo;
    rows.push({ kind: "@", text: `@@ -${oldAt},${olds} +${newAt},${news} @@` });
    for (const l of hunk)
      rows.push({ kind: l.kind, number: l.kind === "-" ? l.old : l.next, text: untab(l.text) || " " });
    i = end - 1;
  }
  return rows;
}

/**
 * Alp: the folder a file is in, relative to the Files panel's root and starting with the
 * root's own name ("website/src/lib"), or its full folder outside the root.
 * @param {string} abs the file's absolute path
 * @param {string | null} root the Files panel's folder when it opened the file
 * @returns {string} the folder to show
 */
function folderOf(abs, root) {
  const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
  if (!root || (dir !== root && !dir.startsWith(root + "/"))) return dir;
  return root.split("/").pop() + dir.slice(root.length);
}

export class EditorPane {
  /**
   * @param {{ file: string, on?: string | null, root?: string | null, tab?: string }} props what to open, from pane.split
   * @param {any} cx the view's context
   */
  constructor(props, cx) {
    this.on = props.on ?? null;
    this.root = props.root ?? null;
    this.tab = props.tab ?? null;
    // The open documents: the one on screen, and any others with unsaved edits.
    this.docs = [];
    this.doc = null;
    this.closing = null;
    this.note = null;
    // Open requests older than this pane were for someone else.
    this.seen = Date.now();
    this.entry = { tab: this.tab, current: null, unsaved: new Set(), quiet: new Set() };
    EDITORS.set(this, this.entry);
    this.open(props.file, cx);
    cx.timer.every(2000, (cx) => {
      if (window()?.active !== false) this.checkAll(cx);
    });
  }

  /**
   * The pane this editor is drawn in: the alp-files pane of its tab.
   * @returns {string | null} the pane id
   */
  paneId() {
    return panes().find((p) => p.tab === this.tab && p.mod === "alp-files")?.pane ?? null;
  }

  /**
   * Tells the Files panel which files are open and unsaved, so its tree marks them. Alp: and
   * which of those auto save will save, so their mark is quiet.
   * @returns {void}
   */
  publish() {
    const unsaved = this.docs.filter((d) => d.dirty).map((d) => d.abs);
    const quiet = this.docs.filter((d) => d.dirty && !this.nagging(d)).map((d) => d.abs);
    /**
     * Whether a list holds just the set's paths.
     * @param {string[]} list the paths now
     * @param {Set<string>} set the paths published before
     * @returns {boolean} true when they match
     */
    const same = (list, set) => list.length === set.size && list.every((a) => set.has(a));
    const changed =
      this.entry.current !== this.doc?.abs || !same(unsaved, this.entry.unsaved) || !same(quiet, this.entry.quiet);
    this.entry.current = this.doc?.abs ?? null;
    this.entry.unsaved = new Set(unsaved);
    this.entry.quiet = new Set(quiet);
    // A shared bump re-renders the Files panel (every mod re-renders on setShared).
    if (changed) setShared("alp-files.marks", Date.now());
  }

  /**
   * Shows a file: one already open comes to the front; otherwise it's read from disk and
   * replaces the document on screen, unless that one has unsaved edits, which stays as a chip.
   * @param {string} abs the file's absolute path
   * @param {any} cx the context to load in
   * @returns {void}
   */
  open(abs, cx) {
    this.closing = null;
    this.note = null;
    this.failed = null;
    if (this.doc && this.doc.abs !== abs) this.leave(this.doc, cx);
    const open = this.docs.find((d) => d.abs === abs);
    if (open) {
      this.doc = open;
      this.publish();
      return;
    }
    const before = this.doc;
    this.doc = null;
    this.loading = abs;
    this.failed = null;
    /**
     * The file can't be shown: say why, over the document that was on screen if there is one.
     * @param {string} why the reason
     * @returns {void}
     */
    const fail = (why) => {
      if (before && this.docs.includes(before)) {
        this.doc = before;
        this.failed = `Couldn't open ${abs.split("/").pop()}: ${why}.`;
      } else this.note = why;
    };
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(abs, { on: this.on });
        if (this.loading !== abs) return;
        if (text === null) {
          fail("it's no longer on disk");
          return;
        }
        if (text.includes("\0")) {
          fail("it's a binary file");
          return;
        }
        // writeTextFile only reaches this machine, and a cut-off file would lose its end on save.
        const locked = this.on
          ? "Read-only · on another machine"
          : text.length > SHOW_LIMIT
            ? "Read-only · too long to edit"
            : null;
        const code = EditorState.new({
          language: language(abs),
          readonly: Boolean(locked),
          value: shown(text),
          syntax: syntaxColors(theme()),
        });
        const doc = {
          abs,
          name: abs.split("/").pop(),
          code,
          base: text,
          locked,
          dirty: false,
          saving: false,
          disk: undefined,
          error: null,
          compare: null,
          branch: null,
          timer: null,
          saved: false,
        };
        code.on("change", (_e, cx) => {
          const dirty = !doc.locked && code.value() !== doc.base;
          if (dirty !== doc.dirty) {
            doc.dirty = dirty;
            this.publish();
            cx.notify();
          }
          // Alp: each edit restarts the auto save delay; an edit back to the file's text needs none.
          if (dirty && AUTO.mode === "afterDelay") this.autoSaveLater(doc, cx);
          else if (!dirty) this.cancelAutoSave(doc);
        });
        // Alp: "When you leave the file": the editor losing the keyboard saves it.
        code.on("blur", (_e, cx) => {
          if (AUTO.mode === "onFocusChange") this.autoSave(doc, cx);
        });
        // The document it replaces goes, unless it has edits to keep.
        if (before && !before.dirty && before.disk === undefined && this.docs.includes(before)) this.drop(before);
        this.docs.push(doc);
        this.doc = doc;
        const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, on: this.on })
          .then((r) => {
            if (r.code === 0) {
              doc.branch = r.stdout.trim();
              cx.notify();
            }
          })
          .catch(() => {});
      } catch {
        if (this.loading === abs) fail("it's too large or unreadable");
      } finally {
        if (this.loading === abs) this.loading = null;
        this.publish();
        cx.notify();
      }
    });
  }

  /**
   * Forgets a document and frees its editor; the next one left comes to the front.
   * @param {any} doc the document
   * @returns {void}
   */
  drop(doc) {
    this.cancelAutoSave(doc);
    this.docs = this.docs.filter((d) => d !== doc);
    doc.code.release();
    if (this.doc === doc) this.doc = this.docs[this.docs.length - 1] ?? null;
    this.publish();
  }

  /**
   * Alp: compares every open document with its file on disk. A clean document follows
   * the disk (an agent's edit shows up); an edited one is flagged as changed on disk,
   * and an open Compare is redone against the new disk text.
   * @param {any} cx the context to re-render in
   * @returns {void}
   */
  checkAll(cx) {
    cx.spawn(async (cx) => {
      let changed = false;
      for (const doc of [...this.docs]) changed = (await this.checkDisk(doc)) || changed;
      if (changed) {
        this.publish();
        cx.notify();
      }
    });
  }

  /**
   * Alp: compares one document with its file on disk (see checkAll).
   * @param {any} doc the document
   * @returns {Promise<boolean>} whether anything changed
   */
  async checkDisk(doc) {
    if (doc.saving) return false;
    const disk = await readTextFile(doc.abs, { on: this.on }).catch(() => undefined);
    if (!this.docs.includes(doc) || doc.saving || disk === undefined || (disk !== null && disk.includes("\0")))
      return false;
    if (disk === doc.base) {
      if (doc.disk === undefined) return false;
      doc.disk = undefined;
      doc.compare = null;
      return true;
    }
    if (doc.dirty || disk === null) {
      if (disk === doc.disk) return false;
      if (doc.compare) doc.compare = typeof disk === "string" ? this.diff(doc, disk) : null;
      doc.disk = disk;
      return true;
    }
    doc.base = disk;
    doc.disk = undefined;
    doc.error = null;
    doc.code.set_value(shown(disk));
    return true;
  }

  /**
   * Alp: writes a document. The write is refused when the file changed on disk since it was
   * read (or since "Keep my edits"), so another program's edit is never overwritten silently:
   * the changed-on-disk box comes back instead.
   * @param {any} doc the document
   * @param {any} cx the context to re-render in
   * @returns {Promise<boolean>} whether it was saved (or had nothing to save)
   */
  async save(doc, cx) {
    if (!doc || doc.locked || !doc.dirty) return true;
    if (doc.saving || doc.disk !== undefined) return false;
    // A save now stands in for an auto save that was due.
    this.cancelAutoSave(doc);
    const text = doc.code.value();
    doc.saving = true;
    doc.error = null;
    cx.notify();
    try {
      await writeTextFile(doc.abs, text, doc.base);
      doc.base = text;
      doc.disk = undefined;
      doc.compare = null;
      doc.saved = true;
      doc.dirty = doc.code.value() !== text;
      return true;
    } catch (e) {
      const disk = await readTextFile(doc.abs).catch(() => undefined);
      if (disk !== undefined && disk !== doc.base) doc.disk = disk;
      else doc.error = `Not saved: ${e?.message ?? e}`;
      return false;
    } finally {
      doc.saving = false;
      this.publish();
      cx.notify();
    }
  }

  /**
   * Alp: whether auto save is on, so the top line says "Saving…" or "Saved" instead of
   * nagging with "● Unsaved".
   * @returns {boolean} true unless auto save is off
   */
  autoSaving() {
    return AUTO.mode !== "off";
  }

  /**
   * Alp: (re)starts a document's auto save delay; the save runs when it ends.
   * @param {any} doc the document
   * @param {any} cx the context to run the timer from
   * @param {number} [ms] how long to wait; the settings' delay by default
   * @returns {void}
   */
  autoSaveLater(doc, cx, ms = AUTO.delay) {
    this.cancelAutoSave(doc);
    doc.timer = cx.timer.after(ms, (cx) => {
      doc.timer = null;
      this.autoSave(doc, cx);
    });
  }

  /**
   * Alp: stops a document's pending auto save, if one is waiting.
   * @param {any} doc the document
   * @returns {void}
   */
  cancelAutoSave(doc) {
    doc.timer?.cancel();
    doc.timer = null;
  }

  /**
   * Alp: an auto save. It goes through `save`, so a file that changed on disk is never
   * overwritten: the changed-on-disk box shows and decides. A save still writing is waited
   * for; edits made while it wrote are saved after it.
   * @param {any} doc the document
   * @param {any} cx the context to save in
   * @returns {void}
   */
  autoSave(doc, cx) {
    if (AUTO.mode === "off" || !this.docs.includes(doc) || doc.locked || !doc.dirty || doc.disk !== undefined) return;
    if (doc.saving) {
      this.autoSaveLater(doc, cx, 300);
      return;
    }
    cx.spawn(async (cx) => {
      const ok = await this.save(doc, cx);
      if (ok && doc.dirty && AUTO.mode === "afterDelay" && this.docs.includes(doc) && !doc.timer)
        this.autoSaveLater(doc, cx);
      // Leaving the file to close it (✕) asked about edits this save just wrote: close as asked.
      const asked = this.closing ? (this.closing.doc ? [this.closing.doc] : this.docs) : null;
      if (ok && asked && !asked.some((d) => d.dirty)) {
        this.finishClose(this.closing.doc);
        cx.notify();
      }
    });
  }

  /**
   * Alp: the editor moves off a document (another file, or another chip): with auto save on
   * leaving the file, it saves. The save runs from a timer, since a file switch can come
   * while the pane draws (the Files panel's open request), where a save can't start.
   * @param {any} doc the document left
   * @param {any} cx the context to save from
   * @returns {void}
   */
  leave(doc, cx) {
    if (AUTO.mode === "onFocusChange" && doc.dirty) this.autoSaveLater(doc, cx, 1);
  }

  /**
   * Alp: "Use the file on disk": drops the document's edits and shows the file as it is on disk.
   * @param {any} doc the document
   * @returns {void}
   */
  reload(doc) {
    if (typeof doc?.disk !== "string") return;
    doc.base = doc.disk;
    doc.disk = undefined;
    doc.error = null;
    doc.compare = null;
    doc.code.set_value(shown(doc.base));
    doc.dirty = false;
    this.publish();
  }

  /**
   * Alp: "Keep my edits": takes the disk's version as the one the edits replace, so the
   * next Save overwrites it knowingly (or, for a deleted file, writes it anew).
   * @param {any} doc the document
   * @returns {void}
   */
  keep(doc) {
    if (!doc || doc.disk === undefined) return;
    doc.base = doc.disk;
    doc.disk = undefined;
    doc.error = null;
    doc.compare = null;
    doc.dirty = doc.code.value() !== doc.base;
    this.publish();
  }

  /**
   * Alp: the changed-on-disk box's "Keep my edits", then, with auto save after a delay, the
   * edits are saved over the disk's version as a Save would (you chose them).
   * @param {any} doc the document
   * @param {any} cx the context
   * @returns {void}
   */
  keepAndSave(doc, cx) {
    this.keep(doc);
    if (doc.dirty && AUTO.mode === "afterDelay") this.autoSaveLater(doc, cx);
  }

  /**
   * Alp: the document against a disk text, as diff rows ("-" on disk, "+" my edits).
   * @param {any} doc the document
   * @param {string} disk the file's text on disk
   * @returns {{ rows: any[] | null, longest: number }} the rows (null: too many changes) and the longest line's length
   */
  diff(doc, disk) {
    const rows = lineDiff(disk, doc.code.value());
    return { rows, longest: rows ? rows.reduce((n, r) => Math.max(n, r.text.length), 0) : 0 };
  }

  /**
   * Alp: Compare turns on the diff in place of the editor, or off again.
   * @param {any} doc the document
   * @returns {void}
   */
  toggleCompare(doc) {
    doc.compare = doc.compare || typeof doc.disk !== "string" ? null : this.diff(doc, doc.disk);
  }

  /**
   * Closes one document (its chip's ✕), or the whole pane (the top line's ✕). With unsaved
   * edits it asks first: Save, Discard or Keep editing.
   * @param {any | null} doc the document, or null for the pane
   * @param {any} cx the context
   * @returns {void}
   */
  requestClose(doc, cx) {
    const dirty = doc ? doc.dirty : this.docs.some((d) => d.dirty);
    if (dirty) {
      this.closing = { doc };
      if (doc) this.doc = doc;
      cx.notify();
      return;
    }
    this.finishClose(doc);
    cx.notify();
  }

  /**
   * Closes a document, or the pane, now.
   * @param {any | null} doc the document, or null for the pane
   * @returns {void}
   */
  finishClose(doc) {
    this.closing = null;
    if (doc && this.docs.length > 1) {
      this.drop(doc);
      return;
    }
    const pane = this.paneId();
    if (pane) run("pane.close", { pane });
  }

  /**
   * The close question's Save: saves what it covers, then closes; a refused save (the
   * file changed on disk) leaves the pane open with the changed-on-disk box.
   * @param {any} cx the context
   * @returns {void}
   */
  saveAndClose(cx) {
    const doc = this.closing?.doc ?? null,
      docs = doc ? [doc] : this.docs.filter((d) => d.dirty);
    this.closing = null;
    cx.spawn(async (cx) => {
      let ok = true;
      for (const d of docs) ok = (await this.save(d, cx)) && ok;
      if (ok) this.finishClose(doc);
      cx.notify();
    });
  }

  /**
   * Run when the pane goes away: frees the editors and unlists this pane.
   * @returns {void}
   */
  dispose() {
    for (const d of this.docs) {
      this.cancelAutoSave(d);
      d.code.release();
    }
    this.docs = [];
    this.doc = null;
    EDITORS.delete(this);
    setShared("alp-files.marks", Date.now());
  }

  /**
   * Opens what the Files panel asked for, when it's for this pane's tab and newer than what was seen.
   * @param {any} cx the context
   * @returns {void}
   */
  takeRequest(cx) {
    const req = shared(OPEN_KEY);
    if (!req || req.tab !== this.tab || !(req.n > this.seen)) return;
    this.seen = req.n;
    if (req.root) this.root = req.root;
    this.open(req.file, cx);
  }

  /**
   * A small icon button.
   * @param {any} t the theme
   * @param {string} id element id
   * @param {string} tip its tooltip
   * @param {(cx: any) => void} onClick runs on click
   * @returns {any} the button
   */
  closeButton(t, id, tip, onClick) {
    return div()
      .id(id)
      .p(3)
      .flex_none()
      .rounded(5)
      .cursor_pointer()
      .text_color(t.dim)
      .tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(svg("mods/alp-files/close.svg").size(14));
  }

  /**
   * Alp: whether a document's unsaved edits are flagged in orange: always with auto save off,
   * and with it on only when it can't save on its own (a failed save, or a file changed on disk).
   * @param {any} doc the document
   * @returns {boolean} true to show the orange ●
   */
  nagging(doc) {
    return doc.dirty && (!this.autoSaving() || Boolean(doc.error) || doc.disk !== undefined);
  }

  /**
   * The quiet top line: the file's name, its folder · branch in dim, the state (an orange
   * "● Unsaved", "Saving…", or why it's read-only), Save (Ctrl+S) and ✕. Alp: with auto save
   * on, edits show a quiet "Saving…" (after a delay) or "Unsaved" (on leaving the file), and
   * "Saved" once saved; a failed save or a disk change still shows "● Unsaved".
   * @param {any} t the theme
   * @returns {any} the line
   */
  topLine(t) {
    const doc = this.doc;
    const where = doc ? [folderOf(doc.abs, this.root), doc.branch].filter(Boolean).join(" · ") : "";
    /**
     * A state word.
     * @param {string} text the word
     * @param {string} color its colour
     * @returns {any} the element
     */
    const word = (text, color) => div().id("files-state").flex_none().text_size(12).text_color(color).child(text);
    const quiet = Boolean(doc) && this.autoSaving() && !this.nagging(doc);
    const state = !doc
      ? null
      : doc.saving
        ? word("Saving…", t.muted)
        : doc.locked
          ? word(doc.locked, t.dim)
          : doc.dirty && !quiet
            ? word("● Unsaved", warning(t))
            : doc.dirty
              ? word(AUTO.mode === "afterDelay" ? "Saving…" : "Unsaved", t.muted)
              : quiet && doc.saved
                ? word("Saved", t.dim)
                : null;
    const canSave = Boolean(doc?.dirty && !doc.saving && doc.disk === undefined);
    return h_flex()
      .h(40)
      .flex_none()
      .pl(12)
      .pr(8)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(svg("mods/alp-files/file.svg").size(14).flex_none().text_color(t.muted))
      .child(
        div()
          .flex_none()
          .max_w(260)
          .truncate()
          .font_medium()
          .text_size(13)
          .text_color(t.foreground)
          .child(doc?.name ?? this.loading?.split("/").pop() ?? "Files"),
      )
      .child(
        div()
          .id("files-where")
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(12)
          .text_color(t.dim)
          .when(Boolean(doc), (el) => el.tooltip(doc.abs))
          .child(where),
      )
      .when(Boolean(state), (el) => el.child(state))
      .when(Boolean(doc) && !doc.locked, (el) =>
        el.child(
          div()
            .id("files-save")
            .h(26)
            .px(10)
            .flex()
            .flex_none()
            .items_center()
            .rounded(6)
            .text_size(12)
            .tooltip("Ctrl+S")
            .when(canSave, (e) =>
              e
                .cursor_pointer()
                .bg(t.accent + "26")
                .text_color(t.accent)
                .hover((s) => s.bg(t.accent + "40")),
            )
            .when(!canSave, (e) => e.text_color(t.dim))
            .on_click((_e, cx) => {
              if (canSave)
                cx.spawn(async (cx) => {
                  await this.save(doc, cx);
                });
            })
            .child("Save"),
        ),
      )
      .child(this.closeButton(t, "files-close-pane", "Close", (cx) => this.requestClose(null, cx)));
  }

  /**
   * The open documents as chips, when there's more than one: a click shows one, ✕ closes it.
   * @param {any} t the theme
   * @returns {any} the strip
   */
  chips(t) {
    return h_flex()
      .id("files-chips")
      .h(34)
      .flex_none()
      .px(8)
      .gap(4)
      .items_center()
      .overflow_x_scroll()
      .border_b(1)
      .border_color(t.border)
      .children(
        this.docs.map((d, i) =>
          h_flex()
            .id(`files-chip-${i}`)
            .h(26)
            .pl(10)
            .pr(3)
            .gap(6)
            .flex_none()
            .items_center()
            .rounded(6)
            .cursor_pointer()
            .text_size(12)
            .when(d === this.doc, (e) => e.bg(t.hover).text_color(t.foreground))
            .when(d !== this.doc, (e) => e.text_color(t.muted).hover((s) => s.bg(t.hover)))
            .on_click((_e, cx) => {
              if (d !== this.doc && this.doc) this.leave(this.doc, cx);
              this.doc = d;
              this.closing = null;
              this.failed = null;
              this.publish();
              cx.notify();
            })
            .child(d.name)
            .when(d.dirty, (e) =>
              e.child(
                div()
                  .text_color(this.nagging(d) ? warning(t) : t.dim)
                  .child("●"),
              ),
            )
            .child(this.closeButton(t, `files-chip-x-${i}`, "Close", (cx) => this.requestClose(d, cx))),
        ),
      );
  }

  /**
   * A box over the editor in the changed-on-disk style: a sentence and its buttons.
   * @param {any} t the theme
   * @param {string} id element id
   * @param {string} text what happened
   * @param {any[]} buttons the choices
   * @param {string} [border] the border colour (orange by default; red for an error)
   * @returns {any} the box
   */
  box(t, id, text, buttons, border = warning(t)) {
    return v_flex()
      .id(id)
      .flex_none()
      .m(8)
      .mb(0)
      .p(12)
      .gap(10)
      .rounded(8)
      .border_1()
      .border_color(border + "80")
      .bg(t.background)
      .child(div().text_size(13).text_color(t.foreground).child(text))
      .child(h_flex().gap(8).flex_wrap().children(buttons));
  }

  /**
   * The box over the editor, if one is due: the close question, the file changed or went away
   * on disk while it had edits (whose version wins, or Compare), or a failed save.
   * @param {any} t the theme
   * @returns {any | null} the box
   */
  question(t) {
    const doc = this.doc;
    /**
     * A click handler that runs `fn` and re-renders.
     * @param {() => void} fn what the button does
     * @returns {(cx: any) => void} the handler
     */
    const notify = (fn) => (cx) => {
      fn();
      cx.notify();
    };
    if (this.closing) {
      const scope = this.closing.doc ? [this.closing.doc] : this.docs.filter((d) => d.dirty);
      const text =
        scope.length === 1 ? `${scope[0].name} has unsaved edits.` : `${scope.length} files have unsaved edits.`;
      return this.box(t, "files-close-box", text, [
        boxButton("files-close-save", "Save", "filled", t, (cx) => this.saveAndClose(cx)),
        boxButton(
          "files-close-discard",
          "Discard",
          "outlined",
          t,
          notify(() => {
            for (const d of scope) d.dirty = false;
            this.finishClose(this.closing.doc);
          }),
        ),
        boxButton(
          "files-close-keep",
          "Keep editing",
          "text",
          t,
          notify(() => {
            this.closing = null;
          }),
        ),
      ]);
    }
    if (!doc) return null;
    if (this.failed)
      return this.box(
        t,
        "files-open-failed",
        this.failed,
        [
          boxButton(
            "files-open-ok",
            "OK",
            "outlined",
            t,
            notify(() => {
              this.failed = null;
            }),
          ),
        ],
        t.blocked,
      );
    if (doc.disk !== undefined) {
      const gone = doc.disk === null;
      const text = gone
        ? doc.dirty
          ? `${doc.name} was deleted on disk while you were editing it.`
          : `${doc.name} was deleted on disk.`
        : `${doc.name} changed on disk while you were editing it.`;
      const buttons = gone
        ? [
            ...(doc.dirty
              ? [
                  boxButton("files-keep", "Keep my edits", "filled", t, (cx) => {
                    this.keepAndSave(doc, cx);
                    cx.notify();
                  }),
                ]
              : []),
            boxButton(
              "files-close",
              "Close it",
              doc.dirty ? "outlined" : "filled",
              t,
              notify(() => {
                doc.dirty = false;
                this.finishClose(doc);
              }),
            ),
          ]
        : [
            boxButton("files-keep", "Keep my edits", "filled", t, (cx) => {
              this.keepAndSave(doc, cx);
              cx.notify();
            }),
            boxButton(
              "files-use-disk",
              "Use the file on disk",
              "outlined",
              t,
              notify(() => this.reload(doc)),
            ),
            boxButton(
              "files-compare",
              "Compare",
              doc.compare ? "pressed" : "text",
              t,
              notify(() => this.toggleCompare(doc)),
            ),
          ];
      return this.box(t, "files-disk-box", text, buttons);
    }
    if (doc.error)
      return this.box(
        t,
        "files-error-box",
        doc.error,
        [
          boxButton("files-retry", "Retry", "filled", t, (cx) =>
            cx.spawn(async (cx) => {
              await this.save(doc, cx);
            }),
          ),
        ],
        t.blocked,
      );
    return null;
  }

  /**
   * Alp: Compare's read-only diff, in place of the editor: the file on disk (−) against
   * the edits (+), numbered and coloured as the Changes panel does it.
   * @param {any} t the theme
   * @param {any} font the editor's font settings
   * @returns {any} the diff view
   */
  compareView(t, font) {
    const { rows, longest } = this.doc.compare,
      size = font.font_size,
      height = rowHeight(size);
    const gutter = Math.ceil(5 * charWidth(size)) + 2;
    /**
     * One diff row.
     * @param {{ kind: string, number?: number, text: string }} row the row
     * @returns {any} its element
     */
    const line = ({ kind, number, text }) =>
      kind === "@"
        ? div()
            .w_full()
            .px(12)
            .h(height)
            .flex_none()
            .truncate()
            .bg(t.raised ?? t.hover)
            .text_color(t.dim)
            .child(text)
        : h_flex()
            .w_full()
            .h(height)
            .flex_none()
            .gap(10)
            .when(kind === "+", (e) => e.bg(t.ansi2 + "18"))
            .when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
            .child(
              div()
                .w(gutter)
                .flex_none()
                .text_right()
                .text_color(t.dim)
                .child(number == null ? "" : String(number)),
            )
            .child(
              div()
                .w(10)
                .flex_none()
                .text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim)
                .child(kind === " " ? "" : kind === "-" ? "−" : "+"),
            )
            .child(div().flex_1().min_w(0).truncate().child(text));
    return v_flex()
      .id("files-compare-view")
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .h(30)
          .flex_none()
          .px(14)
          .gap(14)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .text_size(12)
          .child(div().text_color(t.ansi1).child("− on disk"))
          .child(div().text_color(t.ansi2).child("+ my edits"))
          .child(div().flex_1())
          .child(div().text_color(t.dim).child("read-only")),
      )
      .child(
        !rows?.length
          ? div()
              .p(12)
              .text_size(12)
              .text_color(t.dim)
              .child(
                !rows
                  ? "Too many differences to compare"
                  : this.doc.code.value() === this.doc.disk
                    ? "No differences"
                    : "Only the newline at the end differs",
              )
          : div()
              .flex_1()
              .min_h(0)
              .relative()
              .font_family(font.font_family ?? "JetBrains Mono")
              .text_size(size)
              .child(
                div()
                  .id("files-compare-x")
                  .size_full()
                  .overflow_x_scrollbar()
                  .child(
                    div()
                      .w_full()
                      .min_w(Math.max(300, (longest + 2) * charWidth(size) + gutter + 40))
                      .h_full()
                      .child(
                        v_virtual_list(
                          "files-compare",
                          rows.length,
                          height,
                          (i) => String(i),
                          (range) => rows.slice(range.start, range.end).map(line),
                        ).size_full(),
                      ),
                  ),
              )
              .child(Scrollbar.vertical("files-compare").viewport_from_layout().absolute().inset_0()),
      );
  }

  /**
   * The editor pane: the top line, the chips (two or more files open), a question box when
   * one is due, then the editor (or Compare's diff in its place).
   * @param {any} cx the view's context
   * @returns {any} the pane
   */
  render(cx) {
    followSettings(cx);
    this.takeRequest(cx);
    const t = theme(),
      doc = this.doc,
      font = settings();
    return v_flex()
      .id("files-pane")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(this.topLine(t))
      .when(this.docs.length > 1, (el) => el.child(this.chips(t)))
      .child(this.question(t) ?? div())
      .child(
        doc
          ? // The editor holds the keyboard, so its key events pass through this wrapper. `cmd` is ctrl on Linux and Windows.
            v_flex()
              .id("files-editor")
              .flex_1()
              .min_h(0)
              .on_key_down((event, cx) => {
                if (event.keystroke === "cmd-s") {
                  cx.stop_propagation();
                  cx.spawn(async (cx) => {
                    await this.save(doc, cx);
                  });
                }
              })
              .child(
                doc.compare
                  ? this.compareView(t, font)
                  : Editor.new(doc.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0),
              )
          : div()
              .p(12)
              .flex_1()
              .min_h(0)
              .text_color(t.dim)
              .child(this.note || "Loading file…"),
      );
  }
}
