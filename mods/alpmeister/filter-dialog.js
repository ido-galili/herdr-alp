// The filter dialog: one editor for every card's filter (the Overview tiles and Open PRs, the
// Daypack cards, the Board, and Settings › Card filters). It opens as a Herdr dialog, centred over
// a dimmed window, drawn by a copy of this mod opened with `props.part` "filter".
//
// The copy that opens it keeps the filter: it hands the dialog a session (what to draw, how to
// count, how to save) through `sessions`, which every copy of the mod shares (module code runs
// once per source version). The dialog holds the edit; the card only ever shows the saved filter.
// Save writes it, and Cancel, Esc or a click outside throw it away.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { closeOverlay, openOverlay, props, theme } from "herdr";
import { pressOnKey } from "./ui.js";

/** The open dialogs' sessions, by id, put here by the copy that opened each one. */
const sessions = new Map();
let nextSession = 0;

/** How wide the dialog is, and how wide its chip rows are inside it (less the padding and the row labels). */
const WIDTH = 560;
const CHIP_ROOM = WIDTH - 36 - 72 - 8;
/** The pause after typing before the count is fetched again; Enter counts at once. */
const TYPE_PAUSE = 700;
/** The pause after a chip click, so a few quick clicks fetch once. */
const CHIP_PAUSE = 150;

/**
 * @typedef {{ query: string, statuses?: string[], people?: string[] }} Draft
 *   What the dialog edits: the search, and on the Board its columns and people.
 * @typedef {{ id: string, label: string, on: boolean, tooltip?: string, add?: boolean,
 *   press: ((draft: Draft) => Draft | string) | "label" }} DialogChip
 *   `press` answers the draft after the click, or a line to show instead (such as "Keep at least
 *   one column."); "label" starts a label term in the field.
 * @typedef {{
 *   title: string,
 *   groups: { label: string, note?: string, chips: DialogChip[] }[],
 *   inputLabel: string,
 *   placeholder: string,
 *   hint: string,
 *   noun: [string, string],
 *   now: number | null,
 *   saveLabel: string,
 *   demo: boolean,
 * }} DialogSpec What the dialog draws for a draft. `noun` is what the count counts, one and
 *   many ("issue", "issues"); `now` is the card's count now, or null when unknown.
 * @typedef {{
 *   spec(draft: Draft): DialogSpec,
 *   start: Draft,
 *   fallback: Draft,
 *   count(draft: Draft): Promise<number>,
 *   save(draft: Draft): Promise<void>,
 * }} FilterSession The filter a dialog edits: `start` is the filter it opens on, `fallback` the
 *   default that Reset fills in. `count` throws with GitHub's message for a search it refuses;
 *   `save` writes the filter (only that card's settings key) and throws when it can't.
 */

/**
 * The dialog's height for a session: its fixed rows plus its chip rows, as they wrap.
 * @param {DialogSpec} spec What the dialog draws.
 * @returns {number} The height in pixels.
 */
function dialogHeight(spec) {
  const chipWidth = (chip) => Math.ceil((chip.on ? chip.label.length + 2 : chip.label.length) * 7.2) + 30;
  const rows = spec.groups.map((group) => {
    let lines = 1;
    let used = 0;
    const widths = group.chips.map((chip) => chipWidth(chip) + 6);
    if (group.note) widths.push(Math.ceil(group.note.length * 7.2));
    for (const width of widths) {
      if (used && used + width > CHIP_ROOM) {
        lines += 1;
        used = 0;
      }
      used += width;
    }
    return lines * 24 + (lines - 1) * 6;
  });
  const groups = rows.reduce((sum, height) => sum + height + 10, 0);
  return 280 + groups;
}

/**
 * Opens the filter dialog on a session.
 * @param {FilterSession} session The filter it edits.
 * @returns {void}
 */
export function openFilterDialog(session) {
  const id = `filter-${++nextSession}`;
  sessions.set(id, session);
  openOverlay({
    mod: "alpmeister",
    kind: "dialog",
    width: WIDTH,
    height: dialogHeight(session.spec(session.start)),
    props: { part: "filter", session: id },
  });
}

/** The words for a count: "3 issues", "1 PR". */
const counted = (count, [one, many]) => `${count} ${count === 1 ? one : many}`;

/** A draft's key, to tell whether a count is for the draft shown. */
const draftKey = (draft) => JSON.stringify([draft.query.trim(), draft.statuses ?? null, draft.people ?? null]);

/**
 * The dialog itself, drawn by the copy of the mod opened with `props.part` "filter".
 */
export class FilterDialog {
  /**
   * @param {object} cx The copy's context, from `init`.
   */
  constructor(cx) {
    this.id = props()?.session ?? null;
    /** @type {FilterSession | null} */
    this.session = sessions.get(this.id) ?? null;
    const start = this.session?.start ?? { query: "" };
    const { query, ...extra } = start;
    /** The draft's Board columns and people; its search is the field's text. */
    this.extra = extra;
    const spec = this.session?.spec(start);
    this.input = InputState.new({ placeholder: spec?.placeholder ?? "" });
    this.input.set_value(query);
    this.input.on("change", (_event, cx) => {
      this.countSoon(TYPE_PAUSE, cx);
      cx.notify();
    });
    this.input.on("submit", (_event, cx) => this.countNow(cx));
    /** The last count: `{ key, count }` or `{ key, error }`, for the draft with that key. */
    this.result = null;
    this.counting = false;
    this.countSeq = 0;
    this.countTimer = null;
    this.saving = false;
    /** A line under the count: `{ text, error? }` or null. */
    this.message = null;
    if (!this.session) return;
    // The field mounts on the next frame; focus it once it is there. Kept here: a dropped task would not fire.
    this.focusTask = cx.timer.after(100, () => this.input.focus());
    this.countNow(cx);
  }

  /** Forgets the session once the dialog is gone. */
  close() {
    if (this.id) sessions.delete(this.id);
  }

  /**
   * The draft as the dialog shows it now.
   * @returns {Draft}
   */
  draft() {
    return { ...this.extra, query: this.input.value() };
  }

  /**
   * Shuts the dialog. Whatever was edited and not saved is dropped.
   * @returns {void}
   */
  dismiss() {
    closeOverlay(props().overlay);
  }

  /**
   * Counts the draft after a pause, so typing or quick clicks fetch once.
   * @param {number} ms The pause.
   * @param {object} cx The context.
   * @returns {void}
   */
  countSoon(ms, cx) {
    const seq = ++this.countSeq;
    this.countTimer = cx.timer.after(ms, (later) => {
      if (seq === this.countSeq) this.countNow(later ?? cx);
    });
  }

  /**
   * Counts what the draft would show, at once. A newer count wins over an older one still out.
   * @param {object} cx The context.
   * @returns {Promise<void>} Settles when this count is in.
   */
  countNow(cx) {
    const draft = this.draft();
    const key = draftKey(draft);
    const seq = ++this.countSeq;
    this.counting = true;
    cx.notify();
    return new Promise((resolve) => {
      cx.spawn(async (cx) => {
        let result;
        try {
          result = { key, count: await this.session.count(draft) };
        } catch (error) {
          result = { key, error: `GitHub: ${error?.message ?? error}` };
        }
        if (seq === this.countSeq) {
          this.result = result;
          this.counting = false;
        }
        cx.notify();
        resolve();
      });
    });
  }

  /**
   * A chip's click: the draft it gives goes in the field and is counted; a line it gives shows.
   * @param {DialogChip} chip The chip.
   * @param {object} cx The context.
   * @returns {void}
   */
  pressChip(chip, cx) {
    if (chip.press === "label") return this.addLabel(cx);
    const next = chip.press(this.draft());
    if (typeof next === "string") {
      this.message = { text: next };
      return cx.notify();
    }
    this.setDraft(next, cx);
  }

  /**
   * Puts a draft in the dialog and counts it.
   * @param {Draft} draft The draft.
   * @param {object} cx The context.
   * @returns {void}
   */
  setDraft(draft, cx) {
    const { query, ...extra } = draft;
    this.extra = extra;
    this.message = null;
    this.input.set_value(query);
    this.countSoon(CHIP_PAUSE, cx);
    cx.notify();
  }

  /**
   * Starts a label term in the search, before a sort at its end, with the cursor after it, so the
   * label's name can be typed and Enter counts it.
   * @param {object} cx The context.
   * @returns {void}
   */
  addLabel(cx) {
    const text = this.input.value().trim();
    const sort = text.search(/(^|\s)sort:\S*$/);
    const head = `${(sort < 0 ? text : text.slice(0, sort)).trim()} label:`.trimStart();
    const tail = sort < 0 ? "" : ` ${text.slice(sort).trim()}`;
    this.input.set_value(head + tail);
    this.input.set_selected_range({ start: head.length, end: head.length });
    this.input.focus();
    this.message = { text: "Type the label's name, then press Enter." };
    cx.notify();
  }

  /**
   * "Save for this card": counts the draft first when it isn't counted yet (a search GitHub
   * refuses is not saved), then saves it and shuts the dialog.
   * @param {object} cx The context.
   * @returns {void}
   */
  save(cx) {
    if (this.saving) return;
    this.saving = true;
    this.message = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const draft = { ...this.draft(), query: this.input.value().trim() };
      try {
        if (this.result?.key !== draftKey(draft) || this.counting) await this.countNow(cx);
        if (this.result?.error) throw new Error("GitHub refuses this search, so it isn't saved. Fix it first.");
        await this.session.save(draft);
        this.saving = false;
        return this.dismiss();
      } catch (error) {
        this.saving = false;
        this.message = { text: String(error?.message ?? error), error: true };
      }
      cx.notify();
    });
  }

  /**
   * Draws the dialog: its title and ✕, the chips by group, the search field, the count, then
   * Reset to default on the left and Cancel and Save on the right.
   * @param {object} _cx The render's context.
   * @returns {object}
   */
  render(_cx) {
    const t = theme();
    const root = v_flex()
      .id("filter-dialog")
      .size_full()
      .p(18)
      .gap(14)
      .bg(t.background)
      .on_key_down((event, cx) => {
        if (event.key !== "escape") return;
        cx.stop_propagation();
        this.dismiss();
      });
    if (!this.session) {
      return root
        .child(div().text_size(12).text_color(t.muted).child("This filter is gone (Alp was reloaded). Close and open it again."))
        .child(h_flex().child(div().flex_1()).child(this.button(t, "cancel", "Close", () => this.dismiss(), "plain")));
    }
    const draft = this.draft();
    const spec = this.session.spec(draft);
    const key = draftKey(draft);
    const result = this.result?.key === key ? this.result : null;
    const refused = Boolean(result?.error);
    return root
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).child(spec.title))
          .child(this.button(t, "close", "✕", () => this.dismiss(), "icon", "Close without saving (Esc)")),
      )
      .when(spec.groups.length > 0, (el) => el.child(v_flex().gap(10).children(spec.groups.map((group) => this.group(t, group)))))
      .child(
        v_flex()
          .gap(5)
          .child(div().text_size(11.5).text_color(t.dim).child(spec.inputLabel))
          .child(
            Input.new(this.input)
              .h(30)
              .px(9)
              .rounded(6)
              .border_1()
              .border_color(refused ? t.blocked : t.border)
              .bg(t.canvas)
              .text_size(12)
              .text_color(t.foreground),
          )
          .child(div().text_size(11.5).text_color(t.dim).child(spec.hint)),
      )
      .child(this.countLine(t, spec, result))
      .when(Boolean(this.message), (el) =>
        el.child(div().text_size(11.5).text_color(this.message.error ? t.blocked : t.dim).child(this.message.text)),
      )
      .child(div().flex_1())
      .child(
        h_flex()
          .pt(12)
          .gap(8)
          .items_center()
          .border_t_1()
          .border_color(t.border)
          .child(this.button(t, "reset", "Reset to default", (cx) => this.setDraft(this.session.fallback, cx), "plain", "Fill in the default filter; Save keeps it"))
          .child(div().flex_1())
          .child(this.button(t, "cancel", "Cancel", () => this.dismiss(), "plain", "Close without saving (Esc)"))
          .child(
            this.button(t, "save", this.saving ? "Saving…" : spec.saveLabel, (cx) => this.save(cx), "primary", spec.demo ? "Demo: kept in this tab only, nothing is written" : null, refused || this.saving),
          ),
      );
  }

  /**
   * The count line: "Shows 3 issues · now 0" for the draft, "Counting…" while it is fetched, or
   * GitHub's error for a search it refuses.
   * @param {object} t The theme.
   * @param {DialogSpec} spec What the dialog draws.
   * @param {{ count?: number, error?: string } | null} result The draft's count, when in.
   * @returns {object}
   */
  countLine(t, spec, result) {
    const now = spec.now == null ? null : `now ${spec.now}`;
    const line = h_flex().gap(6).items_center().text_size(12);
    if (result?.error) return line.child(div().min_w(0).text_color(t.blocked).child(result.error));
    if (!result || this.counting) {
      return line.child(div().text_color(t.dim).child("Counting…")).when(Boolean(now), (el) => el.child(div().text_color(t.dim).child(`· ${now}`)));
    }
    return line
      .child(div().font_medium().text_color(t.foreground).child(`Shows ${counted(result.count, spec.noun)}`))
      .when(Boolean(now), (el) => el.child(div().text_color(t.dim).child(`· ${now}`)));
  }

  /**
   * One row of chips with its label on the left, and an optional dim note after the chips.
   * @param {object} t The theme.
   * @param {{ label: string, note?: string, chips: DialogChip[] }} group The row.
   * @returns {object}
   */
  group(t, group) {
    return h_flex()
      .gap(8)
      .items_start()
      .child(div().flex_none().w(64).h(24).flex().items_center().text_size(11.5).text_color(t.dim).child(group.label))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .flex_wrap()
          .gap(6)
          .items_center()
          .children(group.chips.map((chip) => this.chip(t, chip)))
          .when(Boolean(group.note), (row) => row.child(div().h(24).flex().items_center().text_size(11.5).text_color(t.dim).child(group.note))),
      );
  }

  /**
   * A chip that turns a term on or off: ticked and in the accent while on, dashed for "+ Label".
   * A Tab stop: Enter or Space presses it.
   * @param {object} t The theme.
   * @param {DialogChip} chip The chip.
   * @returns {object}
   */
  chip(t, chip) {
    const press = (cx) => this.pressChip(chip, cx);
    return h_flex()
      .id(`fd-${chip.id}`)
      .flex_none()
      .h(24)
      .px(10)
      .items_center()
      .rounded(12)
      .border_1()
      .when(Boolean(chip.add), (el) => el.border_dashed())
      .border_color(chip.on ? t.accent : t.border)
      .bg(chip.on ? t.selected : t.background)
      .text_size(11.5)
      .text_color(chip.on ? t.foreground : chip.add ? t.dim : t.muted)
      .cursor_pointer()
      .tab_index(0)
      .hover((style) => style.border_color(chip.on ? t.accent : t.input).text_color(t.foreground))
      .focus((style) => style.border_color(t.accent).text_color(t.foreground))
      .when(Boolean(chip.tooltip), (el) => el.tooltip(chip.tooltip))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        press(cx);
      })
      .on_key_down(pressOnKey(press))
      .child(chip.on ? `✓ ${chip.label}` : chip.label);
  }

  /**
   * A button of the dialog: "primary" (the accent, for Save), "plain" (quiet words) or "icon" (the ✕).
   * A Tab stop: Enter or Space presses it.
   * @param {object} t The theme.
   * @param {string} name Its id's end.
   * @param {string} label Its words.
   * @param {(cx: object) => void} press What it does.
   * @param {"primary" | "plain" | "icon"} kind Its look.
   * @param {string | null} [tooltip] Its tooltip.
   * @param {boolean} [off] Whether it is off, drawn faint and not pressable.
   * @returns {object}
   */
  button(t, name, label, press, kind, tooltip = null, off = false) {
    const primary = kind === "primary";
    const act = (cx) => {
      if (!off) press(cx);
    };
    return h_flex()
      .id(`fd-${name}`)
      .flex_none()
      .h(kind === "icon" ? 24 : 28)
      .px(kind === "icon" ? 7 : primary ? 14 : 10)
      .items_center()
      .justify_center()
      .rounded(6)
      .text_size(12)
      .when(primary, (el) => el.font_semibold().bg(t.accent).text_color(t.accent_foreground ?? t.background))
      .when(!primary, (el) => el.text_color(t.muted).hover((style) => style.bg(t.hover).text_color(t.foreground)))
      .when(off, (el) => el.opacity(0.5))
      .cursor_pointer()
      .tab_index(0)
      .focus((style) => (primary ? style.opacity(0.85) : style.bg(t.hover).text_color(t.foreground)))
      .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        act(cx);
      })
      .on_key_down(pressOnKey(act))
      .child(label);
  }
}
