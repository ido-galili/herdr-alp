// Basecamp's Run tab: the focused workspace's runs from Alp's config (your file, the repo's
// .herdr/alp.json and your .herdr/alp.local.json, merged), under their sections, each with a play
// button (a stop square while it runs) and a ⋯ menu. A row whose run has a session shows its state
// and selects it in the bottom panel; Output beside the workspace's name shows or hides that panel. Runs
// that can't run here fold away at the end, with the reason on each. Runs the person hides fold
// away too, remembered per repository in this copy's localStorage. With VS Code configs in the
// repo, Import from VS Code copies the ones the person picks into the config.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import {
  checking,
  focused,
  home,
  layout,
  notify,
  openOverlay,
  panes,
  run,
  setShared,
  shared,
  spaces,
  theme,
  watchFolder,
  window,
} from "herdr";
import { findWorkspace, loadEntries, migrateCommands } from "./config.js";
import { neededInputs, sessionFor, startEntry, stopSession } from "./runner.js";
import { find, PANEL_ID, showSession } from "./panel.js";

export const LAUNCH_KEY = "alp.runs.launch";
export const VISIBILITY_KEY = "alp.runs.visibility";
const HIDDEN_STORAGE = "hidden";
const VISIBILITY_STORAGE = "visibilityAt";
const VISIBILITY_QUEUE_LIMIT = 50;
export const STAMP_KEY = "alp.runs.stamp";
export const ANSWERS_KEY = "alp.runs.inputs";
const PLAY_ICON = "mods/alp-runs/play.svg";
const STOP_ICON = "mods/alp-runs/stop.svg";
const OUTPUT_ICON = "mods/alp-runs/terminal.svg";
const PLUS_ICON = "mods/workspace-chrome/plus.svg";
const RELOAD_ICON = "mods/alp-runs/reload.svg";
/** A second stop this soon after the first terminates the run instead of interrupting it. */
const ESCALATE_MS = 4000;
/** How many rows can take the keyboard on their ⋯ (focus handles are made once, in `init`). */
const FOCUS_POOL = 64;
/** How a run's origin is marked after its name; the repo's runs carry no mark. */
const ORIGIN_MARK = { you: "me everywhere", local: "just me" };

/**
 * Opens the form that adds a run, or edits one.
 * @param {string | null} root The workspace root, or null outside a repository.
 * @param {{ name: string, layer: string } | null} editing The run to edit and the file it's in.
 * @returns {void}
 */
export function openSaveForm(root, editing = null) {
  openOverlay({
    mod: "alp-runs",
    kind: "dialog",
    width: 480,
    height: 420,
    props: { part: "save", root, ...(editing ?? {}) },
  });
}

/**
 * Opens the dialog that imports VS Code launch configs and tasks.
 * @param {string} root The workspace root.
 * @returns {void}
 */
export function openImport(root) {
  openOverlay({ mod: "alp-runs", kind: "dialog", width: 560, height: 600, props: { part: "import", root } });
}

/**
 * Folders that say where the person works now, best first: the focused terminal's, the active
 * tab's terminals', the active space's other terminals', then the space's own folder.
 * @returns {string[]}
 */
function candidateFolders() {
  const space = spaces().find((candidate) => candidate.active);
  const tabs = space?.tabs ?? [];
  const activeTab = tabs.find((tab) => tab.active)?.id;
  const spaceTabs = new Set(tabs.map((tab) => tab.id));
  const paneFolders = (filter) =>
    panes()
      .filter((pane) => pane.cwd && filter(pane))
      .map((pane) => pane.cwd);
  const folders = [
    focused()?.cwd,
    ...paneFolders((pane) => pane.tab === activeTab),
    ...paneFolders((pane) => spaceTabs.has(pane.tab)),
    space?.folder || home(),
  ];
  return [...new Set(folders.filter(Boolean))];
}

/** A number kept in localStorage, or 0 when it is absent or can't be read. */
function readNumber(name) {
  try {
    return Number(localStorage.getItem(name) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** The hidden entries' keys by repository, from localStorage; empty when it can't be read. */
function readHidden() {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_STORAGE) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * The glyph and color for a session's state.
 * @param {object} t The theme.
 * @param {object | undefined} session From `sessions()`.
 * @returns {{ glyph: string, color: string } | null}
 */
export function sessionMark(t, session) {
  if (!session) return null;
  if (session.running) return { glyph: "●", color: t.working };
  return session.exit === 0 ? { glyph: "✓", color: t.done } : { glyph: "✗", color: t.blocked };
}

/**
 * The input dialog's height: a field per promptString, a chip row per pickString option (long
 * labels wrap one to a row), at most 640px.
 * @param {object[]} inputs The input definitions.
 * @returns {number}
 */
const dialogHeight = (inputs) =>
  Math.min(
    640,
    150 +
      inputs.reduce(
        (sum, input) => sum + (input.type === "pickString" ? 34 + (input.options ?? []).length * 40 : 78),
        0,
      ),
  );

/**
 * Starts an entry, asking for its inputs first when it has any, and shows its session.
 * @param {object} entry The entry.
 * @param {object} catalog From `loadEntries`.
 * @param {object} workspace From `findWorkspace`.
 * @param {Record<string, string> | null} answers The inputs' answers, or null to ask for them.
 * @returns {Promise<void>}
 */
export async function launch(entry, catalog, workspace, answers) {
  const inputs = neededInputs(entry, catalog);
  if (answers == null && inputs.length) {
    openOverlay({
      mod: "alp-runs",
      kind: "dialog",
      width: 440,
      height: dialogHeight(inputs),
      props: { part: "input", key: entry.key, root: workspace.root },
    });
    return;
  }
  try {
    const address = await startEntry(entry, catalog, workspace, answers ?? {});
    if (address) showSession(address);
  } catch (error) {
    notify({ title: `${entry.name} didn't start`, body: String(error?.message ?? error), level: "error" });
  }
}

export class ListPart {
  init(cx) {
    this.folder = null;
    this.workspace = null;
    this.catalog = null;
    this.stamp = shared(STAMP_KEY) ?? null;
    this.launchId = shared(LAUNCH_KEY)?.id ?? null;
    this.pending = new Set();
    this.showBlocked = false;
    this.showHidden = false;
    this.hidden = readHidden();
    this.visibilityAt = readNumber(VISIBILITY_STORAGE);
    this.watchToken = 0;
    this.hoverKey = null;
    this.stopAt = new Map();
    this.focusPool = Array.from({ length: FOCUS_POOL }, () => cx.focus_handle());
    this.focusByKey = new Map();
    this.filter = InputState.new({ placeholder: "Filter" });
    this.filter.on("change", (_event, cx) => cx.notify());
    this.sync(cx);
  }

  /** Reloads when the folder, the saved commands or a launch request changed. */
  sync(cx) {
    const folders = candidateFolders();
    const folder = folders.join("\n");
    const stamp = shared(STAMP_KEY) ?? null;
    if (folder !== this.folder || stamp !== this.stamp) {
      const force = stamp !== this.stamp;
      this.folder = folder;
      this.stamp = stamp;
      this.load(cx, force);
    }
    this.applyVisibilityRequests();
    const request = shared(LAUNCH_KEY);
    if (request?.id && request.id !== this.launchId) {
      this.launchId = request.id;
      this.handleRequest(cx, request);
    }
  }

  /** Finds the folder's workspace and reads its entries when the workspace changed. */
  load(cx, force = false) {
    const folders = this.folder.split("\n");
    cx.spawn(async (cx) => {
      // Saved commands from before Alp's config move into it once (never during `herdr-app check`).
      if (!this.migrated && !checking()) {
        this.migrated = true;
        await migrateCommands().catch((error) => console.log(`alp-runs: saved commands not moved: ${error}`));
      }
      let workspace = null;
      for (const folder of folders) {
        workspace = await findWorkspace(folder);
        if (workspace.repo) break;
      }
      if (!force && workspace.root === this.workspace?.root && this.catalog) return;
      this.workspace = workspace;
      this.catalog = await loadEntries(workspace, window()?.platform ?? "macos");
      if (this.watchRoot !== workspace.root) this.watch(cx, workspace.root);
      cx.notify();
    });
  }

  /** Reads the entries again whenever the workspace's .herdr folder changes. */
  watch(cx, root) {
    this.watchRoot = root;
    const token = ++this.watchToken;
    this.watchHandle?.cancel();
    cx.spawn(async (cx) => {
      while (token === this.watchToken) {
        this.watchHandle = watchFolder(`${root}/.herdr`);
        const changed = await this.watchHandle.catch(() => null);
        if (!changed?.length || token !== this.watchToken) return;
        this.catalog = await loadEntries(this.workspace, window()?.platform ?? "macos");
        cx.notify();
      }
    });
  }

  /** Starts what the input dialog asked for, with its answers. */
  handleRequest(cx, request) {
    cx.spawn(async (cx) => {
      const sameWorkspace = this.workspace?.root === request.root && this.catalog;
      const workspace = sameWorkspace ? this.workspace : await findWorkspace(request.root);
      const catalog = sameWorkspace ? this.catalog : await loadEntries(workspace, window()?.platform ?? "macos");
      const entry = catalog.runs.find((item) => item.key === request.key);
      if (entry) await this.start(cx, entry, catalog, workspace, request.answers);
    });
  }

  /** Starts an entry, marking it as starting until it has a session or fails. */
  async start(cx, entry, catalog, workspace, answers) {
    this.pending.add(entry.key);
    cx.notify();
    await launch(entry, catalog, workspace, answers);
    this.pending.delete(entry.key);
    cx.notify();
  }

  /** The keys of the entries hidden in this workspace's repository (a worktree shares its main checkout's). */
  hiddenKeys() {
    return new Set(this.workspace ? (this.hidden[this.workspace.mainRoot] ?? []) : []);
  }

  /**
   * Applies the hide and show requests the menu queued since the last one applied. The queue
   * holds them while this copy isn't rendering, such as while Basecamp is hidden.
   */
  applyVisibilityRequests() {
    const queue = shared(VISIBILITY_KEY);
    if (!Array.isArray(queue)) return;
    const pending = queue.filter((request) => request.at > this.visibilityAt);
    if (!pending.length) return;
    pending.forEach((request) => this.setHidden(request.repo, request.key, request.hidden));
    this.visibilityAt = Math.max(...pending.map((request) => request.at));
    try {
      localStorage.setItem(VISIBILITY_STORAGE, String(this.visibilityAt));
    } catch (error) {
      console.log(`alp-runs: hide requests not marked as applied: ${error}`);
    }
  }

  /** Hides or shows an entry in a repository, and remembers it. */
  setHidden(repo, key, hidden) {
    const keys = new Set(this.hidden[repo] ?? []);
    if (hidden) keys.add(key);
    else keys.delete(key);
    this.hidden = { ...this.hidden, [repo]: [...keys] };
    if (!keys.size) delete this.hidden[repo];
    try {
      localStorage.setItem(HIDDEN_STORAGE, JSON.stringify(this.hidden));
    } catch (error) {
      console.log(`alp-runs: hidden entries not saved: ${error}`);
    }
  }

  /**
   * A fold at the end of the list: a toggle with a count, then its rows while open.
   * @param {object} t The theme.
   * @param {string} id The toggle's element id.
   * @param {string} label What the rows are, after the count.
   * @param {object[]} rows The rows it folds.
   * @param {boolean} open Whether it's open.
   * @param {() => void} onToggle Flips it.
   * @returns {object[]} The toggle, then the rows while open; nothing without rows.
   */
  fold(t, id, label, rows, open, onToggle) {
    if (!rows.length) return [];
    const toggle = h_flex()
      .id(id)
      .px(10)
      .pt(12)
      .gap(6)
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((style) => style.text_color(t.muted))
      .on_click((_event, cx) => {
        onToggle();
        cx.notify();
      })
      .child(open ? "▾" : "▸")
      .child(`${rows.length} ${label}`);
    return [toggle, ...(open ? rows : [])];
  }

  /**
   * The focus handle for a row's ⋯, taken from the pool the first time the row shows.
   * @param {string} key The entry's key.
   * @returns {object | null} The handle, or null once the pool is used up.
   */
  focusFor(key) {
    if (!this.focusByKey.has(key) && this.focusByKey.size < this.focusPool.length) {
      this.focusByKey.set(key, this.focusPool[this.focusByKey.size]);
    }
    return this.focusByKey.get(key) ?? null;
  }

  /**
   * Stops a running session: Ctrl-C first, then a terminate when pressed again soon after.
   * @param {object} cx The event's context.
   * @param {object} entry The run.
   * @param {object} session Its session, from `sessionFor`.
   * @returns {void}
   */
  stop(cx, entry, session) {
    const escalate = Date.now() - (this.stopAt.get(entry.key) ?? 0) < ESCALATE_MS;
    this.stopAt.set(entry.key, Date.now());
    cx.spawn(async () => stopSession(session, escalate ? "TERM" : "INT"));
    cx.notify();
  }

  /**
   * One entry: its session's state, its name, "running" and a stop square while it runs (else
   * its play button), and a ⋯ that shows on hover or keyboard focus and opens the run's menu.
   * @param {object} t The theme.
   * @param {object} entry The run.
   * @param {boolean} [hidden] Whether the person hid it.
   * @returns {object}
   */
  row(t, entry, hidden = false) {
    const session = this.workspace ? sessionFor(entry.key, this.workspace.root) : null;
    const running = Boolean(session?.running);
    const mark = sessionMark(t, session);
    const starting = this.pending.has(entry.key);
    const play = (_event, cx) => {
      cx.stop_propagation();
      if (running) this.stop(cx, entry, session);
      else cx.spawn(async (cx) => this.start(cx, entry, this.catalog, this.workspace, null));
    };
    const menu = (_event, cx) => {
      cx.stop_propagation();
      openOverlay({
        mod: "alp-runs",
        kind: "popup",
        width: 270,
        height: 12 + 3 * 34,
        props: {
          part: "menu",
          key: entry.key,
          name: entry.name,
          origin: entry.origin,
          root: this.workspace.root,
          repo: this.workspace.mainRoot,
          hidden,
        },
      });
    };
    const focus = this.focusFor(entry.key);
    const showMore = this.hoverKey === entry.key || Boolean(focus?.is_focused());
    const terminating = running && Date.now() - (this.stopAt.get(entry.key) ?? 0) < ESCALATE_MS;
    const originMark = ORIGIN_MARK[entry.origin];
    return h_flex()
      .id(`run-${entry.key}`)
      .w_full()
      .h(28)
      .px(10)
      .gap(8)
      .items_center()
      .text_size(12)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .tooltip(entry.unsupported ? `Can't run here: it ${entry.unsupported}` : entry.name)
      .on_hover((hovered, cx) => {
        if (hovered) this.hoverKey = entry.key;
        else if (this.hoverKey === entry.key) this.hoverKey = null;
        cx.notify();
      })
      .on_click((event, cx) => (session ? showSession(session.address) : entry.unsupported ? null : play(event, cx)))
      .on_mouse_down("right", menu)
      .child(
        div()
          .w(12)
          .flex_none()
          .text_size(11.5)
          .text_color(mark?.color ?? t.dim)
          .child(mark?.glyph ?? ""),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(entry.unsupported ? t.dim : t.foreground)
          .child(entry.name),
      )
      .when(Boolean(originMark), (el) =>
        el.child(
          div()
            .id(`run-origin-${entry.key}`)
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .tooltip(entry.origin === "you" ? "From ~/.config/alp/alp.json" : "Changed in .herdr/alp.local.json")
            .child(originMark),
        ),
      )
      .when(running, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.working).child("running")))
      .when(!entry.unsupported, (el) =>
        el.child(
          h_flex()
            .id(`run-play-${entry.key}`)
            .flex_none()
            .size(22)
            .items_center()
            .justify_center()
            .rounded(5)
            .text_color(running ? t.blocked : t.accent)
            .hover((style) => style.bg(t.selected))
            .tooltip(
              running ? (terminating ? "Stop again: terminate" : `Stop ${entry.name} (Ctrl-C)`) : `Run ${entry.name}`,
            )
            .on_click(play)
            .child(
              starting
                ? div().text_size(11.5).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)
                : svg(running ? STOP_ICON : PLAY_ICON).size(running ? 13 : 11),
            ),
        ),
      )
      .child(
        h_flex()
          .id(`run-more-${entry.key}`)
          .flex_none()
          .size(22)
          .items_center()
          .justify_center()
          .rounded(5)
          .text_size(14)
          .text_color(t.muted)
          .opacity(showMore ? 1 : 0)
          .hover((style) => style.bg(t.selected).text_color(t.foreground))
          .focus((style) => style.opacity(1).bg(t.selected).text_color(t.foreground))
          .when(Boolean(focus), (el) =>
            el
              .track_focus(focus)
              .tab_index(0)
              .on_key_down((event, cx) => {
                if (event.key === "enter" || event.key === "space") menu(event, cx);
              }),
          )
          .tooltip(`Edit, hide or delete ${entry.name}`)
          .on_click(menu)
          .child("⋯"),
      );
  }

  /**
   * A section heading, in the config's own case.
   * @param {object} t The theme.
   * @param {string} title The section's name.
   * @returns {object}
   */
  heading(t, title) {
    return div().px(10).pt(10).pb(3).text_size(11.5).font_semibold().text_color(t.dim).child(title);
  }

  /**
   * A small text action in the list, like Import from VS Code.
   * @param {object} t The theme.
   * @param {string} id Element id.
   * @param {string} label What it says.
   * @param {(cx: object) => void} action What a click does.
   * @returns {object}
   */
  action(t, id, label, action) {
    return div()
      .id(id)
      .mx(10)
      .mt(8)
      .text_size(11.5)
      .text_color(t.accent)
      .cursor_pointer()
      .hover((style) => style.opacity(0.8))
      .on_click((_event, cx) => action(cx))
      .child(label);
  }

  /**
   * What the list shows when the config has no runs: where runs live and how to add one.
   * @param {object} t The theme.
   * @returns {object}
   */
  emptyState(t) {
    const root = this.workspace?.repo ? this.workspace.root : null;
    return v_flex()
      .pt(10)
      .child(
        div()
          .px(10)
          .text_size(11.5)
          .text_color(t.dim)
          .child(
            root
              ? "No runs yet. Runs live in .herdr/alp.json, shared with the repo, and in your own Alp config."
              : "No runs yet. Open a terminal in a repository to see its runs.",
          ),
      )
      .when(Boolean(root && this.catalog?.vscode), (el) =>
        el.child(this.action(t, "run-import-empty", "Import from VS Code…", () => openImport(root))),
      )
      .child(this.action(t, "run-add-empty", "Add a run…", () => openSaveForm(root)));
  }

  /**
   * The Output button beside the workspace's name: shows or hides the runs panel, like the status
   * bar's button. Lit while the panel shows.
   * @param {object} t The theme.
   * @param {object} panel The layout's runs panel node.
   * @returns {object}
   */
  outputButton(t, panel) {
    const open = !panel.hidden;
    return h_flex()
      .id("run-output-toggle")
      .flex_none()
      .h(22)
      .px(7)
      .gap(5)
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .text_size(11.5)
      .bg(open ? t.selected : t.chrome)
      .text_color(open ? t.foreground : t.muted)
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .tooltip(open ? "Hide the runs' output" : "Show the runs' output")
      .on_click((_event, cx) => {
        cx.stop_propagation();
        run("layout.toggle", { id: PANEL_ID });
      })
      .child(svg(OUTPUT_ICON).size(12).flex_none())
      .child("Output");
  }

  /**
   * The Run list: the workspace's name and its Output button, config errors, then the runs under their sections and
   * the folds for those that can't run here or are hidden.
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    this.sync(cx);
    const t = theme();
    const query = this.filter.value().trim().toLowerCase();
    const matches = (entry) => !query || entry.name.toLowerCase().includes(query);
    const catalog = this.catalog;
    const hiddenKeys = this.hiddenKeys();
    const all = catalog ? catalog.runs : [];
    const blocked = all.filter((entry) => entry.unsupported && !hiddenKeys.has(entry.key) && matches(entry));
    const hidden = all.filter((entry) => hiddenKeys.has(entry.key) && matches(entry));
    const panel = find(layout(), PANEL_ID);
    const items = [];
    if (catalog) {
      if (!all.length) items.push(this.emptyState(t));
      for (const section of catalog.sections) {
        const rows = all.filter(
          (entry) => entry.section === section && !entry.unsupported && !hiddenKeys.has(entry.key) && matches(entry),
        );
        if (!rows.length) continue;
        items.push(this.heading(t, section));
        rows.forEach((entry) => items.push(this.row(t, entry)));
      }
      items.push(
        ...this.fold(
          t,
          "run-blocked",
          "can't run here",
          blocked.map((entry) => this.row(t, entry)),
          this.showBlocked,
          () => {
            this.showBlocked = !this.showBlocked;
          },
        ),
        ...this.fold(
          t,
          "run-hidden",
          "hidden",
          hidden.map((entry) => this.row(t, entry, true)),
          this.showHidden,
          () => {
            this.showHidden = !this.showHidden;
          },
        ),
      );
      if (all.length && catalog.vscode && this.workspace?.repo) {
        const root = this.workspace.root;
        items.push(this.action(t, "run-import", "Import from VS Code…", () => openImport(root)));
      }
    }
    return v_flex()
      .id("alp-runs-list")
      .size_full()
      .bg(t.chrome)
      .child(
        h_flex()
          .flex_none()
          .px(10)
          .pt(8)
          .pb(6)
          .gap(6)
          .items_center()
          .child(
            Input.new(this.filter)
              .flex_1()
              .h(28)
              .px(8)
              .rounded(7)
              .border_1()
              .border_color(t.input)
              .bg(t.background)
              .text_size(12),
          )
          .child(
            h_flex()
              .id("run-add")
              .flex_none()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((style) => style.bg(t.hover).text_color(t.foreground))
              .tooltip("Add a run")
              .on_click((_event, cx) => {
                cx.stop_propagation();
                openSaveForm(this.workspace?.repo ? this.workspace.root : null);
              })
              .child(svg(PLUS_ICON).size(12)),
          )
          .child(
            h_flex()
              .id("run-reload")
              .flex_none()
              .size(24)
              .items_center()
              .justify_center()
              .rounded(6)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((style) => style.bg(t.hover).text_color(t.foreground))
              .tooltip(`Read ${this.workspace?.name ?? "the workspace"}'s runs again`)
              .on_click((_event, cx) => this.load(cx, true))
              .child(svg(RELOAD_ICON).size(12)),
          ),
      )
      .when(Boolean(this.workspace), (el) =>
        el.child(
          h_flex()
            .flex_none()
            .px(10)
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim).truncate().child(this.workspace.name))
            .when(Boolean(panel), (el) => el.child(this.outputButton(t, panel))),
        ),
      )
      .children(
        (catalog?.errors ?? []).map((error, i) =>
          div().id(`run-error-${i}`).px(10).pt(4).text_size(11.5).text_color(t.blocked).child(error),
        ),
      )
      .when(!catalog, (el) =>
        el.child(div().px(10).py(8).text_size(11.5).text_color(t.dim).child("Reading the workspace…")),
      )
      .child(
        v_flex().id("alp-runs-scroll").flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().pb(10).children(items)),
      );
  }

  /** Queues a request for the list to hide or show an entry in a repository. */
  static setVisibility(repo, key, hidden) {
    const queue = Array.isArray(shared(VISIBILITY_KEY)) ? shared(VISIBILITY_KEY) : [];
    const last = queue.at(-1)?.at ?? 0;
    const request = { at: Math.max(Date.now(), last + 1), repo, key, hidden };
    setShared(VISIBILITY_KEY, [...queue, request].slice(-VISIBILITY_QUEUE_LIMIT));
  }

  /** Records the answers as the next defaults, then asks the list to start the entry. */
  static request(key, root, answers) {
    setShared(ANSWERS_KEY, { ...(shared(ANSWERS_KEY) ?? {}), ...answers });
    setShared(LAUNCH_KEY, { id: `${Date.now()}-${Math.random()}`, key, root, answers });
  }
}
