// The Settings tab: every setting in ~/.config/alp/alpmeister.json as a form, with the choices
// read from GitHub (your repositories, boards, a board's statuses and fields, a repository's
// workflows) and from your disk (local clones). Edits stay in a draft until Save.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { pickFolder, theme } from "herdr";
import { DEFAULT_ISSUE_PROMPT, DEFAULT_PR_PROMPT, inScope, normalizeConfig, normalizeWorkspace, tildePath } from "./config.js";
import { boardFields, discover, findClones, guessRoles, repoDetails, saveSettings } from "./settings-data.js";
import { Card, Chip, Note, TextButton, Toggle, statusColor, warningColor } from "./ui.js";

/** A deep copy of plain JSON data. */
const copy = (value) => JSON.parse(JSON.stringify(value));

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
 * account; `workspace` fields edit the workspace shown; `ui` fields are the form's own.
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
  reviewQuery: {
    scope: "account",
    get: (account) => account.queries.review,
    set: (account, value) => (account.queries.review = value),
  },
  myPrsQuery: {
    scope: "account",
    get: (account) => account.queries.myPrs,
    set: (account, value) => (account.queries.myPrs = value),
  },
  mineQuery: {
    scope: "account",
    get: (account) => account.queries.mine,
    set: (account, value) => (account.queries.mine = value),
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
  filter: { scope: "ui", placeholder: "Filter" },
};

/** A board's key in the caches: "owner#number". */
const boardKey = (board) => `${board.owner}#${board.number}`;

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
    this.advancedAccount = false;
    this.advancedWorkspace = false;
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

  /** The workspace shown, or null. */
  workspace() {
    return this.draft?.workspaces[this.wsIndex] ?? null;
  }

  /** Puts the draft's values in the text fields. */
  syncInputs() {
    const ws = this.workspace();
    for (const [key, field] of Object.entries(FIELDS)) {
      if (field.scope === "account") this.inputs[key].set_value(field.get(this.draft.account) ?? "");
      if (field.scope === "workspace") this.inputs[key].set_value(ws ? (field.get(ws) ?? "") : "");
    }
  }

  /** Copies one text field into the draft. */
  fromInput(key) {
    const field = FIELDS[key];
    if (!this.draft || field.scope === "ui") return;
    const value = this.inputs[key].value();
    if (field.scope === "account") field.set(this.draft.account, value);
    const ws = this.workspace();
    if (field.scope === "workspace" && ws) field.set(ws, value);
  }

  /** Shows another workspace. */
  selectWorkspace(index, cx) {
    this.wsIndex = index;
    this.open = null;
    this.removeArmed = false;
    this.syncInputs();
    cx.notify();
  }

  /** Adds an empty workspace and shows it. */
  addWorkspace(cx) {
    this.draft.workspaces.push(normalizeWorkspace({ name: `Workspace ${this.draft.workspaces.length + 1}` }));
    this.selectWorkspace(this.draft.workspaces.length - 1, cx);
  }

  /** Removes the workspace shown, on the second click. */
  removeWorkspace(cx) {
    if (!this.removeArmed) {
      this.removeArmed = true;
      cx.notify();
      return;
    }
    this.draft.workspaces.splice(this.wsIndex, 1);
    this.selectWorkspace(Math.max(0, this.wsIndex - 1), cx);
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

  /** Toggles a picker open or shut, clearing its filter. */
  togglePicker(key, cx) {
    this.open = this.open === key ? null : key;
    this.inputs.filter.set_value("");
    cx.notify();
  }

  // --- drawing ---------------------------------------------------------------------------------

  /**
   * The tab's content.
   * @param {object} cx The view's context, for starting reads.
   * @param {{ configError: string | null, onRevert(cx: object): void, onReset(cx: object): void }} options
   * @returns {object} The element.
   */
  render(cx, options) {
    const t = theme();
    if (!this.draft) {
      return v_flex()
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
    return v_flex()
      .gap(14)
      .child(this.saveBar(t, options))
      .child(this.accountCard(t))
      .child(this.workspacesCard(t));
  }

  /**
   * Unsaved changes, the last message, and Revert and Save.
   * @param {object} t The theme.
   * @param {{ onRevert: Function }} options What Revert calls.
   * @returns {object} The bar.
   */
  saveBar(t, options) {
    const dirty = this.dirty();
    return h_flex()
      .items_center()
      .gap(10)
      .child(div().text_size(11.5).text_color(t.dim).child(this.demo ? "Demo settings: Save writes nothing" : "~/.config/alp/alpmeister.json"))
      .when(Boolean(this.message), (el) =>
        el.child(Note(this.message.text, this.message.error ? t.blocked : t.done)),
      )
      .child(div().flex_1())
      .when(this.discovering, (el) => el.child(Note("Reading GitHub…")))
      .child(
        TextButton("st-rediscover", "Reload choices", (cx) => this.rediscover(cx), {
          tooltip: "Read your repositories, boards and local clones again",
        }),
      )
      .when(dirty, (el) => el.child(Chip("Unsaved changes", { color: warningColor(t) })))
      .when(dirty, (el) => el.child(TextButton("st-revert", "Revert", (cx) => options.onRevert(cx))))
      .child(this.primaryButton(t, "st-save", this.saving ? "Saving…" : "Save", dirty && !this.saving, (cx) => this.save(cx)));
  }

  /** A filled button, dimmed while `enabled` is false. */
  primaryButton(t, id, label, enabled, onClick) {
    return h_flex()
      .id(id)
      .flex_none()
      .px(12)
      .h(24)
      .items_center()
      .rounded(6)
      .text_size(11.5)
      .font_medium()
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
      .child(this.heading(t, "Local folders"))
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
   * The account card: repositories in scope, local folders, Claude prompts, the @me searches.
   * @param {object} t The theme.
   * @returns {object} The card.
   */
  accountCard(t) {
    const account = this.draft.account;
    const picked = Array.isArray(account.repos);
    const scopedCount = this.knownRepos().filter((repo) =>
      inScope(account, { nameWithOwner: repo.repo, isArchived: repo.isArchived }),
    ).length;
    return Card(
      "st-account",
      "Your GitHub",
      [Chip(this.discovery ? `signed in as ${this.discovery.login}` : "gh", { color: t.dim })],
      v_flex()
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
        )
        .child(this.foldersSection(t))
        .child(this.heading(t, "Claude buttons"))
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
          h_flex()
            .gap(8)
            .child(
              TextButton("st-default-prompts", "Use the default prompts", (cx) => {
                account.launch.issue = DEFAULT_ISSUE_PROMPT;
                account.launch.pr = DEFAULT_PR_PROMPT;
                this.inputs.issuePrompt.set_value(DEFAULT_ISSUE_PROMPT);
                this.inputs.prPrompt.set_value(DEFAULT_PR_PROMPT);
                cx.notify();
              }),
            )
            .child(
              TextButton("st-advanced-account", this.advancedAccount ? "Hide the searches" : "Daypack searches…", (cx) => {
                this.advancedAccount = !this.advancedAccount;
                cx.notify();
              }),
            ),
        )
        .when(this.advancedAccount, (el) =>
          el
            .child(
              this.field(t, "Waiting for your review", this.text(t, "reviewQuery"), "GitHub issue searches, across everything you can see"),
            )
            .child(this.field(t, "Your open PRs", this.text(t, "myPrsQuery")))
            .child(this.field(t, "Your issues", this.text(t, "mineQuery"))),
        ),
    );
  }

  // --- workspaces ------------------------------------------------------------------------------

  /**
   * The workspaces card: one switch per workspace, then the one shown.
   * @param {object} t The theme.
   * @returns {object} The card.
   */
  workspacesCard(t) {
    const workspaces = this.draft.workspaces;
    const ws = this.workspace();
    return Card(
      "st-workspaces",
      "Workspaces",
      [
        ...workspaces.map((each, index) =>
          h_flex()
            .id(`st-ws-${index}`)
            .px(8)
            .h(22)
            .items_center()
            .rounded(6)
            .text_size(11.5)
            .cursor_pointer()
            .bg(index === this.wsIndex ? t.selected : t.background)
            .text_color(index === this.wsIndex ? t.foreground : t.dim)
            .hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => this.selectWorkspace(index, cx))
            .child(each.name || "Unnamed"),
        ),
        TextButton("st-ws-add", "+ Add workspace", (cx) => this.addWorkspace(cx)),
      ],
      ws
        ? this.workspaceForm(t, ws)
        : Note(
            "No workspaces yet. A workspace is a repository, a project board, or both, with the team cards for it: " +
              "bugs, triage, nightly, milestone, spotlight and in flight. With workspaces, the Overview switches " +
              "between them and All repos.",
          ),
    );
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

  /** The form for one workspace. */
  workspaceForm(t, ws) {
    const details = ws.repo ? this.details[ws.repo] : null;
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
      )
      .when(Boolean(ws.board), (el) => el.child(this.boardSection(t, ws)))
      .when(Boolean(ws.repo), (el) => el.child(this.repoSection(t, ws, details)))
      .child(
        h_flex()
          .pt(6)
          .gap(8)
          .child(div().flex_1())
          .child(
            TextButton("st-ws-remove", this.removeArmed ? "Click again to remove" : "Remove workspace", (cx) =>
              this.removeWorkspace(cx),
            ),
          ),
      );
  }

  /**
   * The board's fields and how its statuses read.
   * @param {object} t The theme.
   * @param {object} ws The workspace.
   * @returns {object} The section.
   */
  boardSection(t, ws) {
    const fields = this.fields[boardKey(ws.board)];
    const options = this.boardStatuses(ws);
    const differs = options && JSON.stringify(options) !== JSON.stringify(ws.statuses);
    const section = v_flex().gap(10).child(this.heading(t, "Board"));
    if (!fields || fields.loading) return section.child(Note("Reading the board's fields…"));
    if (fields.error) {
      return section.child(Note(`${fields.error}. The board needs gh's read:project scope: gh auth refresh -s read:project`, t.blocked));
    }
    return section
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
      .child(this.field(t, "Leave out of in flight", this.text(t, "excludeTypes")))
      .child(this.field(t, "Board tab filter", this.text(t, "boardView")));
  }

  /**
   * One row per status: its role, whether Your issues hides it, and which one means on hold.
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
          .child(div().w(230).child("Counts as"))
          .child(div().w(110).child("Hide in Your issues"))
          .child(div().w(70).child("On Board"))
          .child(div().child("On hold")),
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
                .w(110)
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
              h_flex()
                .w(70)
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
      );
  }

  /** The repository's cards: triage, bugs, spotlight, customer issues, nightly. */
  repoSection(t, ws, details) {
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
      .child(this.heading(t, "Nightly"))
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
      )
      .child(
        h_flex().child(
          TextButton(
            "st-advanced-ws",
            this.advancedWorkspace ? "Hide the team cards' settings" : "Bugs, triage, spotlight and customer issues…",
            (cx) => {
              this.advancedWorkspace = !this.advancedWorkspace;
              cx.notify();
            },
          ),
        ),
      )
      .when(this.advancedWorkspace, (el) =>
        el
          .child(this.heading(t, "Bugs and triage"))
          .child(this.field(t, "Open bugs search", this.text(t, "bugsQuery"), `Scoped to ${ws.repo}`))
          .child(this.field(t, "Priority field", this.text(t, "priorityField"), "The issue field the bugs are counted by"))
          .child(this.field(t, "Priorities", this.text(t, "priorities")))
          .child(this.field(t, "Triage search", this.text(t, "triage")))
          .child(this.heading(t, "Spotlight"))
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
          .child(this.field(t, "Feature types", this.text(t, "featureTypes"), "Issue types always shown, in this order"))
          .child(this.heading(t, "Customer issues"))
          .child(this.field(t, "Label contains", this.text(t, "customer"))),
      );
  }
}
