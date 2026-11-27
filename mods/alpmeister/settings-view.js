// The Settings tab: every setting in ~/.config/alp/alpmeister.json as a form, with the choices
// read from GitHub (your repositories, boards, a board's statuses and fields, a repository's
// workflows) and from your disk (local clones). Edits stay in a draft until Save.
//
// A side list picks the page: You (GitHub, Local folders, Claude buttons, Card filters, Files), then a
// page per workspace. The save bar stays at the bottom, under the page, which scrolls.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, NumberInput } from "gpui-base";
import { pickFolder, theme } from "herdr";
import {
  AUTO_SAVE_DELAY_RANGE,
  DEFAULT_ISSUE_PROMPT,
  DEFAULT_PR_PROMPT,
  DEFAULT_QUERIES,
  WORKSPACE_QUERY_DEFAULTS,
  inScope,
  normalizeConfig,
  normalizeWorkspace,
  tildePath,
} from "./config.js";
import { summaryWords } from "./search-terms.js";
import { boardFields, discover, findClones, guessRoles, repoDetails, saveSettings } from "./settings-data.js";
import { Chip, Note, TextButton, Toggle, statusColor, warningColor } from "./ui.js";

/** A deep copy of plain JSON data. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * Sets one value deep in plain JSON data, by its path.
 * @param {object} target The data; changed in place.
 * @param {(string | number)[]} path The keys down to the value.
 * @param {unknown} value The value.
 * @returns {void}
 */
function setPath(target, path, value) {
  let holder = target;
  for (const key of path.slice(0, -1)) holder = holder[key] ??= {};
  holder[path[path.length - 1]] = value;
}

/** A comma-separated field's values. */
const splitList = (text) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** How a list setting shows in its text field. */
const joinList = (values) => (values ?? []).join(", ");

/** How many options an open dropdown lists before asking you to type to narrow it. */
const PICKER_ROWS = 8;

/** The nightly run triggers a workflow can be counted from. */
const NIGHTLY_EVENTS = ["schedule", "workflow_dispatch", "push"];

/**
 * The text fields: which part of the settings each one edits. `account` fields edit the
 * account; `workspace` fields edit the workspace shown; `files` fields edit the Files section;
 * `ui` fields are the form's own.
 */
const FIELDS = {
  issuePrompt: {
    scope: "account",
    placeholder: "Empty: no Claude button on issues",
    get: (account) => account.launch.issue,
    set: (account, value) => (account.launch.issue = value),
  },
  prPrompt: {
    scope: "account",
    placeholder: "Empty: no Claude button on PRs",
    get: (account) => account.launch.pr,
    set: (account, value) => (account.launch.pr = value),
  },
  name: {
    scope: "workspace",
    placeholder: "Shown on the Overview switch",
    get: (ws) => ws.name,
    set: (ws, value) => (ws.name = value),
  },
  triage: {
    scope: "workspace",
    get: (ws) => ws.queries.triage,
    set: (ws, value) => (ws.queries.triage = value),
  },
  bugsQuery: {
    scope: "workspace",
    get: (ws) => ws.bugs.query,
    set: (ws, value) => (ws.bugs.query = value),
  },
  priorityField: {
    scope: "workspace",
    get: (ws) => ws.bugs.priorityField,
    set: (ws, value) => (ws.bugs.priorityField = value),
  },
  priorities: {
    scope: "workspace",
    placeholder: "Most urgent first, comma-separated",
    get: (ws) => joinList(ws.bugs.priorities),
    set: (ws, value) => (ws.bugs.priorities = splitList(value)),
  },
  spotlightLabels: {
    scope: "workspace",
    placeholder: "Labels that put an issue in the spotlight",
    get: (ws) => joinList(ws.spotlight.labels),
    set: (ws, value) => (ws.spotlight.labels = splitList(value)),
  },
  featureTypes: {
    scope: "workspace",
    get: (ws) => joinList(ws.spotlight.featureTypes),
    set: (ws, value) => (ws.spotlight.featureTypes = splitList(value)),
  },
  customer: {
    scope: "workspace",
    get: (ws) => ws.customer.labelMatch,
    set: (ws, value) => (ws.customer.labelMatch = value),
  },
  boardView: {
    scope: "workspace",
    placeholder: "The board's filter syntax, such as type:Bug iteration:@current",
    get: (ws) => ws.boardView.query,
    set: (ws, value) => (ws.boardView.query = value),
  },
  excludeTypes: {
    scope: "workspace",
    placeholder: "Issue types left out of the team in flight",
    get: (ws) => joinList(ws.inFlight.excludeTypes),
    set: (ws, value) => (ws.inFlight.excludeTypes = splitList(value)),
  },
  nightlyBranch: {
    scope: "workspace",
    get: (ws) => ws.nightly?.branch ?? "",
    set: (ws, value) => ws.nightly && (ws.nightly.branch = value),
  },
  autoSaveDelay: {
    scope: "files",
    get: (files) => String(files.autoSaveDelay),
    set: (files, value) => {
      const delay = Number.parseInt(value, 10);
      if (Number.isFinite(delay)) files.autoSaveDelay = delay;
    },
  },
  filter: { scope: "ui", placeholder: "Filter" },
};

/** The side list's You pages, in order. */
const ACCOUNT_PAGES = [
  { key: "github", label: "GitHub" },
  { key: "folders", label: "Local folders" },
  { key: "claude", label: "Claude buttons" },
  { key: "filters", label: "Card filters" },
  { key: "files", label: "Files" },
];

/** The Files editor's auto save choices, as the Files page offers them. */
const AUTO_SAVE_CHOICES = [
  { value: "off", label: "Off", tooltip: "Save with Ctrl+S or the Save button" },
  { value: "afterDelay", label: "After a delay", tooltip: "Save a moment after you stop typing" },
  { value: "onFocusChange", label: "When you leave the file", tooltip: "Save when you click away or switch files" },
];

/**
 * A count and its word, plural when the count is not one.
 * @param {number} count How many.
 * @param {string} word The word, singular.
 * @param {string} [plural] The plural, when it is not the word and "s".
 * @returns {string} Such as "2 labels".
 */
const counted = (count, word, plural = `${word}s`) => `${count} ${count === 1 ? word : plural}`;

/** A board's key in the caches: "owner#number". */
const boardKey = (board) => `${board.owner}#${board.number}`;

/**
 * How many settings differ between two versions: each changed value counts once. Objects and
 * lists of objects of the same length are compared field by field; any other list counts as one.
 * @param {unknown} a One version.
 * @param {unknown} b The other.
 * @returns {number} The number of values that differ.
 */
function countChanges(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return 0;
  const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (plain(a) && plain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].reduce((sum, key) => sum + countChanges(a[key], b[key]), 0);
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(plain)) {
    return a.reduce((sum, item, index) => sum + countChanges(item, b[index]), 0);
  }
  return 1;
}

export class SettingsForm {
  /**
   * Creates the form's text fields. Call from `init`: text state needs a live host call.
   * @param {(cx: object) => void} onSaved Called after the file is written.
   */
  constructor(onSaved) {
    this.onSaved = onSaved;
    /** The demo data the form shows instead of GitHub and the disk, or null. */
    this.demo = null;
    this.inputs = {};
    for (const [key, field] of Object.entries(FIELDS)) {
      const input = InputState.new({ placeholder: field.placeholder ?? "" });
      input.on("change", (_event, cx) => {
        this.fromInput(key);
        cx.notify();
      });
      this.inputs[key] = input;
    }
    // The delay is a number field: it steps by 100 ms and clamps to the range on blur.
    this.inputs.autoSaveDelay.set_step(100);
    this.inputs.autoSaveDelay.set_min(AUTO_SAVE_DELAY_RANGE.min);
    this.inputs.autoSaveDelay.set_max(AUTO_SAVE_DELAY_RANGE.max);
    /** Opens the filter dialog on a Card filters row; set by the view: `(row, cx) => void`. */
    this.onEditFilter = null;
    this.draft = null;
    this.saved = null;
    this.snapshot = null;
    this.wsIndex = 0;
    this.open = null;
    this.discovery = null;
    this.discovering = false;
    this.discoverError = null;
    this.details = {};
    this.fields = {};
    this.clones = null;
    this.guessFor = null;
    this.saving = false;
    this.message = null;
    this.removeArmed = false;
    /** The page shown: one of ACCOUNT_PAGES' keys, or "workspace" for the workspace at `wsIndex`. */
    this.page = "github";
    /** The folded sections that are open, by key: the board's columns start open. */
    this.folds = new Set(["board"]);
    /** Whether the status table shows its extra columns. */
    this.moreStatus = false;
    /** Set when the page changes, so the view scrolls it back to its top. */
    this.scrollTop = false;
  }

  /**
   * Starts editing a copy of the settings.
   * @param {object} config The settings as loaded.
   * @param {string | null} text The file's text as read, written back over on Save.
   */
  load(config, text) {
    this.draft = copy(config);
    this.saved = JSON.stringify(config);
    this.snapshot = text;
    this.wsIndex = Math.min(this.wsIndex, Math.max(0, config.workspaces.length - 1));
    if (this.page === "workspace" && !config.workspaces.length) this.page = "github";
    this.removeArmed = false;
    this.syncInputs();
  }

  /** Whether there is a draft to edit. */
  ready() {
    return Boolean(this.draft);
  }

  /** Whether the draft differs from the file. */
  dirty() {
    return Boolean(this.draft) && JSON.stringify(this.draft) !== this.saved;
  }

  /**
   * How many settings the draft changes, for "Settings · 2 unsaved".
   * @returns {number} 0 when nothing is unsaved; at least 1 when `dirty()`.
   */
  changeCount() {
    if (!this.dirty()) return 0;
    return Math.max(1, countChanges(this.draft, JSON.parse(this.saved)));
  }

  /**
   * Shows a workspace's page by its name, and optionally opens one of its dropdowns, such as the
   * board picker ("ws-board"). Unsaved edits stay.
   * @param {string} name The workspace's name.
   * @param {{ picker?: string }} [options] The dropdown to open.
   * @returns {boolean} Whether the draft has that workspace.
   */
  showWorkspace(name, { picker } = {}) {
    const index = this.draft?.workspaces.findIndex((ws) => ws.name === name) ?? -1;
    if (index < 0) return false;
    this.turnTo("workspace", index);
    this.open = picker ?? null;
    return true;
  }

  /**
   * Turns to a page, closing any dropdown and filter editor, and scrolls it to its top.
   * @param {string} page One of ACCOUNT_PAGES' keys, or "workspace".
   * @param {number} [index] The workspace's index, for "workspace".
   * @returns {void}
   */
  turnTo(page, index = this.wsIndex) {
    this.page = page;
    this.wsIndex = index;
    this.open = null;
    this.removeArmed = false;
    this.scrollTop = true;
    this.inputs.filter.set_value("");
    if (this.draft) this.syncInputs();
  }

  /**
   * Shows one of the You pages.
   * @param {string} page One of ACCOUNT_PAGES' keys.
   * @param {object} cx The context, to redraw.
   * @returns {void}
   */
  showPage(page, cx) {
    this.turnTo(page);
    cx.notify();
  }

  /** The workspace shown, or null on a You page. */
  workspace() {
    return this.page === "workspace" ? (this.draft?.workspaces[this.wsIndex] ?? null) : null;
  }

  /** Puts the draft's values in the text fields. */
  syncInputs() {
    const ws = this.workspace();
    for (const [key, field] of Object.entries(FIELDS)) {
      if (field.scope === "account") this.inputs[key].set_value(field.get(this.draft.account) ?? "");
      if (field.scope === "workspace") this.inputs[key].set_value(ws ? (field.get(ws) ?? "") : "");
      if (field.scope === "files") this.inputs[key].set_value(field.get(this.draft.files) ?? "");
    }
  }

  /** Copies one text field into the draft. */
  fromInput(key) {
    const field = FIELDS[key];
    if (!this.draft || field.scope === "ui") return;
    const value = this.inputs[key].value();
    if (field.scope === "account") field.set(this.draft.account, value);
    if (field.scope === "files") field.set(this.draft.files, value);
    const ws = this.workspace();
    if (field.scope === "workspace" && ws) field.set(ws, value);
  }

  /**
   * Shows a workspace's page.
   * @param {number} index The workspace's index in the draft.
   * @param {object} cx The context, to redraw.
   * @returns {void}
   */
  selectWorkspace(index, cx) {
    this.turnTo("workspace", index);
    cx.notify();
  }

  /**
   * Adds an empty workspace and shows its page, with one of its dropdowns open when `picker`
   * names one.
   * @param {object} cx The context, to redraw.
   * @param {{ picker?: string }} [options] The dropdown to open, such as "ws-repo".
   * @returns {void}
   */
  addWorkspace(cx, { picker } = {}) {
    if (!this.draft) return;
    this.draft.workspaces.push(normalizeWorkspace({ name: `Workspace ${this.draft.workspaces.length + 1}` }));
    this.selectWorkspace(this.draft.workspaces.length - 1, cx);
    this.open = picker ?? null;
  }

  /**
   * Removes the workspace shown, on the second click, then shows the one before it, or the
   * GitHub page when none is left.
   * @param {object} cx The context, to redraw.
   * @returns {void}
   */
  removeWorkspace(cx) {
    if (!this.removeArmed) {
      this.removeArmed = true;
      cx.notify();
      return;
    }
    this.draft.workspaces.splice(this.wsIndex, 1);
    if (this.draft.workspaces.length) this.selectWorkspace(Math.max(0, this.wsIndex - 1), cx);
    else this.showPage("github", cx);
  }

  /**
   * Starts the reads the form shows that have not run yet: your repositories and boards, your
   * clones, the shown workspace's repository details and board fields. Safe to call on every draw.
   */
  ensureLoaded(cx) {
    if (this.demo) return;
    if (!this.discovery && !this.discovering && !this.discoverError) this.rediscover(cx);
    const ws = this.workspace();
    if (ws?.repo && !this.details[ws.repo]) {
      const repo = ws.repo;
      this.details[repo] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          this.details[repo] = await repoDetails(repo);
        } catch (error) {
          this.details[repo] = { error: String(error?.message ?? error), boards: [], workflows: [] };
        }
        cx.notify();
      });
    }
    if (ws?.board && !this.fields[boardKey(ws.board)]) {
      const key = boardKey(ws.board);
      const { owner, number } = ws.board;
      this.fields[key] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          this.fields[key] = await boardFields(owner, number);
          this.fitBoard(key);
        } catch (error) {
          this.fields[key] = { error: String(error?.message ?? error) };
        }
        cx.notify();
      });
    }
  }

  /** Reads your repositories, boards and clones again. */
  rediscover(cx) {
    if (this.demo) return this.useDemo(this.demo, cx);
    this.discovering = true;
    this.discoverError = null;
    this.details = {};
    this.fields = {};
    cx.spawn(async (cx) => {
      const [discovery, clones] = await Promise.all([
        discover().catch((error) => {
          this.discoverError = String(error?.message ?? error);
          return null;
        }),
        findClones().catch(() => ({})),
      ]);
      this.discovery = discovery;
      this.clones = clones;
      this.discovering = false;
      cx.notify();
    });
  }

  /**
   * Fits the workspaces on a board to its fields once they are read: a status or iteration
   * field that is not on the board is replaced, and a board just picked takes its statuses.
   */
  fitBoard(key) {
    const fields = this.fields[key];
    for (const ws of this.draft?.workspaces ?? []) {
      if (!ws.board || boardKey(ws.board) !== key) continue;
      ws.board.title = fields.title;
      const selects = fields.selects.map((field) => field.name);
      if (!selects.includes(ws.board.statusField)) {
        ws.board.statusField = selects.includes("Status") ? "Status" : (selects[0] ?? "Status");
      }
      if (!fields.iterations.includes(ws.board.iterationField)) ws.board.iterationField = fields.iterations[0] ?? "";
      if (this.guessFor === key) this.useBoardStatuses(ws);
    }
    if (this.guessFor === key) this.guessFor = null;
  }

  /** The status options of a workspace's board, once read; null before. */
  boardStatuses(ws) {
    const fields = ws.board ? this.fields[boardKey(ws.board)] : null;
    return fields?.selects?.find((field) => field.name === ws.board.statusField)?.options ?? null;
  }

  /**
   * Takes the board's statuses, in board order. Roles already set keep where the names still
   * exist; a workspace with none of them gets them guessed from the names.
   */
  useBoardStatuses(ws) {
    const options = this.boardStatuses(ws);
    if (!options) return;
    const kept = (values) => values.filter((value) => options.includes(value));
    const guess = guessRoles(options);
    const known = kept(ws.notStarted).length || kept(ws.inFlight.statuses).length;
    ws.statuses = [...options];
    ws.notStarted = known ? kept(ws.notStarted) : guess.notStarted;
    ws.inFlight.statuses = known ? kept(ws.inFlight.statuses) : guess.inFlight;
    ws.mineHidden = known ? kept(ws.mineHidden) : guess.mineHidden;
    if (!options.includes(ws.spotlight.holdStatus)) ws.spotlight.holdStatus = guess.holdStatus;
  }

  /** Sets a status's role: "not-started", "in-flight" or "other". */
  setRole(ws, status, role) {
    const ordered = (values) => ws.statuses.filter((value) => values.includes(value));
    const notStarted = ws.notStarted.filter((value) => value !== status);
    const inFlight = ws.inFlight.statuses.filter((value) => value !== status);
    if (role === "not-started") notStarted.push(status);
    if (role === "in-flight") inFlight.push(status);
    ws.notStarted = ordered(notStarted);
    ws.inFlight.statuses = ordered(inFlight);
  }

  /**
   * Fills the form's choices from made-up data instead of GitHub and the disk, for the demo. Its
   * Save then writes nothing.
   * @param {{ discovery: object, details: object, fields: object, clones: object }} data From `demoDiscovery()`.
   * @param {object} [cx] The view's context, to redraw.
   */
  useDemo(data, cx) {
    this.demo = data;
    this.discovery = data.discovery;
    this.details = { ...data.details };
    this.fields = { ...data.fields };
    this.clones = data.clones;
    this.discovering = false;
    this.discoverError = null;
    cx?.notify();
  }

  /** Writes the draft to the file. */
  save(cx) {
    if (this.demo) {
      this.message = { text: "Demo settings: nothing is saved.", error: false };
      cx.notify();
      return;
    }
    const missing = this.draft.workspaces.find((ws) => !ws.repo && !ws.board);
    if (missing) {
      this.message = { text: `"${missing.name || "A workspace"}" needs a repository or a board.`, error: true };
      cx.notify();
      return;
    }
    this.saving = true;
    this.message = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const settings = normalizeConfig(this.draft);
        const text = await saveSettings(settings, this.snapshot);
        this.load(settings, text);
        this.message = { text: "Saved.", error: false };
        this.onSaved(cx);
      } catch (error) {
        this.message = { text: String(error?.message ?? error), error: true };
      }
      this.saving = false;
      cx.notify();
    });
  }

  // --- card filters ----------------------------------------------------------------------------

  /**
   * Every card's filter, as Card filters lists them: the Daypack's three, then each workspace's
   * Open bugs and Triage bugs (with a repository) and Open PRs (with a repository and no board,
   * where the Overview lists them). Each row reads the draft.
   * @returns {{ id: string, key: string, workspace: string | null, group: string, groupKey: string,
   *   label: string, value: string, saved: string, fallback: string, path: (string | number)[] }[]}
   *   `workspace` is the workspace's name (null for the Daypack's), `saved` the file's value,
   *   `fallback` the default and `path` where the settings keep it.
   */
  filterRows() {
    if (!this.draft) return [];
    const file = this.saved ? JSON.parse(this.saved) : { account: { queries: {} }, workspaces: [] };
    const account = this.draft.account;
    const rows = [
      ["review", "Waiting for your review"],
      ["myPrs", "Your open PRs"],
      ["mine", "Your issues"],
    ].map(([key, label]) => ({
      id: `stf-${key}`,
      key,
      workspace: null,
      group: "Daypack",
      groupKey: "daypack",
      label,
      value: account.queries[key] ?? DEFAULT_QUERIES[key],
      saved: file.account?.queries?.[key] ?? DEFAULT_QUERIES[key],
      fallback: DEFAULT_QUERIES[key],
      path: ["account", "queries", key],
    }));
    this.draft.workspaces.forEach((ws, index) => {
      if (!ws.repo) return;
      const before = file.workspaces?.[index];
      const row = (key, label, value, saved, path) => ({
        id: `stf-ws${index}-${key}`,
        key,
        workspace: ws.name,
        group: ws.name || "Unnamed",
        groupKey: `ws${index}`,
        label,
        value,
        saved: saved ?? WORKSPACE_QUERY_DEFAULTS[key],
        fallback: WORKSPACE_QUERY_DEFAULTS[key],
        path: ["workspaces", index, ...path],
      });
      rows.push(row("bugs", "Open bugs", ws.bugs.query, before?.bugs?.query, ["bugs", "query"]));
      rows.push(row("triage", "Triage bugs", ws.queries.triage, before?.queries?.triage, ["queries", "triage"]));
      if (!ws.board) {
        rows.push(row("prs", "Open PRs", ws.queries.prs, before?.queries?.prs, ["queries", "prs"]));
      }
    });
    return rows;
  }

  /**
   * Takes a filter the filter dialog saved from one row: the row's value in the draft and, when
   * it was written (or in the demo), in the saved settings and the file's text too, so the Save
   * bar doesn't count it as unsaved. The rest of the draft stays as it was.
   * @param {string} id The row's id, from `filterRows()`.
   * @param {string} value The search saved.
   * @param {string | null} written The file's text after the write, or null when nothing was written.
   * @returns {void}
   */
  filterSaved(id, value, written) {
    const row = this.filterRows().find((entry) => entry.id === id);
    if (!row) return;
    setPath(this.draft, row.path, value);
    if (written === null && !this.demo) return;
    const saved = JSON.parse(this.saved);
    setPath(saved, row.path, value);
    this.saved = JSON.stringify(saved);
    if (written !== null) this.snapshot = written;
  }

  /** Toggles a picker open or shut, clearing its filter. */
  togglePicker(key, cx) {
    this.open = this.open === key ? null : key;
    this.inputs.filter.set_value("");
    cx.notify();
  }

  // --- drawing ---------------------------------------------------------------------------------

  /**
   * Settings under the header: the side list, the page shown (in a scroll area tracked by
   * `options.scroll`), and the save bar fixed at the bottom. Before the settings are read, one
   * note instead.
   * @param {object} cx The view's context, for starting reads.
   * @param {{ configError: string | null, onRevert(cx: object): void, onReset(cx: object): void,
   *   scroll: object }} options `scroll` is the page's ScrollHandle.
   * @returns {object} The element, filling the room it is given.
   */
  view(cx, options) {
    const t = theme();
    if (!this.draft) {
      return v_flex()
        .p(18)
        .gap(10)
        .child(Note(options.configError ?? "Loading the settings…", options.configError ? t.blocked : t.dim))
        .when(Boolean(options.configError), (el) =>
          el.child(
            h_flex().child(
              TextButton("st-reset", "Start from the defaults", (cx) => options.onReset(cx), {
                tooltip: "Edit fresh settings; Save keeps the broken file as alpmeister.json.bak",
              }),
            ),
          ),
        );
    }
    this.ensureLoaded(cx);
    return h_flex()
      .flex_1()
      .min_h(0)
      .w_full()
      .items_start()
      .child(this.sideList(t))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .h_full()
          .child(
            v_flex()
              .id("st-page")
              .flex_1()
              .min_h(0)
              .w_full()
              .overflow_y_scrollbar()
              .track_scroll(options.scroll)
              .p(18)
              .gap(14)
              .children(this.pageParts(t)),
          )
          .child(this.saveBar(t, options)),
      );
  }

  /**
   * One entry of the side list.
   * @param {object} t The theme.
   * @param {string} id A unique element id.
   * @param {string} label The page's name.
   * @param {boolean} current Whether it is the page shown.
   * @param {(cx: object) => void} onClick Shows the page.
   * @param {{ accent?: boolean }} [options] `accent` draws an action, such as "+ Add workspace".
   * @returns {object} The entry.
   */
  navItem(t, id, label, current, onClick, { accent = false } = {}) {
    return h_flex()
      .id(id)
      .w_full()
      .flex_none()
      .h(28)
      .px(10)
      .items_center()
      .rounded(7)
      .text_size(12)
      .bg(current ? t.selected : t.canvas)
      .text_color(current ? t.foreground : accent ? t.accent : t.muted)
      .cursor_pointer()
      .hover((style) => style.bg(current ? t.selected : t.hover).text_color(accent ? t.accent : t.foreground))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .child(div().min_w(0).truncate().child(label));
  }

  /**
   * The side list: You (GitHub, Local folders, Claude buttons, Card filters, Files), then each workspace
   * and "+ Add workspace"; at its foot, Reload choices.
   * @param {object} t The theme.
   * @returns {object} The list.
   */
  sideList(t) {
    const group = (text) => div().px(10).pt(12).pb(4).text_size(11.5).font_semibold().text_color(t.dim).child(text);
    return v_flex()
      .id("st-side")
      .flex_none()
      .w(184)
      .h_full()
      .p(8)
      .gap(2)
      .border_r_1()
      .border_color(t.border)
      .overflow_y_scrollbar()
      .child(group("You"))
      .children(
        ACCOUNT_PAGES.map((page) =>
          this.navItem(t, `st-nav-${page.key}`, page.label, this.page === page.key, (cx) => this.showPage(page.key, cx)),
        ),
      )
      .child(group("Workspaces"))
      .children(
        this.draft.workspaces.map((ws, index) =>
          this.navItem(t, `st-nav-ws-${index}`, ws.name || "Unnamed", this.page === "workspace" && index === this.wsIndex, (cx) =>
            this.selectWorkspace(index, cx),
          ),
        ),
      )
      .child(this.navItem(t, "st-ws-add", "+ Add workspace", false, (cx) => this.addWorkspace(cx), { accent: true }))
      .child(div().flex_1().min_h(16))
      .when(this.discovering, (el) => el.child(div().px(10).child(Note("Reading GitHub…"))))
      .child(
        h_flex()
          .px(4)
          .child(
            TextButton("st-rediscover", "Reload choices", (cx) => this.rediscover(cx), {
              tooltip: "Read your repositories, boards and local clones again",
            }),
          ),
      );
  }

  /**
   * The page shown, as the scroll area's children: its title first.
   * @param {object} t The theme.
   * @returns {object[]} The page's parts.
   */
  pageParts(t) {
    const ws = this.workspace();
    if (ws) return this.workspacePage(t, ws);
    if (this.page === "folders") return [this.pageTitle(t, "Local folders"), this.foldersSection(t)];
    if (this.page === "claude") return [this.pageTitle(t, "Claude buttons"), this.claudeSection(t)];
    if (this.page === "filters") return [this.pageTitle(t, "Card filters"), this.filtersSection(t)];
    if (this.page === "files") return [this.pageTitle(t, "Files"), this.filesSection(t)];
    return [
      this.pageTitle(t, "Your GitHub", [Chip(this.discovery ? `signed in as ${this.discovery.login}` : "gh", { color: t.dim })]),
      this.githubSection(t),
    ];
  }

  /**
   * A page's title, with chips after it.
   * @param {object} t The theme.
   * @param {string} text The title.
   * @param {object[]} [extras] Chips after it.
   * @returns {object} The title row.
   */
  pageTitle(t, text, extras = []) {
    return h_flex()
      .gap(10)
      .items_center()
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child(text))
      .children(extras);
  }

  /**
   * The save bar, fixed under the page: "2 unsaved changes" in orange (the file's path while
   * nothing is unsaved), the last message, then Revert and Save.
   * @param {object} t The theme.
   * @param {{ onRevert: Function }} options What Revert calls.
   * @returns {object} The bar.
   */
  saveBar(t, options) {
    const changes = this.changeCount();
    const idle = this.demo ? "Demo settings: Save writes nothing" : "~/.config/alp/alpmeister.json";
    return h_flex()
      .flex_none()
      .w_full()
      .h(46)
      .px(16)
      .gap(10)
      .items_center()
      .border_t_1()
      .border_color(t.border)
      .bg(t.background)
      .child(
        div()
          .flex_none()
          .text_size(12)
          .text_color(changes ? warningColor(t) : t.dim)
          .child(changes ? `${counted(changes, "unsaved change")}` : idle),
      )
      .when(Boolean(this.message), (el) =>
        el.child(div().min_w(0).truncate().child(Note(this.message.text, this.message.error ? t.blocked : t.done))),
      )
      .child(div().flex_1())
      .when(changes > 0, (el) =>
        el.child(TextButton("st-revert", "Revert", (cx) => options.onRevert(cx), { tooltip: "Drop the unsaved changes" })),
      )
      .child(this.primaryButton(t, "st-save", this.saving ? "Saving…" : "Save", changes > 0 && !this.saving, (cx) => this.save(cx)));
  }

  /** A filled button, dimmed while `enabled` is false. */
  primaryButton(t, id, label, enabled, onClick) {
    return h_flex()
      .id(id)
      .flex_none()
      .px(14)
      .h(28)
      .items_center()
      .rounded(6)
      .text_size(12)
      .font_semibold()
      .bg(enabled ? t.accent : t.hover)
      .text_color(enabled ? (t.accent_foreground ?? t.background) : t.dim)
      .when(enabled, (el) =>
        el.cursor_pointer().on_click((_event, cx) => {
          cx.stop_propagation();
          onClick(cx);
        }),
      )
      .child(label);
  }

  /**
   * A labelled row of the form: the label on the left, the control filling the rest.
   * @param {object} t The theme.
   * @param {string} label The label.
   * @param {object} control The control.
   * @param {string} [hint] A line under the control.
   * @returns {object} The row.
   */
  field(t, label, control, hint) {
    return h_flex()
      .w_full()
      .min_w(0)
      .gap(12)
      .items_start()
      .child(div().flex_none().w(150).pt(5).text_size(11.5).text_color(t.muted).child(label))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(4)
          .child(control)
          .when(Boolean(hint), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(hint))),
      );
  }

  /** A text field. */
  text(t, key) {
    return Input.new(this.inputs[key])
      .h(28)
      .px(8)
      .rounded(6)
      .border_1()
      .border_color(t.input)
      .bg(t.background)
      .text_size(12)
      .text_color(t.foreground);
  }

  /**
   * A section heading inside a card, in sentence case.
   * @param {object} t The theme.
   * @param {string} text The heading, as written.
   * @returns {object} The heading.
   */
  heading(t, text) {
    return div().pt(8).text_size(11.5).font_semibold().text_color(t.dim).child(text);
  }

  /**
   * A row of pills, one of them picked. `options`: `[{ value, label, tooltip? }]`.
   * @param {object} t The theme.
   * @param {string} id A unique element id prefix.
   * @param {object[]} options The pills.
   * @param {string} current The picked value.
   * @param {Function} onPick Called with the new value.
   * @returns {object} The row.
   */
  pills(t, id, options, current, onPick) {
    return h_flex()
      .flex_wrap()
      .gap(4)
      .children(
        options.map((option, index) => {
          const picked = option.value === current;
          const pill = h_flex()
            .id(`${id}-${index}`)
            .px(8)
            .h(22)
            .items_center()
            .rounded(6)
            .border_1()
            .border_color(picked ? t.accent : t.border)
            .bg(picked ? t.selected : t.background)
            .text_size(11.5)
            .text_color(picked ? t.foreground : t.dim)
            .cursor_pointer()
            .hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              onPick(option.value, cx);
            })
            .child(option.label);
          return option.tooltip ? pill.tooltip(option.tooltip) : pill;
        }),
      );
  }

  /** A 14px checkbox. */
  check(t, id, checked, onToggle, { disabled = false, tooltip } = {}) {
    const box = h_flex()
      .id(id)
      .flex_none()
      .size(14)
      .items_center()
      .justify_center()
      .rounded(4)
      .border_1()
      .border_color(checked ? t.accent : t.input)
      .bg(checked ? t.accent : t.background)
      .when(!disabled, (el) =>
        el.cursor_pointer().on_click((_event, cx) => {
          cx.stop_propagation();
          onToggle(cx);
        }),
      )
      .when(checked, (el) => el.child(div().text_size(10).text_color(t.background).child("✓")));
    return tooltip ? box.tooltip(tooltip) : box;
  }

  /**
   * A dropdown's open list. It never scrolls on its own, so it cannot fight the page's scroll:
   * it shows the first PICKER_ROWS matches of the filter, and says how many more there are.
   * @param {object} t The theme.
   * @param {string} key The dropdown's key, for row ids.
   * @param {{ value: any, label: string, sub?: string }[]} options Every option.
   * @param {(option: object, index: number) => object} row Draws one option's row.
   * @param {object[]} [footer] Elements under the rows, such as a Done button.
   * @returns {object}
   */
  optionList(t, key, options, row, footer = []) {
    const filter = this.inputs.filter.value().trim().toLowerCase();
    const matching = options.filter(
      (option) => !filter || `${option.label} ${option.sub ?? ""}`.toLowerCase().includes(filter),
    );
    const more = matching.length - PICKER_ROWS;
    return v_flex()
      .id(`pk-list-${key}`)
      .w_full()
      .p(4)
      .gap(2)
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .when(options.length > PICKER_ROWS, (el) => el.child(this.text(t, "filter")))
      .when(!matching.length, (el) => el.child(div().px(6).py(4).child(Note("Nothing matches."))))
      .children(matching.slice(0, PICKER_ROWS).map(row))
      .when(more > 0, (el) => el.child(div().px(6).py(4).child(Note(`${more} more: type to narrow the list.`))))
      .when(footer.length > 0, (el) => el.child(h_flex().pt(2).gap(6).children(footer)));
  }

  /**
   * One option row in a dropdown's list: an optional lead (a checkbox), the label, its note.
   * @param {object} t The theme.
   * @param {string} id A unique element id.
   * @param {object} option The option: its label, and an optional note in `sub`.
   * @param {{ lead?: object, accent?: boolean, onClick: Function }} row Its lead, whether it is in the accent color, and what a click does.
   * @returns {object} The row.
   */
  optionRow(t, id, option, { lead, accent = false, onClick }) {
    return h_flex()
      .id(id)
      .w_full()
      .flex_none()
      .h(26)
      .px(6)
      .gap(8)
      .items_center()
      .rounded(5)
      .text_size(12)
      .cursor_pointer()
      .text_color(accent ? t.accent : t.foreground)
      .hover((style) => style.bg(t.hover))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onClick(cx);
      })
      .when(Boolean(lead), (el) => el.child(lead))
      .child(div().flex_1().min_w(0).truncate().child(option.label))
      .when(Boolean(option.sub), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(option.sub)));
  }

  /** A dropdown's trigger: the shown text and an arrow, accented while open. */
  trigger(t, key, text, { dim = false, width } = {}) {
    const open = this.open === key;
    return h_flex()
      .id(`pk-${key}`)
      .when(!width, (el) => el.w_full())
      .when(Boolean(width), (el) => el.w(width))
      .h(28)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(open ? t.accent : t.input)
      .bg(t.background)
      .cursor_pointer()
      .on_click((_event, cx) => this.togglePicker(key, cx))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(dim ? t.dim : t.foreground).child(text))
      .child(div().text_size(10).text_color(t.dim).child(open ? "▲" : "▼"));
  }

  /**
   * A dropdown: the current choice, and under it the options while open, with a filter when
   * there are many. `options`: `[{ value, label, sub? }]`; a null value is "none".
   */
  picker(t, key, current, options, onPick, { placeholder = "Choose…" } = {}) {
    const chosen = options.find((option) => JSON.stringify(option.value) === JSON.stringify(current));
    const label = chosen ? `${chosen.label}${chosen.sub ? `  ·  ${chosen.sub}` : ""}` : placeholder;
    return v_flex()
      .w_full()
      .gap(4)
      .child(this.trigger(t, key, label, { dim: !chosen }))
      .when(this.open === key, (el) =>
        el.child(
          this.optionList(t, key, options, (option, index) =>
            this.optionRow(t, `pk-${key}-${index}`, option, {
              accent: option === chosen,
              onClick: (cx) => {
                this.open = null;
                onPick(option.value, cx);
                cx.notify();
              },
            }),
          ),
        ),
      );
  }

  /**
   * A dropdown with a checkbox per option. It stays open while you tick, until Done.
   * @param {object} t The theme.
   * @param {string} key The dropdown's key.
   * @param {string} label The trigger's text.
   * @param {{ value: string, label: string, sub?: string }[]} options Every option.
   * @param {(value: string) => boolean} isChecked Whether an option is ticked.
   * @param {(value: string, cx: object) => void} onToggle Ticks or unticks one.
   * @returns {object}
   */
  multiPicker(t, key, label, options, isChecked, onToggle) {
    return v_flex()
      .w_full()
      .gap(4)
      .child(this.trigger(t, key, label, { dim: true, width: 220 }))
      .when(this.open === key, (el) =>
        el.child(
          this.optionList(
            t,
            key,
            options,
            (option, index) =>
              this.optionRow(t, `pk-${key}-${index}`, option, {
                lead: this.check(t, `pk-${key}-check-${index}`, isChecked(option.value), (cx) => {
                  onToggle(option.value, cx);
                  cx.notify();
                }),
                onClick: (cx) => {
                  onToggle(option.value, cx);
                  cx.notify();
                },
              }),
            [TextButton(`pk-${key}-done`, "Done", (cx) => this.togglePicker(key, cx))],
          ),
        ),
      );
  }

  /** A chip with a × that removes it. */
  removableChip(t, id, label, onRemove, tooltip) {
    const chip = h_flex()
      .id(id)
      .flex_none()
      .h(22)
      .pl(8)
      .pr(2)
      .gap(2)
      .items_center()
      .rounded(6)
      .bg(t.hover)
      .text_size(11.5)
      .text_color(t.foreground)
      .child(label)
      .child(
        h_flex()
          .id(`${id}-x`)
          .size(18)
          .items_center()
          .justify_center()
          .rounded(4)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((style) => style.bg(t.selected).text_color(t.foreground))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            onRemove(cx);
            cx.notify();
          })
          .child("×"),
      );
    return tooltip ? chip.tooltip(tooltip) : chip;
  }

  // --- account ---------------------------------------------------------------------------------

  /** Your repositories as the form lists them: discovered ones, then any named only in the settings. */
  knownRepos() {
    const found = this.discovery?.repos ?? [];
    const names = new Set(found.map((repo) => repo.repo));
    const account = this.draft.account;
    const extra = [...(Array.isArray(account.repos) ? account.repos : []), ...account.exclude, ...Object.keys(account.folders)]
      .filter((repo) => !names.has(repo));
    return [...found, ...[...new Set(extra)].map((repo) => ({ repo, isArchived: false, isPrivate: false, isFork: false }))];
  }

  /** A repository as a dropdown option: its name, and what sets it apart. */
  repoOption(repo) {
    const notes = [repo.isPrivate && "private", repo.isFork && "fork", repo.isArchived && "archived"].filter(Boolean);
    return { value: repo.repo, label: repo.repo, sub: notes.join(", ") };
  }

  /** Puts a repository in or out of scope. */
  toggleScope(name) {
    const account = this.draft.account;
    const flip = (list) => (list.includes(name) ? list.filter((value) => value !== name) : [...list, name]);
    if (Array.isArray(account.repos)) account.repos = flip(account.repos);
    else account.exclude = flip(account.exclude);
  }

  /** Switches between every repository and only the picked ones, keeping what is in scope now. */
  setScopeMode(mode) {
    const account = this.draft.account;
    if (mode === "picked" && !Array.isArray(account.repos)) {
      account.repos = this.knownRepos()
        .filter((repo) => inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived }))
        .map((repo) => repo.repo);
    }
    if (mode === "all" && Array.isArray(account.repos)) {
      const picked = new Set(account.repos);
      account.repos = "all";
      account.exclude = this.knownRepos()
        .filter((repo) => !picked.has(repo.repo) && (account.archived || !repo.isArchived))
        .map((repo) => repo.repo);
    }
  }

  /**
   * The repositories in scope, as chips with a remove ×, and the dropdown that adds them. With
   * all your repositories in scope, the chips are the ones left out instead.
   * @param {object} t The theme.
   * @returns {object} The chips and the dropdown.
   */
  scopeChips(t) {
    const account = this.draft.account;
    const picked = Array.isArray(account.repos);
    const repos = this.knownRepos();
    const eligible = repos.filter((repo) => picked || account.archived || !repo.isArchived);
    const options = [
      ...eligible.filter((repo) => !repo.isArchived),
      ...eligible.filter((repo) => repo.isArchived),
    ].map((repo) => this.repoOption(repo));
    const chosen = picked ? account.repos : account.exclude;
    const chips = chosen.map((name) =>
      this.removableChip(
        t,
        `st-chip-${name}`,
        name,
        () => this.toggleScope(name),
        picked ? "Leave it out" : "Put it back in scope",
      ),
    );
    return v_flex()
      .gap(8)
      .when(!picked && chosen.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Left out")))
      .when(chips.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).children(chips)))
      .when(picked && !chips.length, (el) => el.child(Note("No repositories picked yet.")))
      .child(
        this.multiPicker(
          t,
          "scope",
          picked ? "Add repos…" : "Leave repos out…",
          options,
          (name) => chosen.includes(name),
          (name) => this.toggleScope(name),
        ),
      );
  }

  /** Clones found on disk for repositories with no folder set. */
  suggestedFolders() {
    const folders = this.draft.account.folders;
    return Object.entries(this.clones ?? {}).filter(([repo]) => !folders[repo]);
  }

  /** Lets you pick a repository's folder with the system folder picker. */
  chooseFolder(repo, cx) {
    cx.spawn(async (cx) => {
      const chosen = await pickFolder({ prompt: "Use this folder" });
      if (chosen) {
        this.draft.account.folders[repo] = tildePath(chosen);
        cx.notify();
      }
    });
  }

  /** One repository and its folder, or a clone found for it, with what can be done about it. */
  folderRow(t, repo, folder, found) {
    const account = this.draft.account;
    return h_flex()
      .id(`st-folder-row-${repo}`)
      .w_full()
      .h(28)
      .px(6)
      .gap(10)
      .items_center()
      .rounded(6)
      .hover((style) => style.bg(t.hover))
      .child(div().w(260).flex_none().truncate().text_size(12).text_color(t.foreground).child(repo))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(11.5)
          .text_color(folder ? t.muted : t.dim)
          .child(folder ?? `found ${found}`),
      )
      .when(Boolean(found), (el) =>
        el.child(
          TextButton(`st-use-${repo}`, "Use", (cx) => {
            account.folders[repo] = found;
            cx.notify();
          }, { tooltip: "A local clone of this repository" }),
        ),
      )
      .when(Boolean(folder), (el) =>
        el
          .child(TextButton(`st-change-${repo}`, "Change", (cx) => this.chooseFolder(repo, cx)))
          .child(
            TextButton(`st-forget-${repo}`, "×", (cx) => {
              delete account.folders[repo];
              cx.notify();
            }, { tooltip: "Forget this folder" }),
          ),
      );
  }

  /** Each repository's local clone: the ones set, clones found for others, and a dropdown to set one. */
  foldersSection(t) {
    const account = this.draft.account;
    const set = Object.entries(account.folders).sort(([first], [second]) => first.localeCompare(second));
    const suggestions = this.suggestedFolders();
    const without = this.knownRepos()
      .filter((repo) => !account.folders[repo.repo] && !repo.isArchived)
      .map((repo) => this.repoOption(repo));
    return v_flex()
      .gap(6)
      .child(Note("Where each repository's Claude buttons open their tab. Without one, the tab opens in the space's folder."))
      .children(set.map(([repo, folder]) => this.folderRow(t, repo, folder, null)))
      .children(suggestions.map(([repo, found]) => this.folderRow(t, repo, null, found)))
      .when(suggestions.length > 1, (el) =>
        el.child(
          h_flex().child(
            TextButton("st-use-all", `Use all ${suggestions.length} found`, (cx) => {
              for (const [repo, folder] of suggestions) account.folders[repo] = folder;
              cx.notify();
            }),
          ),
        ),
      )
      .child(
        div()
          .w(320)
          .child(
            this.picker(t, "folder-for", null, without, (repo, cx) => this.chooseFolder(repo, cx), {
              placeholder: "Set a folder for…",
            }),
          ),
      );
  }

  /**
   * The GitHub page: what reading GitHub said, and the repositories in scope.
   * @param {object} t The theme.
   * @returns {object} The page's body.
   */
  githubSection(t) {
    const account = this.draft.account;
    const picked = Array.isArray(account.repos);
    const scopedCount = this.knownRepos().filter((repo) =>
      inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived }),
    ).length;
    return v_flex()
      .gap(10)
      .when(Boolean(this.discoverError), (el) => el.child(Note(`GitHub: ${this.discoverError}`, t.blocked)))
      .when(Boolean(this.discovery?.warning), (el) => el.child(Note(this.discovery.warning, warningColor(t))))
      .when(this.discovering && !this.discovery, (el) => el.child(Note("Reading your repositories…")))
      .child(
        this.field(
          t,
          "Repos in scope",
          v_flex()
            .gap(8)
            .child(
              h_flex()
                .gap(10)
                .items_center()
                .child(
                  this.pills(
                    t,
                    "st-scope-mode",
                    [
                      {
                        value: "all",
                        label: "All my repos",
                        tooltip:
                          "Every repository you own, collaborate on or reach through an organization; new ones join on their own",
                      },
                      { value: "picked", label: "Only the ones I pick", tooltip: "Just the repositories you add" },
                    ],
                    picked ? "picked" : "all",
                    (mode, cx) => {
                      this.setScopeMode(mode);
                      cx.notify();
                    },
                  ),
                )
                .when(!picked, (el) =>
                  el.child(
                    Toggle("st-archived", "Include archived", account.archived, (cx) => {
                      account.archived = !account.archived;
                      cx.notify();
                    }),
                  ),
                )
                .child(div().flex_1())
                .child(Chip(`${scopedCount} in scope`, { color: t.muted })),
            )
            .child(this.scopeChips(t)),
          "The Overview's All repos view and the Daypack lists cover these.",
        ),
      );
  }

  /**
   * The Claude buttons page: the prompt typed on an issue and on a PR.
   * @param {object} t The theme.
   * @returns {object} The page's body.
   */
  claudeSection(t) {
    const account = this.draft.account;
    return v_flex()
      .gap(10)
      .child(
        this.field(
          t,
          "On an issue",
          this.text(t, "issuePrompt"),
          "Typed into a new Claude tab. {repo} and {number} are filled in; a /command works too.",
        ),
      )
      .child(this.field(t, "On a PR", this.text(t, "prPrompt")))
      .child(
        h_flex().child(
          TextButton("st-default-prompts", "Use the default prompts", (cx) => {
            account.launch.issue = DEFAULT_ISSUE_PROMPT;
            account.launch.pr = DEFAULT_PR_PROMPT;
            this.inputs.issuePrompt.set_value(DEFAULT_ISSUE_PROMPT);
            this.inputs.prPrompt.set_value(DEFAULT_PR_PROMPT);
            cx.notify();
          }),
        ),
      );
  }

  /**
   * The Files page: the Files editor's auto save (Off, After a delay, When you leave the file,
   * as VS Code's auto save) and its delay. alp-files reads them when the settings are saved.
   * @param {object} t The theme.
   * @returns {object} The page's body.
   */
  filesSection(t) {
    const files = this.draft.files;
    /**
     * A step button of the delay field.
     * @param {string} glyph Its text.
     * @returns {object} Its look, replayed onto the field's own button.
     */
    const step = (glyph) =>
      div()
        .w(24)
        .h_full()
        .flex()
        .items_center()
        .justify_center()
        .text_size(13)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover).text_color(t.foreground))
        .child(glyph);
    const delay = h_flex()
      .gap(8)
      .items_center()
      .child(
        NumberInput.new(this.inputs.autoSaveDelay)
          .w(140)
          .h(28)
          .rounded(6)
          .border_1()
          .border_color(t.input)
          .bg(t.background)
          .text_size(12)
          .text_color(t.foreground)
          .decrement_button(step("−"))
          .increment_button(step("+")),
      )
      .child(div().text_size(12).text_color(t.muted).child("ms"));
    return v_flex()
      .gap(10)
      .child(
        this.field(
          t,
          "Auto save",
          this.pills(t, "st-autosave", AUTO_SAVE_CHOICES, files.autoSave, (value, cx) => {
            files.autoSave = value;
            cx.notify();
          }),
          "Saves your edits in the Files editor. A file that changed on disk is never overwritten: you still choose.",
        ),
      )
      .child(
        this.field(
          t,
          "Delay",
          delay,
          `For After a delay: how long after your last edit, at least ${AUTO_SAVE_DELAY_RANGE.min} ms`,
        ),
      );
  }

  /**
   * The Card filters page: every card's filter in one list, grouped by where the card is, each
   * with its summary, its search and an Edit button that opens the filter dialog, the same one
   * the cards open. The dialog's Save writes that one filter to the file at once, as on the
   * cards; it doesn't wait for the Save bar.
   * @param {object} t The theme.
   * @returns {object} The page's body.
   */
  filtersSection(t) {
    const rows = this.filterRows();
    const groups = [...new Set(rows.map((row) => row.groupKey))];
    const line = (row) => {
      const unsaved = row.value !== row.saved;
      const color = unsaved ? warningColor(t) : row.value === row.fallback ? t.muted : t.accent;
      return h_flex()
        .h(30)
        .gap(12)
        .items_center()
        .child(div().flex_none().w(180).truncate().text_size(12).text_color(t.foreground).child(row.label))
        .child(
          div()
            .flex_none()
            .max_w(280)
            .truncate()
            .text_size(11.5)
            .text_color(color)
            .child(unsaved ? `${summaryWords(row.value)} · not saved yet` : summaryWords(row.value)),
        )
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(row.value || "(empty)"))
        .child(
          TextButton(`${row.id}-edit`, "Edit", (cx) => this.onEditFilter?.(row, cx), {
            tooltip: `Change what ${row.label} shows`,
          }),
        );
    };
    return v_flex()
      .gap(14)
      .child(
        Note(
          "What each card lists, as a GitHub search. The Daypack and Overview cards open the same filter from their corner. " +
            "Its Save writes that filter at once. The workspace cards add their repository; Open PRs adds a sort when it has none.",
        ),
      )
      .children(
        groups.map((key) => {
          const members = rows.filter((row) => row.groupKey === key);
          return v_flex().gap(2).child(this.heading(t, members[0].group)).children(members.map(line));
        }),
      )
      .when(!this.draft.workspaces.some((ws) => ws.repo), (el) =>
        el.child(Note("A workspace with a repository adds its Open bugs, Triage bugs and Open PRs here.")),
      );
  }

  // --- workspaces ------------------------------------------------------------------------------

  /**
   * A section that folds: a header with its title and, folded, a one-line summary of what it is
   * set to; open, its body under the header.
   * @param {object} t The theme.
   * @param {string} key The section's key in `folds`.
   * @param {string} title The section's title.
   * @param {string} summary What it is set to, in a line.
   * @param {() => object} body Draws the body, called only while open.
   * @returns {object} The section.
   */
  fold(t, key, title, summary, body) {
    const open = this.folds.has(key);
    return v_flex()
      .w_full()
      .rounded(9)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .child(
        h_flex()
          .id(`st-fold-${key}`)
          .h(36)
          .px(12)
          .gap(10)
          .items_center()
          .rounded(8)
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            if (open) this.folds.delete(key);
            else this.folds.add(key);
            this.open = null;
            cx.notify();
          })
          .child(div().flex_none().w(10).text_size(11.5).text_color(t.dim).child(open ? "▾" : "▸"))
          .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
          .when(!open, (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(summary))),
      )
      .when(open, (el) => el.child(v_flex().px(12).pt(4).pb(12).gap(10).child(body())));
  }

  /**
   * One workspace's page: its title, name, repository and board, then its sections, folded:
   * Board columns (open at first), Nightly, Bugs and triage, Spotlight and Customer issues, and
   * "Remove this workspace" last.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object[]} The page's parts.
   */
  workspacePage(t, ws) {
    const details = ws.repo ? this.details[ws.repo] : null;
    const parts = [this.pageTitle(t, `Workspace: ${ws.name || "Unnamed"}`), this.workspaceForm(t, ws)];
    if (ws.board) {
      const shown = ws.boardView.statuses.length;
      parts.push(
        this.fold(
          t,
          "board",
          "Board columns",
          shown ? `${shown} of ${counted(ws.statuses.length, "status", "statuses")} on the board` : "every status with an item on the board",
          () => this.boardSection(t, ws),
        ),
      );
    }
    if (ws.repo) {
      const nightly = ws.nightly
        ? `${ws.nightly.workflow} on ${ws.nightly.branch} · ${ws.nightly.checks.length ? counted(ws.nightly.checks.length, "check") : "the run's result"}`
        : "No nightly workflow";
      const priorities = ws.bugs.priorities;
      const bugs = [
        priorities.length ? `${priorities[0]}–${priorities[priorities.length - 1]}` : "No priorities",
        `triage: ${summaryWords(ws.queries.triage)}`,
      ].join(" · ");
      const labels = ws.spotlight.labels.length;
      const spotlight = `next ${counted(ws.spotlight.milestones, "milestone")} · ${labels ? counted(labels, "label") : "no labels"}`;
      const customer = ws.customer.labelMatch ? `labels containing "${ws.customer.labelMatch}"` : "No customer label";
      parts.push(
        this.fold(t, "nightly", "Nightly", nightly, () => this.nightlySection(t, ws, details)),
        this.fold(t, "bugs", "Bugs and triage", bugs, () => this.bugsSection(t, ws)),
        this.fold(t, "spotlight", "Spotlight", spotlight, () => this.spotlightSection(t, ws)),
        this.fold(t, "customer", "Customer issues", customer, () =>
          this.field(t, "Label contains", this.text(t, "customer"), "Open issues with a label that contains this"),
        ),
      );
    }
    parts.push(
      h_flex()
        .pt(6)
        .child(
          h_flex()
            .id("st-ws-remove")
            .h(24)
            .px(6)
            .items_center()
            .rounded(5)
            .text_size(12)
            .text_color(t.blocked)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              this.removeWorkspace(cx);
            })
            .child(this.removeArmed ? "Click again to remove this workspace" : "Remove this workspace"),
        ),
    );
    return parts;
  }

  /** The repository options: active ones first, archived last. */
  repoOptions() {
    const repos = this.knownRepos();
    return [
      { value: null, label: "None", sub: "a board only" },
      ...repos.filter((repo) => !repo.isArchived).map((repo) => ({ value: repo.repo, label: repo.repo, sub: repo.isPrivate ? "private" : "" })),
      ...repos.filter((repo) => repo.isArchived).map((repo) => ({ value: repo.repo, label: repo.repo, sub: "archived" })),
    ];
  }

  /** The board options: those linked to the workspace's repository first, then every other open one. */
  boardOptions(ws) {
    const linked = ws.repo ? (this.details[ws.repo]?.boards ?? []) : [];
    const linkedKeys = new Set(linked.map((board) => board.key));
    const rest = (this.discovery?.boards ?? []).filter((board) => !linkedKeys.has(board.key) && !board.closed);
    const options = [
      { value: null, label: "None", sub: "the repository only" },
      ...linked.map((board) => ({ value: board.key, label: `${board.title}`, sub: `${board.owner} #${board.number} · linked` })),
      ...rest.map((board) => ({ value: board.key, label: `${board.title}`, sub: `${board.owner} #${board.number}` })),
    ];
    if (ws.board && !options.some((option) => option.value === boardKey(ws.board))) {
      options.push({ value: boardKey(ws.board), label: ws.board.title ?? "Board", sub: `${ws.board.owner} #${ws.board.number}` });
    }
    return options;
  }

  /** Points the workspace at a board, or none, by its key. */
  pickBoard(ws, key) {
    if (!key) {
      ws.board = null;
      return;
    }
    const [owner, number] = key.split("#");
    const known = [...(this.details[ws.repo]?.boards ?? []), ...(this.discovery?.boards ?? [])].find((board) => board.key === key);
    ws.board = { owner, number: Number(number), title: known?.title ?? "", statusField: "Status", iterationField: "Iteration" };
    this.guessFor = key;
    if (this.fields[key] && !this.fields[key].loading && !this.fields[key].error) this.fitBoard(key);
  }

  /**
   * A workspace's name, repository and project board.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The fields.
   */
  workspaceForm(t, ws) {
    return v_flex()
      .gap(10)
      .child(this.field(t, "Name", this.text(t, "name")))
      .child(
        this.field(
          t,
          "Repository",
          this.picker(t, "ws-repo", ws.repo, this.repoOptions(), (repo) => {
            const autoName = !ws.name || ws.name === ws.repo?.split("/")[1] || /^Workspace \d+$/.test(ws.name);
            ws.repo = repo;
            if (autoName && repo) {
              ws.name = repo.split("/")[1];
              this.inputs.name.set_value(ws.name);
            }
            if (ws.nightly && !repo) ws.nightly = null;
          }),
          "Milestones, spotlight, bugs, triage, customer issues and nightly come from it.",
        ),
      )
      .child(
        this.field(
          t,
          "Project board",
          this.picker(t, "ws-board", ws.board ? boardKey(ws.board) : null, this.boardOptions(ws), (key) => this.pickBoard(ws, key)),
          ws.repo
            ? "Statuses, iterations and the team in flight come from it. Without one, the Overview lists the open PRs instead."
            : "Statuses, iterations and the team in flight come from it.",
        ),
      );
  }

  /**
   * Board columns: how each status reads and whether the Board shows it, then the board's status
   * and iteration fields and the in-flight and Board tab settings.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The section's body.
   */
  boardSection(t, ws) {
    const fields = this.fields[boardKey(ws.board)];
    const options = this.boardStatuses(ws);
    const differs = options && JSON.stringify(options) !== JSON.stringify(ws.statuses);
    const section = v_flex().gap(10);
    if (!fields || fields.loading) return section.child(Note("Reading the board's fields…"));
    if (fields.error) {
      return section.child(Note(`${fields.error}. The board needs gh's read:project scope: gh auth refresh -s read:project`, t.blocked));
    }
    return section
      .when(Boolean(differs), (el) =>
        el.child(
          h_flex()
            .gap(8)
            .items_center()
            .child(Note("The board's statuses differ from these.", warningColor(t)))
            .child(
              TextButton("st-use-statuses", "Use the board's statuses", (cx) => {
                this.useBoardStatuses(ws);
                cx.notify();
              }),
            ),
        ),
      )
      .child(this.statusTable(t, ws))
      .child(
        h_flex().child(
          TextButton("st-more-status", this.moreStatus ? "Fewer per-status options" : "More per-status options…", (cx) => {
            this.moreStatus = !this.moreStatus;
            cx.notify();
          }),
        ),
      )
      .when(fields.selects.length > 1, (el) =>
        el.child(
          this.field(
            t,
            "Status field",
            this.picker(
              t,
              "ws-status-field",
              ws.board.statusField,
              fields.selects.map((field) => ({ value: field.name, label: field.name, sub: `${field.options.length} options` })),
              (name) => {
                ws.board.statusField = name;
                this.useBoardStatuses(ws);
              },
            ),
          ),
        ),
      )
      .child(
        this.field(
          t,
          "Iteration field",
          this.picker(
            t,
            "ws-iteration-field",
            ws.board.iterationField || null,
            [{ value: null, label: "None", sub: "no iteration filters" }, ...fields.iterations.map((name) => ({ value: name, label: name }))],
            (name) => (ws.board.iterationField = name ?? ""),
          ),
        ),
      )
      .child(this.field(t, "Leave out of in flight", this.text(t, "excludeTypes")))
      .child(this.field(t, "Board tab filter", this.text(t, "boardView")));
  }

  /**
   * One row per status: what it means and whether the Board shows it; with "More per-status
   * options", whether Your issues hides it and which one means on hold.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The table.
   */
  statusTable(t, ws) {
    const role = (status) =>
      ws.notStarted.includes(status) ? "not-started" : ws.inFlight.statuses.includes(status) ? "in-flight" : "other";
    const roles = [
      { value: "not-started", label: "Not started", tooltip: "Flagged on the milestone when the due date is close" },
      { value: "in-flight", label: "In flight", tooltip: "Listed in the team in flight" },
      { value: "other", label: "Other" },
    ];
    return v_flex()
      .gap(2)
      .child(
        h_flex()
          .gap(12)
          .px(6)
          .text_size(11.5)
          .text_color(t.dim)
          .child(div().w(150).child("Status"))
          .child(div().w(230).child("Means"))
          .child(div().w(100).child("Show on board"))
          .when(this.moreStatus, (el) => el.child(div().w(130).child("Hide in Your issues")).child(div().child("On hold"))),
      )
      .children(
        ws.statuses.map((status, index) =>
          h_flex()
            .id(`st-status-${index}`)
            .gap(12)
            .px(6)
            .h(28)
            .items_center()
            .rounded(6)
            .hover((style) => style.bg(t.hover))
            .child(
              h_flex()
                .w(150)
                .gap(6)
                .items_center()
                .child(div().size(7).rounded(4).bg(statusColor(t, status)))
                .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(status)),
            )
            .child(
              div()
                .w(230)
                .child(
                  this.pills(t, `st-role-${index}`, roles, role(status), (value, cx) => {
                    this.setRole(ws, status, value);
                    cx.notify();
                  }),
                ),
            )
            .child(
              h_flex()
                .w(100)
                .child(
                  this.check(
                    t,
                    `st-board-${index}`,
                    ws.boardView.statuses.includes(status),
                    (cx) => {
                      ws.boardView.statuses = ws.boardView.statuses.includes(status)
                        ? ws.boardView.statuses.filter((value) => value !== status)
                        : ws.statuses.filter((value) => value === status || ws.boardView.statuses.includes(value));
                      cx.notify();
                    },
                    { tooltip: "A column on the Board tab. With none ticked, every status that holds an item" },
                  ),
                ),
            )
            .when(this.moreStatus, (el) =>
              el
                .child(
                  h_flex()
                    .w(130)
                    .child(
                      this.check(t, `st-hide-${index}`, ws.mineHidden.includes(status), (cx) => {
                        ws.mineHidden = ws.mineHidden.includes(status)
                          ? ws.mineHidden.filter((value) => value !== status)
                          : ws.statuses.filter((value) => value === status || ws.mineHidden.includes(value));
                        cx.notify();
                      }),
                    ),
                )
                .child(
                  this.check(
                    t,
                    `st-hold-${index}`,
                    ws.spotlight.holdStatus === status,
                    (cx) => {
                      ws.spotlight.holdStatus = ws.spotlight.holdStatus === status ? "" : status;
                      cx.notify();
                    },
                    { tooltip: "Spotlight lists these issues apart, under this status" },
                  ),
                ),
            ),
        ),
      );
  }

  /**
   * Nightly: the workflow whose runs the nightly tile shows, its branch, the runs that count and
   * the checks.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @param {object | null} details The repository's details, once read.
   * @returns {object} The section's body.
   */
  nightlySection(t, ws, details) {
    const workflows = details?.workflows ?? [];
    const workflowOptions = [
      { value: null, label: "None", sub: "no nightly tile" },
      ...workflows.map((workflow) => ({ value: workflow.file, label: workflow.name, sub: workflow.file })),
    ];
    if (ws.nightly && !workflows.some((workflow) => workflow.file === ws.nightly.workflow)) {
      workflowOptions.push({ value: ws.nightly.workflow, label: ws.nightly.workflow });
    }
    return v_flex()
      .gap(10)
      .when(Boolean(details?.loading), (el) => el.child(Note("Reading the repository's workflows…")))
      .child(
        this.field(
          t,
          "Workflow",
          this.picker(t, "ws-nightly", ws.nightly?.workflow ?? null, workflowOptions, (file) => {
            ws.nightly = file
              ? {
                  workflow: file,
                  branch: ws.nightly?.branch || details?.branch || "main",
                  events: ws.nightly?.events ?? ["schedule", "workflow_dispatch"],
                  checks: ws.nightly?.workflow === file ? ws.nightly.checks : [],
                }
              : null;
            this.inputs.nightlyBranch.set_value(ws.nightly?.branch ?? "");
          }),
        ),
      )
      .when(Boolean(ws.nightly), (el) =>
        el
          .child(this.field(t, "Branch", this.text(t, "nightlyBranch")))
          .child(
            this.field(
              t,
              "Runs that count",
              h_flex()
                .gap(6)
                .children(
                  NIGHTLY_EVENTS.map((event) =>
                    Toggle(`st-event-${event}`, event, ws.nightly.events.includes(event), (cx) => {
                      ws.nightly.events = ws.nightly.events.includes(event)
                        ? ws.nightly.events.filter((value) => value !== event)
                        : [...ws.nightly.events, event];
                      cx.notify();
                    }),
                  ),
                ),
            ),
          )
          .child(
            this.field(
              t,
              "Checks",
              Note(
                ws.nightly.checks.length
                  ? ws.nightly.checks.map((check) => check.name).join(" · ")
                  : "None: the tile shows the run's overall result.",
              ),
              "One row per job or step: edit them in alpmeister.json (see alpmeister.example.json).",
            ),
          ),
      );
  }

  /**
   * Bugs and triage: the Open bugs search, the field and priorities they are counted by, and the
   * Triage bugs search.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The section's body.
   */
  bugsSection(t, ws) {
    return v_flex()
      .gap(10)
      .child(this.field(t, "Open bugs search", this.text(t, "bugsQuery"), `Scoped to ${ws.repo}; also under Card filters`))
      .child(this.field(t, "Priority field", this.text(t, "priorityField"), "The issue field the bugs are counted by"))
      .child(this.field(t, "Priorities", this.text(t, "priorities")))
      .child(this.field(t, "Triage search", this.text(t, "triage")));
  }

  /**
   * Spotlight: how many milestones it shows, the labels that put an issue in it, and the issue
   * types always shown.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The section's body.
   */
  spotlightSection(t, ws) {
    return v_flex()
      .gap(10)
      .child(
        this.field(
          t,
          "Milestones",
          this.pills(
            t,
            "st-milestones",
            [1, 2, 3, 4].map((count) => ({ value: count, label: String(count) })),
            ws.spotlight.milestones,
            (count, cx) => {
              ws.spotlight.milestones = count;
              cx.notify();
            },
          ),
          "How many upcoming milestones the spotlight shows",
        ),
      )
      .child(this.field(t, "Labels", this.text(t, "spotlightLabels")))
      .child(this.field(t, "Feature types", this.text(t, "featureTypes"), "Issue types always shown, in this order"));
  }
}
