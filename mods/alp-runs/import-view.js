// The Run tab's Import from VS Code dialog: every launch config, compound and task of the repo's
// .vscode folder with a checkbox. Ones that can't run outside VS Code are greyed with the reason;
// ticking a run ticks what it depends on; names already in Alp's config stay unticked unless
// picked to replace. The picked runs, and the inputs they ask for, go into the chosen file.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, notify, props, setShared, theme, window } from "herdr";
import { LAYER_LABEL, loadConfig, writeLayer } from "./alp-config.js";
import { findWorkspace } from "./config.js";
import { button, dialog, LAYER_FILE, segmented } from "./forms.js";
import { STAMP_KEY } from "./list-view.js";
import { readVscode } from "./vscode.js";

/**
 * The theme's warning colour (orange): a theme may not carry `warning`, so fall back to Alp's.
 * @param {object} t The theme.
 * @returns {string} The warning colour.
 */
const warning = (t) => t.warning ?? "#ffb86c";

/**
 * A short description of what a run does, for its row.
 * @param {object} run A run in Alp's config shape.
 * @returns {string}
 */
function summary(run) {
  if (run.runs) return `starts ${run.runs.join(", ")}`;
  if (Array.isArray(run.command)) return run.command.join(" ");
  if (run.command) return run.command;
  return run.dependsOn?.length ? `runs ${run.dependsOn.join(", ")}` : "";
}

export class ImportPart {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.error = "";
    this.items = null;
    this.inputs = {};
    this.existing = {};
    this.selected = new Set();
    this.layer = "repo";
    this.busy = false;
    cx.spawn(async (cx) => {
      try {
        this.workspace = await findWorkspace(props().root);
        const [found, config] = await Promise.all([
          readVscode(this.workspace, window()?.platform ?? "macos"),
          loadConfig(this.workspace),
        ]);
        this.items = found.items;
        this.inputs = found.inputs;
        this.config = config;
        this.existing = config.merged.runs ?? {};
        this.error = found.errors.join("\n");
        for (const item of this.items) if (item.run && !this.existing[item.name]) this.selected.add(item.name);
      } catch (error) {
        this.items = [];
        this.error = String(error?.message ?? error);
      }
      cx.notify();
    });
  }

  /**
   * Ticks or unticks a row. Ticking also ticks the runs it needs, all the way down.
   * @param {object} item The row's item.
   * @returns {void}
   */
  toggle(item) {
    if (this.selected.has(item.name)) {
      this.selected.delete(item.name);
      return;
    }
    const byName = new Map(this.items.map((candidate) => [candidate.name, candidate]));
    const visit = (current, depth) => {
      if (!current?.run || depth > 20) return;
      this.selected.add(current.name);
      current.needs.forEach((name) => visit(byName.get(name), depth + 1));
    };
    visit(item, 0);
  }

  /** Writes the ticked runs and the inputs they use into the chosen file. */
  import(cx) {
    const picked = this.items.filter((item) => item.run && this.selected.has(item.name));
    if (!picked.length || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const edits = picked.map((item) => ({ path: ["runs", item.name], value: item.run }));
        const known = this.config.merged.inputs ?? {};
        for (const id of new Set(picked.flatMap((item) => item.inputIds))) {
          if (this.inputs[id] && !known[id]) edits.push({ path: ["inputs", id], value: this.inputs[id] });
        }
        await writeLayer(this.layer, this.workspace, edits);
        setShared(STAMP_KEY, Date.now());
        notify({
          title: `Imported ${picked.length} run${picked.length === 1 ? "" : "s"}`,
          body: `Into ${LAYER_FILE[this.layer]}${this.layer === "repo" ? ". Commit it to share them." : "."}`,
        });
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  /**
   * One importable item: a checkbox, its name, and what it runs, why it can't, or that it would
   * replace a run already in the config.
   * @param {object} t The theme.
   * @param {object} item The item.
   * @returns {object}
   */
  row(t, item) {
    const on = this.selected.has(item.name);
    const exists = this.existing[item.name];
    const note = item.reason
      ? { text: `can't: it ${item.reason}`, color: t.dim }
      : exists
        ? {
            text: on ? "replaces the one in Alp's config" : "already in Alp's config · tick to replace",
            color: warning(t),
          }
        : { text: summary(item.run), color: t.dim };
    return h_flex()
      .id(`import-${item.key}`)
      .h(30)
      .px(8)
      .gap(10)
      .items_center()
      .rounded(6)
      .text_size(12.5)
      .when(Boolean(item.run), (el) =>
        el
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => {
            this.toggle(item);
            cx.notify();
          }),
      )
      .child(
        h_flex()
          .size(14)
          .flex_none()
          .items_center()
          .justify_center()
          .rounded(4)
          .border_1()
          .border_color(on ? t.accent : t.input)
          .bg(on ? t.accent : t.background)
          .text_size(10)
          .text_color(t.background)
          .child(on ? "✓" : ""),
      )
      .child(
        div()
          .flex_none()
          .max_w(200)
          .truncate()
          .text_color(item.run ? t.foreground : t.dim)
          .child(item.name),
      )
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(note.color).child(note.text));
  }

  /**
   * The import dialog: the .vscode launch configs and tasks under a heading each, and where to save them.
   * @returns {object}
   */
  render() {
    const t = theme();
    const fields = [];
    if (!this.items) fields.push(div().py(12).text_size(12).text_color(t.dim).child("Reading .vscode…"));
    else if (!this.items.length)
      fields.push(div().py(12).text_size(12).text_color(t.dim).child("No launch configs or tasks in .vscode."));
    for (const [group, file] of [
      ["Launch", "launch.json"],
      ["Tasks", "tasks.json"],
    ]) {
      const rows = (this.items ?? []).filter((item) => item.group === group);
      if (!rows.length) continue;
      fields.push(
        div().pt(12).pb(4).px(8).text_size(11.5).font_semibold().text_color(t.dim).child(`${group} · .vscode/${file}`),
      );
      rows.forEach((item) => fields.push(this.row(t, item)));
    }
    const count = (this.items ?? []).filter((item) => item.run && this.selected.has(item.name)).length;
    return dialog(t, this, "Import from VS Code", fields, [
      h_flex()
        .flex_1()
        .gap(8)
        .items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("Save to"))
        .child(
          segmented(
            t,
            "import-layer",
            ["repo", "local"].map((layer) => ({ value: layer, label: LAYER_LABEL[layer] })),
            this.layer,
            (layer, cx) => {
              this.layer = layer;
              cx.notify();
            },
          ),
        ),
      button(t, "import-cancel", "Cancel", false, () => closeOverlay(props().overlay)),
      button(t, "import-go", this.busy ? "Importing…" : `Import ${count}`, true, (_event, cx) => this.import(cx)),
    ]);
  }
}
