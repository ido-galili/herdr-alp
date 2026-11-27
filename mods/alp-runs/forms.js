// The Run tab's overlays: the dialog that asks for a run's `${input:...}` values before it
// starts, the form that adds or edits a run in one of Alp's config files, and a run's
// right-click menu. The import dialog is in import-view.js.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { closeOverlay, props, setShared, shared, theme, window } from "herdr";
import { LAYER_LABEL, loadConfig, writeLayer } from "./alp-config.js";
import { findWorkspace, loadEntries } from "./config.js";
import { neededInputs } from "./runner.js";
import { inputIds, quote } from "./template.js";
import { ANSWERS_KEY, ListPart, openSaveForm, STAMP_KEY } from "./list-view.js";

/** Where each layer's file is, as people know it. */
export const LAYER_FILE = {
  you: "~/.config/alp/alp.json",
  repo: ".herdr/alp.json",
  local: ".herdr/alp.local.json",
};
/** What saving to each layer means, under the choice. */
const LAYER_HINT = {
  you: "Saved in ~/.config/alp/alp.json: yours, in every repo.",
  repo: "Saved in .herdr/alp.json: commit it to share with everyone who clones the repo.",
  local: "Saved in .herdr/alp.local.json: yours, in this repo only. Git ignores it.",
};

/** A dialog button. */
export function button(t, id, label, primary, action) {
  return h_flex()
    .id(id)
    .h(32)
    .px(14)
    .items_center()
    .rounded(8)
    .border_1()
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .text_size(12.5)
    .font_medium()
    .cursor_pointer()
    .hover((style) => style.opacity(0.88))
    .on_click(action)
    .child(label);
}

/** A field's label. */
const fieldLabel = (t, text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);

/** A text field over an InputState. */
const textField = (t, state) =>
  Input.new(state).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5);

/**
 * The dialog's frame: a title with Esc, the fields, and the buttons.
 * @param {object} t The theme.
 * @param {object} part The dialog's view, for its focus handle and error.
 * @param {string} title The dialog's title.
 * @param {object[]} fields What goes in the scrolling middle.
 * @param {object[]} buttons The buttons, right-aligned at the bottom.
 * @returns {object}
 */
export function dialog(t, part, title, fields, buttons) {
  return v_flex()
    .id("alp-runs-dialog")
    .track_focus(part.handle)
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      closeOverlay(props().overlay);
      cx.stop_propagation();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .bg(t.popover)
    .text_color(t.foreground)
    .child(
      h_flex()
        .items_center()
        .child(div().flex_1().text_size(15).font_semibold().truncate().child(title))
        .child(div().text_size(11.5).text_color(t.dim).child("Esc")),
    )
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(fields))
    .when(Boolean(part.error), (el) => el.child(div().pt(8).text_size(11.5).text_color(t.blocked).child(part.error)))
    .child(h_flex().pt(16).gap(8).justify_end().children(buttons));
}

/**
 * A choice of one value among a few, as joined buttons.
 * @param {object} t The theme.
 * @param {string} id Element id prefix.
 * @param {{ value: string, label: string }[]} options The choices.
 * @param {string} value The chosen one.
 * @param {(value: string, cx: object) => void} onChange Called with the new choice.
 * @returns {object}
 */
export function segmented(t, id, options, value, onChange) {
  return h_flex()
    .self_start()
    .rounded(8)
    .border_1()
    .border_color(t.input)
    .overflow_hidden()
    .children(
      options.map((option) =>
        div()
          .id(`${id}-${option.value}`)
          .px(12)
          .py(6)
          .text_size(12)
          .cursor_pointer()
          .bg(option.value === value ? t.selected : t.background)
          .text_color(option.value === value ? t.foreground : t.muted)
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => onChange(option.value, cx))
          .child(option.label),
      ),
    );
}

/** Tells every Run tab to read the config again. */
const announceChange = () => setShared(STAMP_KEY, Date.now());

/** Loads the entry an overlay was opened for. */
async function loadEntry(key, root) {
  const workspace = await findWorkspace(root);
  const catalog = await loadEntries(workspace, window()?.platform ?? "macos");
  const entry = catalog.runs.find((item) => item.key === key);
  return { workspace, catalog, entry };
}

export class InputPart {
  init(cx) {
    this.handle = cx.focus_handle();
    this.entry = null;
    this.inputs = [];
    this.states = {};
    this.choices = {};
    const { key, root } = props();
    cx.spawn(async (cx) => {
      const { catalog, entry } = await loadEntry(key, root);
      this.entry = entry;
      this.inputs = entry ? neededInputs(entry, catalog) : [];
      const last = shared(ANSWERS_KEY) ?? {};
      for (const input of this.inputs) {
        const initial = last[input.id] ?? input.default ?? "";
        if (input.type === "pickString") {
          const values = (input.options ?? []).map((option) => (typeof option === "string" ? option : option.value));
          this.choices[input.id] = values.includes(initial) ? initial : values[0];
        } else {
          const state = InputState.new({ value: String(initial), placeholder: input.description ?? input.id });
          if (input.password) state.set_masked(true);
          state.on("submit", () => this.submit());
          this.states[input.id] = state;
        }
      }
      const first = this.inputs.find((input) => this.states[input.id]);
      if (first) this.states[first.id].focus();
      else this.handle.focus();
      cx.notify();
    });
  }

  submit() {
    const answers = Object.fromEntries(
      this.inputs.map((input) => [input.id, this.states[input.id]?.value() ?? this.choices[input.id] ?? ""]),
    );
    const { key, root, overlay } = props();
    ListPart.request(key, root, answers);
    closeOverlay(overlay);
  }

  /** A pickString's options as chips; the chosen one is lit. */
  options(t, input) {
    const chip = (option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : (option.label ?? option.value);
      const on = this.choices[input.id] === value;
      return div()
        .id(`input-${input.id}-${value}`)
        .px(10)
        .py(4)
        .rounded(7)
        .border_1()
        .border_color(on ? t.accent : t.input)
        .bg(on ? t.selected : t.background)
        .text_size(12)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => {
          this.choices[input.id] = value;
          cx.notify();
        })
        .child(label);
    };
    return h_flex()
      .flex_wrap()
      .gap(6)
      .children((input.options ?? []).map(chip));
  }

  render() {
    const t = theme();
    const fields = this.inputs.flatMap((input) => [
      fieldLabel(t, input.description ?? input.id),
      input.type === "pickString" ? this.options(t, input) : textField(t, this.states[input.id]),
    ]);
    return dialog(t, this, this.entry ? `Run ${this.entry.name}` : "Run", fields, [
      button(t, "input-cancel", "Cancel", false, () => closeOverlay(props().overlay)),
      button(t, "input-run", "Run", true, () => this.submit()),
    ]);
  }
}

/**
 * A run's command as one line for the form: a list becomes quoted words.
 * @param {string | string[] | undefined} command The run's `command`.
 * @returns {string}
 */
const commandText = (command) => (Array.isArray(command) ? command.map((word) => quote(String(word))).join(" ") : (command ?? ""));

export class SavePart {
  init(cx) {
    this.handle = cx.focus_handle();
    this.error = "";
    const { name, layer, root } = props();
    this.root = root ?? null;
    this.original = name ?? null;
    this.originalLayer = layer ?? null;
    this.layer = layer ?? (this.root ? "repo" : "you");
    this.base = {};
    this.shownCommand = "";
    this.name = InputState.new({ placeholder: "Dev server", value: name ?? "" });
    this.command = InputState.new({ placeholder: "npm run dev -- --port ${input:port}" });
    this.cwd = InputState.new({ placeholder: "web" });
    for (const state of [this.name, this.command, this.cwd]) state.on("submit", (_event, cx) => this.save(cx));
    this.name.focus();
    if (!name) return;
    cx.spawn(async (cx) => {
      const workspace = this.root ? await findWorkspace(this.root) : null;
      const { layers, merged } = await loadConfig(workspace);
      const shown = merged.runs?.[name] ?? {};
      this.base = layers[this.layer]?.value.runs?.[name] ?? {};
      this.shownCommand = commandText(shown.command);
      this.command.set_value(this.shownCommand);
      this.cwd.set_value(typeof shown.cwd === "string" ? shown.cwd : "");
      cx.notify();
    });
  }

  /** Writes the run into the chosen file, moving it there when it came from another one. */
  save(cx) {
    const name = this.name.value().trim();
    const command = this.command.value().trim();
    const cwd = this.cwd.value().trim();
    if (!name || !command) {
      this.error = "A run needs a name and a command.";
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const workspace = this.root ? await findWorkspace(this.root) : null;
        const { merged } = await loadConfig(workspace);
        if (name !== this.original && merged.runs?.[name]) throw new Error(`A run named ${name} exists already.`);
        const moved = this.originalLayer && this.originalLayer !== this.layer;
        const run = { ...(moved ? {} : this.base) };
        // An unchanged list command stays a list; anything typed becomes a shell line.
        run.command = command === this.shownCommand && Array.isArray(this.base.command) ? this.base.command : command;
        if (cwd) run.cwd = cwd;
        else delete run.cwd;
        const edits = [];
        if (this.original && this.original !== name && !moved) edits.push({ path: ["runs", this.original], value: undefined });
        edits.push({ path: ["runs", name], value: run });
        for (const id of new Set(inputIds(`${command} ${cwd}`))) {
          if (!merged.inputs?.[id]) edits.push({ path: ["inputs", id], value: { type: "promptString", description: id } });
        }
        await writeLayer(this.layer, workspace, edits);
        if (moved) await writeLayer(this.originalLayer, workspace, [{ path: ["runs", this.original], value: undefined }]);
        announceChange();
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        cx.notify();
      }
    });
  }

  /**
   * The add-or-edit form: the run's fields, the file to save to, and what that file means.
   * @returns {object}
   */
  render() {
    const t = theme();
    const layers = this.root ? ["repo", "local", "you"] : ["you"];
    const fields = [
      fieldLabel(t, "Name"),
      textField(t, this.name),
      fieldLabel(t, "Command: ${input:name} asks before it runs"),
      textField(t, this.command),
      fieldLabel(t, "Folder, from the repo root (empty: the root)"),
      textField(t, this.cwd),
      fieldLabel(t, "Save to"),
      segmented(
        t,
        "save-layer",
        layers.map((layer) => ({ value: layer, label: LAYER_LABEL[layer] })),
        this.layer,
        (layer, cx) => {
          this.layer = layer;
          cx.notify();
        },
      ),
      div().pt(6).text_size(11.5).text_color(t.dim).child(LAYER_HINT[this.layer]),
    ];
    return dialog(t, this, this.original ? `Edit ${this.original}` : "Add a run", fields, [
      button(t, "save-cancel", "Cancel", false, () => closeOverlay(props().overlay)),
      button(t, "save-save", "Save", true, (_event, cx) => this.save(cx)),
    ]);
  }
}

export class MenuPart {
  init(cx) {
    this.handle = cx.focus_handle();
  }

  /** Removes the run from the file it came from. */
  remove(cx) {
    const { name, origin, root, overlay } = props();
    cx.spawn(async () => {
      try {
        const workspace = await findWorkspace(root);
        await writeLayer(origin, workspace, [{ path: ["runs", name], value: undefined }]);
        announceChange();
      } catch (error) {
        console.log(`alp-runs: ${name} not deleted: ${error?.message ?? error}`);
      }
      closeOverlay(overlay);
    });
  }

  render() {
    const t = theme();
    const { key, name, origin, root, repo, hidden, overlay } = props();
    const item = (id, label, action) =>
      div()
        .id(id)
        .px(12)
        .py(7)
        .rounded(6)
        .text_size(12.5)
        .truncate()
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click(action)
        .child(label);
    const items = [
      item("menu-edit", "Edit…", () => {
        openSaveForm(root, { name, layer: origin });
        closeOverlay(overlay);
      }),
      item("menu-delete", `Delete from ${LAYER_FILE[origin].split("/").pop()}`, (_event, cx) => this.remove(cx)),
      item(hidden ? "menu-show" : "menu-hide", hidden ? "Show again" : "Hide", () => {
        ListPart.setVisibility(repo, key, !hidden);
        closeOverlay(overlay);
      }),
    ];
    return v_flex().id("alp-runs-menu").size_full().p(4).bg(t.popover).text_color(t.foreground).children(items);
  }
}
