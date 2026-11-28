// Settings > Updates: a row for herdr-alp (the layout, theme and mods in Herdr's home) and one
// for the alp Claude plugin. Nothing is read from GitHub until you press Check for updates; the
// last check is kept, so the page looks the same when you come back. Update asks first, in the
// page, and herdr-alp's Update never touches your clone.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking } from "herdr";
import { tildePath } from "./config.js";
import { Chip, Note, TextButton, formatDate, formatTime, openUrl, warningColor } from "./ui.js";
import {
  RELEASES_URL,
  announceResult,
  changedInPlace,
  check,
  isDevBuild,
  isNewer,
  readCheck,
  readInstalled,
  readPlugin,
  readResult,
  startUpdate,
  updatePlugin,
} from "./updates-data.js";

/** How many changed files the confirmation lists before "and N more". */
const LISTED_FILES = 5;
/** How long to wait for the updater's result when Alp doesn't reload, in milliseconds. */
const RESULT_WAIT = 180000;

/**
 * What the page shows in the demo: an update waiting, with notes.
 * @returns {{ installed: object, check: object }}
 */
function demoState() {
  const day = 86400000;
  return {
    installed: { version: "0.6.0", from: "release", installedAt: new Date(Date.now() - 6 * day).toISOString() },
    check: {
      checkedAt: new Date().toISOString(),
      error: null,
      plugin: { state: "marketplace", version: "0.6.0" },
      releases: [
        {
          tag: "v0.7.0",
          date: new Date(Date.now() - day).toISOString(),
          url: RELEASES_URL,
          notes: [
            {
              group: "Added",
              items: [
                { scope: "files", text: "send a Bruno request from the Files panel (#52)" },
                { scope: "updates", text: "an Updates page in Settings (#45)" },
              ],
            },
            {
              group: "Fixed",
              items: [{ scope: "herds", text: "a dragged card no longer drops behind its herd (#51)" }],
            },
          ],
        },
        { tag: "v0.6.0", date: new Date(Date.now() - 7 * day).toISOString(), url: RELEASES_URL, notes: [] },
      ],
    },
  };
}

/**
 * A short "when" for a time: "today 10:42", or its date.
 * @param {string} iso The time.
 * @returns {string}
 */
function when(iso) {
  const time = Date.parse(iso);
  const sameDay = new Date(time).toDateString() === new Date().toDateString();
  return sameDay ? `today ${formatTime(time)}` : formatDate(time);
}

export class UpdatesPage {
  constructor() {
    /** Whether the saved check, install record and last result were read. */
    this.loaded = false;
    this.installed = null;
    this.check = null;
    this.result = null;
    this.checking = false;
    /** The release notes shown: herdr-alp's row toggles them. */
    this.notesOpen = false;
    /** The row asking "Update?": "alp", "plugin" or null. */
    this.armed = null;
    /** Files edited in Herdr's home that Update would overwrite, read when Update is pressed. */
    this.changed = [];
    /** The row updating now: "alp", "plugin" or null. */
    this.updating = null;
    /** The last line to show under a row: `{ row, text, error }`. */
    this.message = null;
    /** The demo shows made-up state and changes nothing. */
    this.demo = false;
    // Every Alp tab makes one of these as it starts, so an update that just ended (and reloaded
    // Alp) gets its toast here, once.
    if (!checking()) announceResult().catch(() => {});
  }

  /**
   * Reads the saved state once: the install record, the last check and the last update. In the
   * demo, made-up state instead.
   * @param {object} cx The context, to redraw.
   * @param {boolean} demo Whether Settings shows the demo.
   * @returns {void}
   */
  ensureLoaded(cx, demo) {
    if (this.loaded) return;
    this.loaded = true;
    this.demo = demo;
    if (demo) {
      Object.assign(this, demoState());
      return;
    }
    cx.spawn(async (cx) => {
      [this.installed, this.check, this.result] = await Promise.all([readInstalled(), readCheck(), readResult()]);
      cx.notify();
    });
  }

  /** The releases newer than what is installed, newest first. */
  newer() {
    return (this.check?.releases ?? []).filter((release) => isNewer(release.tag, this.installed?.version));
  }

  /**
   * Checks GitHub and the plugin, and reads the install record again.
   * @param {object} cx The context.
   * @returns {void}
   */
  runCheck(cx) {
    if (this.checking) return;
    if (this.demo) {
      this.check = { ...this.check, checkedAt: new Date().toISOString() };
      cx.notify();
      return;
    }
    this.checking = true;
    this.message = null;
    this.armed = null;
    cx.notify();
    cx.spawn(async (cx) => {
      [this.check, this.installed] = await Promise.all([
        check().catch((error) => ({
          checkedAt: new Date().toISOString(),
          releases: [],
          error: String(error?.message ?? error),
        })),
        readInstalled(),
      ]);
      this.checking = false;
      cx.notify();
    });
  }

  /**
   * Asks before updating a row; for herdr-alp it first reads which files were edited in place.
   * @param {"alp" | "plugin"} row The row.
   * @param {object} cx The context.
   * @returns {void}
   */
  arm(row, cx) {
    this.armed = row;
    this.message = null;
    this.changed = [];
    cx.notify();
    if (row !== "alp" || this.demo) return;
    cx.spawn(async (cx) => {
      this.changed = await changedInPlace().catch(() => []);
      cx.notify();
    });
  }

  /**
   * Installs the newest release into Herdr's home. Alp reloads partway through, and the
   * reloaded page shows the result; if it doesn't reload, this waits for the result itself.
   * @param {string} tag The release.
   * @param {object} cx The context.
   * @returns {void}
   */
  updateAlp(tag, cx) {
    this.armed = null;
    if (this.demo) {
      this.message = { row: "alp", text: "Demo: nothing was installed." };
      cx.notify();
      return;
    }
    this.updating = "alp";
    cx.notify();
    const started = Date.now();
    cx.spawn(async (cx) => {
      try {
        await startUpdate(tag);
      } catch (error) {
        this.updating = null;
        this.message = { row: "alp", text: `Couldn't start the update: ${error?.message ?? error}`, error: true };
        cx.notify();
        return;
      }
      while (Date.now() - started < RESULT_WAIT) {
        await cx.sleep(1000);
        const result = await readResult();
        if (result && Date.parse(result.at) >= started - 1000) {
          this.result = result;
          this.installed = await readInstalled();
          break;
        }
      }
      this.updating = null;
      cx.notify();
    });
  }

  /**
   * Updates the plugin through Claude Code, then reads its version again.
   * @param {object} cx The context.
   * @returns {void}
   */
  updatePlugin(cx) {
    this.armed = null;
    if (this.demo) {
      this.message = { row: "plugin", text: "Demo: nothing was updated." };
      cx.notify();
      return;
    }
    this.updating = "plugin";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await updatePlugin();
        const plugin = await readPlugin();
        this.check = { ...this.check, plugin };
        this.message = {
          row: "plugin",
          text: `Updated to ${plugin.version}. Restart running Claude sessions to load it.`,
        };
      } catch (error) {
        this.message = { row: "plugin", text: `Couldn't update the plugin: ${error?.message ?? error}`, error: true };
      }
      this.updating = null;
      cx.notify();
    });
  }

  // --- drawing ---------------------------------------------------------------------------------

  /**
   * The page, as the scroll area's children.
   * @param {object} t The theme.
   * @param {object} form The settings form, for its page title and buttons.
   * @returns {object[]} The page's parts.
   */
  parts(t, form) {
    const checked = this.check ? `checked ${when(this.check.checkedAt)}` : "not checked yet";
    return [
      h_flex()
        .w_full()
        .gap(10)
        .items_center()
        .child(form.pageTitle(t, "Updates", [Chip(checked, { color: t.dim })]))
        .child(div().flex_1())
        .child(
          form.primaryButton(
            t,
            "up-check",
            this.checking ? "Checking…" : "Check for updates",
            !this.checking && !this.updating,
            (cx) => this.runCheck(cx),
          ),
        ),
      this.alpRow(t, form),
      this.pluginRow(t, form),
      h_flex()
        .w_full()
        .gap(10)
        .items_center()
        .child(div().flex_1().min_w(0).child(Note("Checks run only when you press Check for updates.")))
        .child(TextButton("up-releases", "All releases on GitHub", () => openUrl(RELEASES_URL))),
    ];
  }

  /**
   * One row: its name and pills, a line about what is installed, its buttons, and what goes
   * under it (notes, the confirmation, messages).
   * @param {object} t The theme.
   * @param {{ name: string, pills: object[], meta: string, buttons: object[], below: object[] }} row
   * @returns {object} The row.
   */
  row(t, { name, pills, meta, buttons, below }) {
    return v_flex()
      .w_full()
      .p(12)
      .gap(8)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .w_full()
          .gap(10)
          .items_center()
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(3)
              .child(
                h_flex()
                  .gap(8)
                  .items_center()
                  .child(div().text_size(13).font_semibold().text_color(t.foreground).child(name))
                  .children(pills),
              )
              .child(div().text_size(11.5).text_color(t.dim).child(meta)),
          )
          .children(buttons),
      )
      .children(below);
  }

  /** The message under a row, when it is that row's. */
  messageFor(t, row) {
    if (this.message?.row !== row) return [];
    return [Note(this.message.text, this.message.error ? t.blocked : t.done)];
  }

  /**
   * The confirmation under a row: what will happen, then Cancel and the action.
   * @param {object} t The theme.
   * @param {object} form The settings form, for its buttons.
   * @param {string[]} lines What will happen.
   * @param {string} label The action's label.
   * @param {(cx: object) => void} onConfirm The action.
   * @returns {object} The box.
   */
  confirmBox(t, form, lines, label, onConfirm) {
    return v_flex()
      .w_full()
      .p(10)
      .gap(6)
      .rounded(6)
      .bg(t.hover)
      .children(lines.map((line) => div().text_size(12).text_color(t.foreground).child(line)))
      .child(
        h_flex()
          .pt(2)
          .gap(8)
          .items_center()
          .child(div().flex_1())
          .child(
            TextButton("up-cancel", "Cancel", (cx) => {
              this.armed = null;
              cx.notify();
            }),
          )
          .child(form.primaryButton(t, "up-confirm", label, true, onConfirm)),
      );
  }

  /** herdr-alp's row: the installed version and where it came from, notes, Update. */
  alpRow(t, form) {
    const installed = this.installed;
    const dev = isDevBuild(installed);
    const newer = this.newer();
    const latest = newer[0];
    const pills = [];
    if (this.check?.error) pills.push(Chip("Couldn't check", { color: t.blocked }));
    else if (latest) pills.push(Chip(`${latest.tag} available`, { color: t.accent }));
    else if (this.check?.releases.length) pills.push(Chip("Up to date", { color: t.done }));
    else if (this.check) pills.push(Chip("No releases yet", { color: t.dim }));
    if (dev) {
      pills.push(
        Chip("dev build", {
          color: warningColor(t),
          id: "up-dev",
          tooltip: `Installed with sync.sh from ${tildePath(installed.from)} at ${installed.describe ?? "an unknown commit"}`,
        }),
      );
    }
    const source = !installed
      ? "installed before versions were recorded"
      : dev
        ? `installed v${installed.version} from ${tildePath(installed.from)}${installed.branch ? ` on ${installed.branch}` : ""}`
        : `installed v${installed.version} from a release, ${when(installed.installedAt)}`;
    const buttons = [];
    if (latest) {
      buttons.push(
        TextButton("up-notes", this.notesOpen ? "Hide notes" : "Notes", (cx) => {
          this.notesOpen = !this.notesOpen;
          cx.notify();
        }),
      );
      if (this.updating !== "alp") {
        buttons.push(
          form.primaryButton(t, "up-alp", "Update", !this.updating && this.armed !== "alp", (cx) =>
            this.arm("alp", cx),
          ),
        );
      }
    }
    const below = [];
    if (this.check?.error) below.push(Note(`GitHub said: ${this.check.error}`, t.blocked));
    if (latest && this.notesOpen) below.push(this.notes(t, newer));
    if (latest && this.armed === "alp") {
      const lines = [`Install ${latest.tag} into Herdr? Alp reloads when it's done. Your clone isn't touched.`];
      if (dev) lines.push(`This replaces your dev build from ${tildePath(installed.from)}.`);
      if (this.changed.length) {
        const listed = this.changed.slice(0, LISTED_FILES).join(", ");
        const more = this.changed.length - LISTED_FILES;
        lines.push(
          `These files were edited in Herdr's home and will be overwritten: ${listed}${more > 0 ? ` and ${more} more` : ""}. To keep them, run ./sync.sh pull in your clone first.`,
        );
      }
      below.push(this.confirmBox(t, form, lines, `Update to ${latest.tag}`, (cx) => this.updateAlp(latest.tag, cx)));
    }
    if (this.updating === "alp")
      below.push(Note(`Installing ${latest?.tag ?? "the release"}… Alp reloads when it's done.`));
    below.push(...this.resultNote(t), ...this.messageFor(t, "alp"));
    return this.row(t, { name: "herdr-alp", pills, meta: `${source} · layout, theme and mods`, buttons, below });
  }

  /** The last update's outcome, until the next check. */
  resultNote(t) {
    const result = this.result;
    if (!result || (this.check && Date.parse(result.at) < Date.parse(this.check.checkedAt))) return [];
    if (result.ok) return [Note(`Updated to ${result.tag}, ${when(result.at)}.`, t.done)];
    return [
      Note(`Couldn't update to ${result.tag}. The end of its output:`, t.blocked),
      div()
        .text_size(11.5)
        .text_color(t.muted)
        .font_family("JetBrains Mono")
        .child(result.log || "(no output)"),
    ];
  }

  /**
   * The notes of every release newer than the installed one.
   * @param {object} t The theme.
   * @param {object[]} releases The releases, newest first.
   * @returns {object} The notes.
   */
  notes(t, releases) {
    return v_flex()
      .w_full()
      .pt(8)
      .gap(8)
      .border_t_1()
      .border_color(t.border)
      .children(
        releases.map((release) =>
          v_flex()
            .gap(4)
            .child(
              h_flex()
                .gap(8)
                .child(div().text_size(12).font_semibold().text_color(t.foreground).child(release.tag))
                .child(
                  div()
                    .text_size(11.5)
                    .text_color(t.dim)
                    .child(formatDate(Date.parse(release.date))),
                ),
            )
            .when(!release.notes.length, (el) => el.child(Note("No notes for this release.")))
            .children(
              release.notes.map((group) =>
                v_flex()
                  .gap(2)
                  .child(div().pt(2).text_size(11).font_semibold().text_color(t.dim).child(group.group.toUpperCase()))
                  .children(
                    group.items.map((item) =>
                      h_flex()
                        .gap(4)
                        .items_start()
                        .text_size(12)
                        .text_color(t.muted)
                        .child(div().flex_none().child("·"))
                        .when(Boolean(item.scope), (el) =>
                          el.child(div().flex_none().font_semibold().text_color(t.foreground).child(`${item.scope}:`)),
                        )
                        .child(div().flex_1().min_w(0).child(item.text)),
                    ),
                  ),
              ),
            ),
        ),
      );
  }

  /** The plugin's row: where it loads from, its version, and Update when it came from the marketplace. */
  pluginRow(t, form) {
    const plugin = this.check?.plugin;
    const latest = this.check?.releases[0];
    const pills = [];
    const buttons = [];
    const below = [];
    let meta = "Check for updates reads it from Claude Code";
    if (plugin?.state === "no-claude") meta = "Claude Code isn't installed";
    else if (plugin?.state === "missing") meta = "Not installed. To add it: claude plugin install alp@herdr-alp";
    else if (plugin?.state === "clone") {
      pills.push(Chip("from your clone", { color: t.dim }));
      meta = `version ${plugin.version}, loaded from ${tildePath(plugin.path ?? "a folder")}: it runs that folder, so there's nothing to update`;
    } else if (plugin?.state === "marketplace") {
      meta = `installed ${plugin.version} · from the herdr-alp marketplace`;
      const available = latest && isNewer(latest.tag, plugin.version);
      if (available) {
        pills.push(Chip(`${latest.tag.replace(/^v/, "")} available`, { color: t.accent }));
        if (this.updating !== "plugin") {
          buttons.push(
            form.primaryButton(t, "up-plugin", "Update", !this.updating && this.armed !== "plugin", (cx) =>
              this.arm("plugin", cx),
            ),
          );
        }
      } else if (latest) pills.push(Chip("Up to date", { color: t.done }));
      if (available && this.armed === "plugin") {
        below.push(
          this.confirmBox(
            t,
            form,
            [
              `Update the alp plugin to ${latest.tag.replace(/^v/, "")}? Running Claude sessions load it when they restart.`,
            ],
            "Update the plugin",
            (cx) => this.updatePlugin(cx),
          ),
        );
      }
    }
    if (this.updating === "plugin") below.push(Note("Updating the plugin…"));
    below.push(...this.messageFor(t, "plugin"));
    return this.row(t, { name: "Claude plugin alp", pills, meta, buttons, below });
  }
}
