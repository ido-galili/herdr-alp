// Settings > Updates: a row for herdr-alp (the layout, theme and mods in Herdr's home) and one
// for the alp Claude plugin. Nothing is read from GitHub until you press Check for updates; the
// last check is kept, so the page looks the same when you come back. The update is an agent's:
// Update with Claude opens a Claude tab with the steps, and Copy prompt puts them on the
// clipboard for any agent. Neither touches your clone.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, home, run, spaces } from "herdr";
import { tildePath } from "./config.js";
import { Chip, Note, TextButton, formatDate, formatTime, openUrl, warningColor } from "./ui.js";
import { RELEASES_URL, check, isDevBuild, isNewer, readCheck, readInstalled, updatePrompt } from "./updates-data.js";

/** The name of the Claude tab Update with Claude opens. */
const TAB_NAME = "Update Alp";

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
    /** Whether the saved check and install record were read. */
    this.loaded = false;
    this.installed = null;
    this.check = null;
    this.checking = false;
    /** The release notes shown: herdr-alp's row toggles them. */
    this.notesOpen = false;
    /** The last line to show under a row: `{ row, text, error }`. */
    this.message = null;
    /** The demo shows made-up state and opens nothing. */
    this.demo = false;
  }

  /**
   * Reads the saved state once: the install record and the last check. In the demo, made-up
   * state instead.
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
      [this.installed, this.check] = await Promise.all([readInstalled(), readCheck()]);
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

  /** The plugin's version to update to, or null when it's up to date or not from the marketplace. */
  pluginTarget() {
    const plugin = this.check?.plugin;
    const latest = this.check?.releases[0];
    if (plugin?.state !== "marketplace" || !latest || !isNewer(latest.tag, plugin.version)) return null;
    return latest.tag.replace(/^v/, "");
  }

  /**
   * The update's prompt: herdr-alp's newer releases (none for the plugin's row) and the plugin.
   * @param {"alp" | "plugin"} row The row it's for.
   * @returns {string}
   */
  prompt(row) {
    return updatePrompt({
      releases: row === "alp" ? this.newer() : [],
      installed: this.installed,
      plugin: this.check?.plugin ?? null,
      pluginTarget: this.pluginTarget(),
      herdrHome: appHome(),
      userHome: home(),
    });
  }

  /**
   * Opens a Claude tab in the space you're in, with the update's prompt as its task.
   * @param {"alp" | "plugin"} row The row.
   * @param {object} cx The context.
   * @returns {void}
   */
  updateWithClaude(row, cx) {
    if (this.demo) {
      this.message = { row, text: "Demo: nothing was opened." };
    } else {
      const space = spaces().find((candidate) => candidate.active);
      run("tab.new", {
        name: TAB_NAME,
        ...(space ? { space: space.id } : {}),
        folder: home(),
        argv: ["claude"],
        task: this.prompt(row),
        focus: true,
      });
      this.message = {
        row,
        text: `Opened the "${TAB_NAME}" Claude tab with the steps. It tells you what changes and asks before overwriting anything you edited.`,
      };
    }
    cx.notify();
  }

  /**
   * Puts the update's prompt on the clipboard, for any agent.
   * @param {"alp" | "plugin"} row The row.
   * @param {object} cx The context.
   * @returns {void}
   */
  copyPrompt(row, cx) {
    cx.write_to_clipboard(this.prompt(row));
    this.message = { row, text: "Copied the update prompt. Paste it into your agent." };
    cx.notify();
  }

  /**
   * A row's two ways to update: Copy prompt, and Update with Claude when Claude Code is there.
   * @param {object} t The theme.
   * @param {object} form The settings form, for its buttons.
   * @param {"alp" | "plugin"} row The row.
   * @returns {object[]} The buttons.
   */
  updateButtons(t, form, row) {
    const buttons = [TextButton(`up-copy-${row}`, "Copy prompt", (cx) => this.copyPrompt(row, cx))];
    if (this.check?.plugin?.state !== "no-claude") {
      buttons.push(
        form.primaryButton(t, `up-claude-${row}`, "Update with Claude", true, (cx) => this.updateWithClaude(row, cx)),
      );
    }
    return buttons;
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
          form.primaryButton(t, "up-check", this.checking ? "Checking…" : "Check for updates", !this.checking, (cx) =>
            this.runCheck(cx),
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

  /** herdr-alp's row: the installed version and where it came from, notes, and the two ways to update. */
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
      buttons.push(...this.updateButtons(t, form, "alp"));
    }
    const below = [];
    if (this.check?.error) below.push(Note(`GitHub said: ${this.check.error}`, t.blocked));
    if (latest && this.notesOpen) below.push(this.notes(t, newer));
    if (latest && dev)
      below.push(
        Note(`The release replaces your dev build from ${tildePath(installed.from)}; the clone isn't touched.`),
      );
    below.push(...this.messageFor(t, "alp"));
    return this.row(t, { name: "herdr-alp", pills, meta: `${source} · layout, theme and mods`, buttons, below });
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

  /**
   * The plugin's row: where it loads from and its version. When it's behind, herdr-alp's prompt
   * updates it too; on its own, when herdr-alp is up to date, it gets the two buttons itself.
   */
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
      const target = this.pluginTarget();
      if (target) {
        pills.push(Chip(`${target} available`, { color: t.accent }));
        if (this.newer().length) below.push(Note("herdr-alp's update above updates the plugin too."));
        else buttons.push(...this.updateButtons(t, form, "plugin"));
      } else if (latest) pills.push(Chip("Up to date", { color: t.done }));
    }
    below.push(...this.messageFor(t, "plugin"));
    return this.row(t, { name: "Claude plugin alp", pills, meta, buttons, below });
  }
}
