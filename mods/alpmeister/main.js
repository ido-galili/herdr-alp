// Alpmeister: the team lead's start-of-day view, in four views, and its settings, which the
// Settings button shows in place of the view (Back returns to it).
//   Dashboard  one workspace at a time (tiles for open bugs by priority, triage bugs, customer
//              issues and the nightly run, the spotlight, the next milestone and the team in
//              flight), or All repos: your GitHub as a whole.
//   Board      a workspace's board items that match its Board tab filter, a column per status.
//   Herds      your Claude Code sessions and how they are linked.
//   Daypack    today's focus, then review requests, your PRs and your issues across your repos.
//   Settings   everything in ~/.config/alp/alpmeister.json, as a form: a copy opened with
//              props.tab "settings" shows only this.
// It fetches when it opens, when it is shown with data over 2 hours old, and from Refresh.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Popup, ScrollHandle } from "gpui-base";
import {
  checking,
  exec,
  layout,
  panes,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  spaces,
  theme,
  watchFolder,
  window,
  writeTextFile,
} from "herdr";
import { AccountTiles, OpenPrs, Repos } from "./account.js";
import { Avatars } from "./avatars.js";
import { BoardState } from "./board-state.js";
import { Board, NoBoard } from "./board-view.js";
import { folderOf, loadConfig, normalizeConfig, stateDir } from "./config.js";
import { MODEL_VERSION, loadAll, loadPickStates } from "./data.js";
import { FocusStore, pickId } from "./focus.js";
import { FocusList } from "./focus-list.js";
import { loadDemoHerds } from "./demo-herds.js";
import { demoConfig, demoDiscovery, demoFocus, demoModel } from "./demo-data.js";
import { loadHerds, saveTabLink, sessionsDir } from "./herds-data.js";
import { Herds } from "./herds-view.js";
import { HerdsCanvas } from "./herds-canvas.js";
import { InFlight } from "./in-flight.js";
import { MyIssues, MyPrs, Reviews } from "./my-day.js";
import { Spotlight } from "./spotlight.js";
import { Milestone, Tiles } from "./project.js";
import { SettingsForm } from "./settings-view.js";
import {
  Card,
  ICONS,
  IconButton,
  Note,
  TextButton,
  ago,
  announceBackgroundTab,
  fillPrompt,
  sessionName,
  tabIdsNamed,
  warningColor,
} from "./ui.js";

const STALE_AFTER = 2 * 3600000;
/** The pause after an agents folder changes before it is watched again: agents write often. */
const AGENT_WATCH_PAUSE = 3000;
const WIDE = 1000;
const TABS = { dashboard: "dashboard", board: "board", today: "today", herds: "herds", settings: "settings" };
/** Other names `props.tab` takes for a tab: the Dashboard is shown as Overview. */
const TAB_ALIASES = new Map([["overview", TABS.dashboard]]);
const TAB_KEY = "alpmeister.tab";
/** Set after the settings file is saved, so every other copy fetches with the new settings. */
const SETTINGS_STAMP_KEY = "alp.settingsStamp";
const WORKSPACE_KEY = "alpmeister.workspace";
/** Team in flight's "Only <milestone>" switch, as a JSON object of workspace name to true. */
const MILESTONE_ONLY_KEY = "alpmeister.milestoneOnly";
/** The Repos card's "With open work" switch on All repos: "true" when it is on. */
const REPOS_ACTIVE_ONLY_KEY = "alpmeister.reposActiveOnly";
/** The Dashboard switch's value for your GitHub as a whole. */
const ALL_REPOS = "";
const FOCUS_STAMP_KEY = "alp.focusStamp";
/** The views' names, as the header's tabs and Settings' "Back to <view>" show them. */
const VIEW_NAMES = { [TABS.dashboard]: "Overview", [TABS.board]: "Board", [TABS.herds]: "Herds", [TABS.today]: "Daypack" };
/** The Alp layout's stack that shows the terminals or, pinned in their place, Alpmeister. */
const WORK_STACK = "work-stack";
const WORK_BODY = "work-body";
const ALPMEISTER_VIEW = "alpmeister-view";

const cachePath = () => `${stateDir()}/alpmeister-cache.json`;

/**
 * A node of a layout tree, by its id.
 * @param {any} node The tree, from `layout()`.
 * @param {string} id The node's id.
 * @returns {any | null} The node, or null when the tree has none.
 */
function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * The line beside the workspace picker that says what a workspace covers: "repo owner/name ·
 * board Title #3".
 * @param {object | null} ws The workspace, or null for All repos.
 * @returns {string} The line.
 */
function scopeLine(ws) {
  if (!ws) return "every repository in scope";
  const board = ws.board ? `board ${ws.board.title || ws.board.owner} #${ws.board.number}` : null;
  return [ws.repo ? `repo ${ws.repo}` : null, board].filter(Boolean).join(" · ");
}

/**
 * The tab a name stands for: one of TABS' values, or an alias such as "overview".
 * @param {unknown} name The name, from `props.tab` or the remembered tab.
 * @returns {string | null} The TABS value, or null when the name is no tab.
 */
function tabNamed(name) {
  if (Object.values(TABS).includes(name)) return name;
  return TAB_ALIASES.get(name) ?? null;
}

/**
 * The tab this copy showed last, or the dashboard. Settings opens in its own copy only.
 * @returns {string} A TABS value.
 */
function rememberedTab() {
  try {
    const tab = tabNamed(localStorage.getItem(TAB_KEY));
    return tab && tab !== TABS.settings ? tab : TABS.dashboard;
  } catch (error) {
    console.log(`alpmeister: no remembered tab: ${error}`);
    return TABS.dashboard;
  }
}

/** The workspace this copy's Dashboard showed last, or All repos. */
function rememberedWorkspace() {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? ALL_REPOS;
  } catch (error) {
    console.log(`alpmeister: no remembered workspace: ${error}`);
    return ALL_REPOS;
  }
}

/**
 * The workspaces whose Team in flight shows only the next milestone, as remembered.
 * @returns {Set<string>} The workspaces' names; empty when nothing is remembered.
 */
function rememberedMilestoneOnly() {
  try {
    const saved = JSON.parse(localStorage.getItem(MILESTONE_ONLY_KEY) ?? "{}");
    if (!saved || typeof saved !== "object") return new Set();
    return new Set(Object.keys(saved).filter((name) => saved[name] === true));
  } catch (error) {
    console.log(`alpmeister: no remembered milestone switch: ${error}`);
    return new Set();
  }
}

/**
 * Whether the Repos card showed only repositories with open work, as remembered.
 * @returns {boolean} True when it did; false when nothing is remembered.
 */
function rememberedReposActiveOnly() {
  try {
    return localStorage.getItem(REPOS_ACTIVE_ONLY_KEY) === "true";
  } catch (error) {
    console.log(`alpmeister: no remembered repos switch: ${error}`);
    return false;
  }
}

export default class Alpmeister extends View {
  init(_props, cx) {
    this.config = null;
    this.configError = null;
    this.model = null;
    this.loading = false;
    this.refreshAgain = false;
    this.configText = null;
    // `props.workspace` opens a copy on that workspace's Dashboard; "" is All repos.
    this.workspaceName = typeof props()?.workspace === "string" ? props().workspace : rememberedWorkspace();
    this.reposActiveOnly = rememberedReposActiveOnly();
    this.failure = null;
    // The workspaces whose Team in flight shows only the next milestone.
    this.milestoneOnly = rememberedMilestoneOnly();
    this.expandedGroups = new Set();
    this.avatars = new Avatars();
    this.boardState = new BoardState(this);
    this.width = 1200;
    this.height = 800;
    this.cacheSnapshot = null;
    // `props.tab` opens a copy on that tab: tab.new {mod: "alpmeister", props: {tab: "herds"}}.
    // "overview" is another name for "dashboard".
    this.tab = tabNamed(props()?.tab) ?? rememberedTab();
    // `props.demo` shows made-up data on every tab, for demos and screenshots: a herd on Herds
    // (`demo-herds.js`), and settings, GitHub data and a focus list everywhere else (`demo-data.js`).
    // It calls no GitHub and writes nothing: not the settings, the cache or the focus list.
    this.demo = props()?.demo === true;
    this.herds = null;
    this.herdsLoading = false;
    this.herdsAgain = false;
    this.herdsWatching = false;
    this.agentWatches = new Map();
    this.expandedAgents = new Set();
    this.herdsFailure = null;
    this.picking = null;
    this.herdsCanvas = new HerdsCanvas();
    this.focus = new FocusStore(this.demo ? demoFocus() : null);
    this.focusStamp = shared(FOCUS_STAMP_KEY) ?? null;
    this.input = InputState.new({ placeholder: "Add a todo and press Enter" });
    this.input.on("submit", (_event, cx) => this.addTodo(cx));
    this.editingTodo = null;
    this.todoEdit = InputState.new({ placeholder: "The todo" });
    this.todoEdit.on("submit", (_event, cx) => this.saveTodoEdit(cx));
    this.todoEdit.on("blur", (_event, cx) => this.saveTodoEdit(cx));
    this.settings = new SettingsForm((cx) => this.announceSettings(cx));
    if (this.demo) this.settings.useDemo(demoDiscovery(demoConfig().config));
    this.settingsStamp = shared(SETTINGS_STAMP_KEY) ?? null;
    // Settings shown in place of the view, with "Back to <view>"; its edits stay while Alp is open.
    this.inSettings = false;
    // A save while Settings shows in place fetches again on Back.
    this.fetchOnBack = false;
    // Where to scroll once drawn: "top", or "workspaces" for Settings' workspaces card.
    this.scrollTo = null;
    this.scrollTask = null;
    this.scroll = ScrollHandle.new();
    // Which workspace picker is open: "overview", "board" or null, and when a press outside closed it.
    this.pickerOpen = null;
    this.pickerClosedAt = 0;
    // The fetch time of the data a stale fetch was started for, so a failed one is not retried on every draw.
    this.staleFetchFor = null;
    if (checking()) return;
    if (this.tab === TABS.settings) {
      // The settings copy edits the file; it fetches nothing from GitHub itself.
      cx.spawn(async (cx) => {
        await this.loadSettings();
        cx.notify();
      });
      return;
    }
    cx.spawn(async (cx) => {
      await this.loadSettings();
      await this.focus.load();
      await this.loadCache();
      cx.notify();
      this.refresh(cx);
      if (this.tab === TABS.herds) this.watchHerds(cx);
    });
  }

  /**
   * Reads the herds again. A call while a read runs asks for one more read after it, so the
   * latest change is never missed and reads never pile up.
   */
  reloadHerds(cx) {
    if (this.herdsLoading) {
      this.herdsAgain = true;
      return;
    }
    this.herdsLoading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      do {
        this.herdsAgain = false;
        try {
          this.herds = this.demo ? await loadDemoHerds() : await loadHerds();
          this.herdsFailure = null;
          this.watchAgents(cx);
        } catch (error) {
          this.herdsFailure = String(error?.message ?? error);
          console.log(`alpmeister: herds failed: ${this.herdsFailure}`);
        }
      } while (this.herdsAgain);
      this.herdsLoading = false;
      cx.notify();
    });
  }

  /**
   * Reads the herds, then again whenever Claude Code's session registry changes: a session
   * starting, ending, or changing status. Started once, the first time the Herds tab shows.
   */
  watchHerds(cx) {
    this.reloadHerds(cx);
    if (this.herdsWatching || this.demo) return;
    this.herdsWatching = true;
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(sessionsDir());
        this.reloadHerds(cx);
      }
    });
  }

  /**
   * Reads the herds again whenever an agent folder changes: an agent starting, stepping or
   * finishing. One watch per folder, while its session is live; after each change it waits
   * AGENT_WATCH_PAUSE, so a busy agent redraws the tab every few seconds, not on every write.
   */
  watchAgents(cx) {
    for (const folder of this.herds?.agentFolders ?? []) {
      if (this.agentWatches.has(folder)) continue;
      this.agentWatches.set(folder, null);
      cx.spawn(async (cx) => {
        while (this.herds?.agentFolders?.includes(folder)) {
          await watchFolder(folder);
          this.reloadHerds(cx);
          await new Promise((resolve) => {
            // Kept on the view: a dropped task would not fire.
            this.agentWatches.set(folder, cx.timer.after(AGENT_WATCH_PAUSE, () => resolve()));
          });
        }
        this.agentWatches.delete(folder);
      });
    }
  }

  /** Shows or folds the agents a session finished a while ago. */
  toggleAgents(sessionId, cx) {
    if (this.expandedAgents.has(sessionId)) this.expandedAgents.delete(sessionId);
    else this.expandedAgents.add(sessionId);
    cx.notify();
  }

  /** Links a background session to the tab that shows it (or unlinks it), then redraws. */
  linkTab(sessionId, address, cx) {
    this.picking = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await saveTabLink(sessionId, address);
      } catch (error) {
        console.log(`alpmeister: tab link not saved: ${error}`);
      }
      this.reloadHerds(cx);
    });
  }

  /**
   * Reads the settings file. The Settings form takes the new version too, unless it holds
   * unsaved edits.
   */
  async loadSettings() {
    const { config, error, text } = this.demo ? demoConfig() : await loadConfig();
    this.config = config ?? null;
    this.configError = error ?? null;
    this.configText = text;
    if (config && !this.settings.dirty()) this.settings.load(config, text);
    return config ?? null;
  }

  /**
   * Takes settings this copy just wrote outside the form, then tells the other copies.
   * @param {object} config The settings written.
   * @param {string | null} text The file's text now.
   */
  settingsSaved(config, text) {
    this.config = config;
    this.configText = text;
    if (!this.settings.dirty()) this.settings.load(config, text);
    this.settingsStamp = Date.now();
    setShared(SETTINGS_STAMP_KEY, this.settingsStamp);
  }

  /**
   * Tells the other copies the settings file changed, after a save here. Settings shown in
   * place fetches again on Back; the settings copy fetches nothing.
   * @param {object} cx The context.
   * @returns {void}
   */
  announceSettings(cx) {
    this.settingsStamp = Date.now();
    setShared(SETTINGS_STAMP_KEY, this.settingsStamp);
    if (this.inSettings) this.fetchOnBack = true;
    else if (this.tab !== TABS.settings) this.refresh(cx);
  }

  /**
   * Fetches again with the new settings when another copy saved them. Called from `render`.
   * @param {object} cx The render's context.
   * @returns {void}
   */
  syncSettings(cx) {
    const stamp = shared(SETTINGS_STAMP_KEY) ?? null;
    if (stamp === this.settingsStamp) return;
    this.settingsStamp = stamp;
    if (this.tab !== TABS.settings) this.refreshSoon(cx);
  }

  /**
   * Fetches again right after this draw: `render` may not redraw, and a fetch redraws at once.
   * @param {object} cx The render's context.
   * @returns {void}
   */
  refreshSoon(cx) {
    // Kept on the view: a dropped task would not fire.
    this.refreshTask = cx.timer.after(0, (cx) => this.refresh(cx));
  }

  /**
   * Shows Settings in place of the view, with "Back to <view>". Edits not saved yet are still
   * there. Given a workspace, Settings opens on it, scrolled to the workspaces card, with one of
   * its dropdowns open when `picker` names one ("ws-board" for the board picker). The settings
   * copy shows Settings already.
   * @param {{ workspace?: string | null, picker?: string }} [options] Where Settings opens.
   * @param {object} [cx] The context, to redraw.
   * @returns {void}
   */
  openSettings({ workspace, picker } = {}, cx) {
    if (this.tab === TABS.settings) return;
    this.inSettings = true;
    this.pickerOpen = null;
    const found = workspace != null && this.settings.showWorkspace(workspace, { picker });
    this.scrollTo = found ? "workspaces" : "top";
    cx?.notify();
  }

  /**
   * Leaves Settings for the view it was opened from, keeping unsaved edits. After a save there,
   * fetches again with the new settings.
   * @param {object} cx The context.
   * @returns {void}
   */
  closeSettings(cx) {
    this.inSettings = false;
    this.settings.open = null;
    this.scrollTo = "top";
    if (this.settings.message && !this.settings.message.error) this.settings.message = null;
    if (this.fetchOnBack) {
      this.fetchOnBack = false;
      this.refresh(cx);
    }
    cx.notify();
  }

  /**
   * Whether this copy is Alp pinned in place of the terminals and showing now: the Alp layout's
   * work stack shows its Alpmeister block. A copy in a tab is never that one.
   * @returns {boolean}
   */
  pinnedShown() {
    if (this.tab === TABS.settings || props()?.pane) return false;
    return findNode(layout(), WORK_STACK)?.active === ALPMEISTER_VIEW;
  }

  /** Draws the last result at once, before the first refresh returns. */
  async loadCache() {
    if (this.demo) return;
    const text = await readTextFile(cachePath());
    this.cacheSnapshot = text;
    try {
      const cached = text ? JSON.parse(text) : null;
      // A cache from before workspaces has another shape: wait for the refresh instead.
      if (cached?.version === MODEL_VERSION && !this.model) this.model = cached;
    } catch (error) {
      console.log(`alpmeister: cache unreadable, ignoring it: ${error}`);
    }
  }

  /** Keeps the latest result for the next first paint. */
  async saveCache(model) {
    if (this.demo) return;
    const text = JSON.stringify(model);
    await exec("mkdir", ["-p", stateDir()]);
    try {
      await writeTextFile(cachePath(), text, this.cacheSnapshot);
    } catch (error) {
      console.log(`alpmeister: cache changed elsewhere, overwriting: ${error}`);
      await writeTextFile(cachePath(), text, await readTextFile(cachePath()));
    }
    this.cacheSnapshot = text;
  }

  /**
   * Reads the settings, then fetches everything again. A call while a refresh runs asks for
   * one more after it, so a save is never fetched with the old settings.
   */
  refresh(cx) {
    if (this.loading) {
      this.refreshAgain = true;
      return;
    }
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      do {
        this.refreshAgain = false;
        try {
          const config = await this.loadSettings();
          if (config) {
            this.model = this.demo ? demoModel(config) : await loadAll(config);
            this.failure = null;
            if (!this.demo) {
              await this.saveCache(this.model);
              await this.checkPicks(config);
            }
          }
        } catch (error) {
          this.failure = String(error?.message ?? error);
          console.log(`alpmeister: refresh failed: ${this.failure}`);
        }
      } while (this.refreshAgain);
      this.loading = false;
      cx.notify();
    });
  }

  /**
   * Updates today's GitHub picks, checked ones too: the issue or PR state, an issue's board status
   * and a PR's review decision, kept on the item so the card shows them before the next refresh.
   * Checks an open pick whose issue closed or PR merged; never unchecks one.
   */
  async checkPicks(config) {
    const picks = this.focus.items().filter((item) => item.kind !== "todo" && item.repo);
    if (!picks.length) return;
    const states = await loadPickStates(config, picks);
    let changed = false;
    for (const item of picks) {
      const found = states[`${item.repo}#${item.number}`];
      if (!found) continue;
      const changes = {};
      if (!item.done && (found.state === "CLOSED" || found.state === "MERGED")) changes.done = true;
      if (found.state && found.state !== item.state) changes.state = found.state;
      if (item.kind === "issue" && found.status !== (item.status ?? null)) changes.status = found.status;
      if (item.kind === "pr" && found.review !== (item.review ?? null)) changes.review = found.review;
      if (Object.keys(changes).length) {
        this.focus.update(item.id, changes);
        changed = true;
      }
    }
    if (changed) {
      await this.focus.save();
      this.announceFocus();
    }
  }

  /** Tells the Daypack sidebar that the focus list changed on disk. */
  announceFocus() {
    if (this.demo) return;
    this.focusStamp = Date.now();
    setShared(FOCUS_STAMP_KEY, this.focusStamp);
  }

  /** Reloads the focus list when the Daypack sidebar changed it. */
  syncFocus(cx) {
    if (this.demo) return;
    const stamp = shared(FOCUS_STAMP_KEY) ?? null;
    if (stamp === this.focusStamp) return;
    this.focusStamp = stamp;
    cx.spawn(async (cx) => {
      await this.focus.load();
      cx.notify();
    });
  }

  /** Saves the focus list, then redraws. */
  /** Opens a todo's text for editing, all of it selected. */
  startTodoEdit(item, cx) {
    this.editingTodo = item.id;
    this.todoEdit.set_value(item.text ?? "");
    this.todoEdit.set_selected_range({ start: 0, end: (item.text ?? "").length });
    this.todoEdit.focus();
    // The field mounts on the next frame; focus it again once it is there.
    cx.timer.after(100, () => this.todoEdit.focus());
    cx.notify();
  }

  /** Saves the edited todo's text. An empty text keeps the old one. */
  saveTodoEdit(cx) {
    const id = this.editingTodo;
    if (!id) return;
    this.editingTodo = null;
    const text = this.todoEdit.value().trim();
    const item = this.focus.items().find((candidate) => candidate.id === id);
    if (!item || !text || text === item.text) {
      cx.notify();
      return;
    }
    this.focus.update(id, { text });
    this.persist(cx);
  }

  /** Closes the todo editor without saving. */
  cancelTodoEdit(cx) {
    this.editingTodo = null;
    cx.notify();
  }

  persist(cx) {
    cx.spawn(async (cx) => {
      await this.focus.save();
      this.announceFocus();
      cx.notify();
    });
    cx.notify();
  }

  addTodo(cx) {
    const text = this.input.value().trim();
    if (!text) return;
    this.focus.add({ kind: "todo", text });
    this.input.set_value("");
    this.persist(cx);
  }

  /** A pin control for a row. `prefix` keeps ids unique when an item shows in two widgets. */
  pinFor(prefix) {
    return (item) => {
      const pinned = this.focus.has(item.kind, item.repo, item.number);
      return IconButton(
        `${prefix}-pin-${item.repo}#${item.number}`,
        ICONS.pin,
        (cx) => {
          if (pinned) this.focus.remove(pickId(item.kind, item.repo, item.number));
          else {
            this.focus.add({
              kind: item.kind,
              repo: item.repo,
              number: item.number,
              title: item.title,
              url: item.url,
              ...(item.kind === "issue" && item.status ? { status: item.status } : {}),
              ...(item.kind === "pr" && item.reviewDecision ? { review: item.reviewDecision } : {}),
            });
          }
          this.persist(cx);
        },
        {
          tooltip: pinned ? "Unpin" : "Pin to Today",
          color: pinned ? theme().accent : undefined,
        },
      );
    };
  }

  /**
   * The Claude prompt for an issue or a PR, or "" when the button is off.
   * @param {string} kind "issue" or "pr".
   * @returns {string}
   */
  prompt(kind) {
    const launch = this.config?.account.launch ?? {};
    return (kind === "pr" ? launch.pr : launch.issue) ?? "";
  }

  /**
   * Opens a Claude tab on an issue or PR in the space you are in. It starts in the live folder of
   * that space's first tab when it is the repository's local clone or inside it, such as a
   * worktree, else in the clone, else in the space's own folder. A background tab opens without
   * taking focus, and a notification says so.
   * @param {{ kind: string, repo: string, number: number }} item The issue or PR.
   * @param {{ background?: boolean, cx?: object }} [options] `cx`: the click's context, needed in the background.
   */
  launch(item, { background = false, cx } = {}) {
    // The demo's repositories are made up: there is nothing to start Claude on.
    if (this.demo) return;
    const clone = folderOf(this.config, item.repo);
    const space = spaces().find((candidate) => candidate.active);
    const firstTab = space?.tabs?.[0]?.id;
    const liveFolder = panes().find((pane) => pane.tab === firstTab && pane.cwd)?.cwd ?? space?.folder;
    const spaceFolder = liveFolder?.replace(/\/+$/, "");
    const inRepo = Boolean(clone && spaceFolder && (spaceFolder === clone || spaceFolder.startsWith(`${clone}/`)));
    const folder = inRepo ? spaceFolder : clone;
    const before = tabIdsNamed(space?.id, sessionName(item));
    run("tab.new", {
      name: sessionName(item),
      ...(space ? { space: space.id } : {}),
      ...(folder ? { folder } : {}),
      argv: ["claude"],
      task: fillPrompt(this.prompt(item.kind), item),
      focus: !background,
    });
    if (background) announceBackgroundTab(item, space?.id, before, cx);
  }

  /** The actions every row with a Claude button needs. */
  launchActions() {
    return { launch: (item, options) => this.launch(item, options), prompt: (kind) => this.prompt(kind) };
  }

  /** The workspace the Dashboard shows, or null for All repos. */
  shownWorkspace() {
    return this.config?.workspaces.find((ws) => ws.name === this.workspaceName) ?? null;
  }

  /** Shows a workspace on the Dashboard, or All repos, and remembers it for this copy. */
  selectWorkspace(name, cx) {
    this.workspaceName = name;
    if (this.demo) return cx.notify();
    try {
      localStorage.setItem(WORKSPACE_KEY, name);
    } catch (error) {
      console.log(`alpmeister: workspace not remembered: ${error}`);
    }
    cx.notify();
  }

  /**
   * Switches the Repos card between every repository and those with open work, and remembers it.
   * @param {object} cx The context.
   */
  toggleReposActiveOnly(cx) {
    this.reposActiveOnly = !this.reposActiveOnly;
    if (this.demo) return cx.notify();
    try {
      localStorage.setItem(REPOS_ACTIVE_ONLY_KEY, String(this.reposActiveOnly));
    } catch (error) {
      console.log(`alpmeister: repos switch not remembered: ${error}`);
    }
    cx.notify();
  }

  /**
   * Switches a workspace's Team in flight between every milestone and the next one, and
   * remembers it for that workspace.
   * @param {string} name The workspace's name.
   * @param {object} cx The context.
   */
  toggleMilestoneOnly(name, cx) {
    if (this.milestoneOnly.has(name)) this.milestoneOnly.delete(name);
    else this.milestoneOnly.add(name);
    if (this.demo) return cx.notify();
    try {
      const saved = Object.fromEntries([...this.milestoneOnly].map((only) => [only, true]));
      localStorage.setItem(MILESTONE_ONLY_KEY, JSON.stringify(saved));
    } catch (error) {
      console.log(`alpmeister: milestone switch not remembered: ${error}`);
    }
    cx.notify();
  }

  /** Shows one of the tabs and remembers it for this copy. */
  selectTab(tab, cx) {
    this.tab = tab;
    if (tab === TABS.herds) this.watchHerds(cx);
    if (this.demo) return cx.notify();
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch (error) {
      console.log(`alpmeister: tab not remembered: ${error}`);
    }
    cx.notify();
  }

  /**
   * The views as underlined tabs: Overview, Board, Herds and Daypack with its open count.
   * @param {object} t The theme.
   * @returns {object} The row of tabs.
   */
  tabs(t) {
    const open = this.focus.items().filter((item) => !item.done).length;
    const tab = (name, count) => {
      const on = this.tab === name;
      return h_flex()
        .id(`tab-${name}`)
        .h(34)
        .px(4)
        .gap(6)
        .items_center()
        .border_b_2()
        .border_color(on ? t.accent : "#00000000")
        .text_size(12.5)
        .font_medium()
        .cursor_pointer()
        .text_color(on ? t.foreground : t.muted)
        .hover((style) => style.text_color(t.foreground))
        .on_click((_event, cx) => this.selectTab(name, cx))
        .child(VIEW_NAMES[name])
        .when(Boolean(count), (el) =>
          el.child(div().px(5).rounded(4).bg(t.hover).text_size(11.5).text_color(t.muted).child(String(count))),
        );
    };
    return h_flex()
      .gap(14)
      .items_center()
      .child(tab(TABS.dashboard))
      .child(tab(TABS.board))
      .child(tab(TABS.herds))
      .child(tab(TABS.today, open));
  }

  /**
   * "Updated 3h ago · Refresh" as one button: orange once the data is over 2 hours old.
   * @param {object} t The theme.
   * @param {number | null | undefined} fetchedAt When the shown view's data was read.
   * @param {boolean} busy Whether a read runs now.
   * @param {(cx: object) => void} onRefresh Reads again.
   * @returns {object} The button.
   */
  updated(t, fetchedAt, busy, onRefresh) {
    const age = fetchedAt ? Date.now() - fetchedAt : null;
    const stale = age != null && age > STALE_AFTER;
    const when = age == null ? null : age < 60000 ? "Updated just now" : `Updated ${ago(age)} ago`;
    return h_flex()
      .id("refresh")
      .flex_none()
      .h(24)
      .px(6)
      .gap(4)
      .items_center()
      .rounded(5)
      .text_size(11.5)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_event, cx) => {
        if (!busy) onRefresh(cx);
      })
      .when(Boolean(when) && !busy, (el) =>
        el.child(div().text_color(stale ? warningColor(t) : t.dim).child(`${when} ·`)),
      )
      .child(div().font_medium().text_color(t.accent).child(busy ? "Refreshing…" : "Refresh"))
      .when(stale && !busy, (el) => el.tooltip("Over 2 hours old: Refresh fetches it again"));
  }

  /**
   * The Settings button: "Settings", or "Settings · 2 unsaved" in orange while Settings holds
   * edits not saved yet.
   * @param {object} t The theme.
   * @returns {object} The button.
   */
  settingsButton(t) {
    const changes = this.settings.changeCount();
    const warn = warningColor(t);
    return h_flex()
      .id("open-settings")
      .flex_none()
      .h(24)
      .px(9)
      .gap(6)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(changes ? warn : t.border)
      .text_size(11.5)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_event, cx) => this.openSettings({}, cx))
      .child(svg(ICONS.settings).size(12).flex_none().text_color(t.muted))
      .child("Settings")
      .when(changes > 0, (el) => el.child(div().text_color(warn).child(`· ${changes} unsaved`)))
      .tooltip(changes ? "Settings, with your edits not saved yet" : "Alp settings");
  }

  /**
   * The header. In a view: "Alp", the views as underlined tabs, "Updated · Refresh", Settings,
   * and "Back to terminals" when Alp is pinned in place of them. On Herds, Refresh reads the
   * sessions again; elsewhere it fetches from GitHub. With Settings in place: "Back to <view>"
   * and "Alp settings". The settings copy shows its title alone.
   * @param {object} t The theme.
   * @returns {object} The header row.
   */
  header(t) {
    const title = (text) => div().text_size(18).font_semibold().text_color(t.foreground).child(text);
    if (this.tab === TABS.settings) {
      return h_flex()
        .items_center()
        .gap(10)
        .child(svg(ICONS.settings).size(16).text_color(t.muted))
        .child(title("Alp settings"));
    }
    if (this.inSettings) {
      return h_flex()
        .items_center()
        .gap(12)
        .pb(10)
        .border_b_1()
        .border_color(t.border)
        .child(
          h_flex()
            .id("settings-back")
            .flex_none()
            .h(26)
            .pl(7)
            .pr(10)
            .gap(6)
            .items_center()
            .rounded(6)
            .bg(t.hover)
            .text_size(12.5)
            .text_color(t.foreground)
            .cursor_pointer()
            .hover((style) => style.bg(t.selected))
            .on_click((_event, cx) => this.closeSettings(cx))
            .child(div().text_color(t.muted).child("←"))
            .child(`Back to ${VIEW_NAMES[this.tab] ?? "Overview"}`),
        )
        .child(title("Alp settings"));
    }
    const herds = this.tab === TABS.herds;
    const fetchedAt = herds ? this.herds?.loadedAt : this.model?.fetchedAt;
    const busy = herds ? this.herdsLoading : this.loading;
    return h_flex()
      .items_center()
      .gap(18)
      .border_b_1()
      .border_color(t.border)
      .child(title("Alp"))
      .child(this.tabs(t))
      .child(div().flex_1())
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(this.updated(t, fetchedAt, busy, (cx) => (herds ? this.reloadHerds(cx) : this.refresh(cx))))
          .child(this.settingsButton(t))
          .when(this.pinnedShown(), (el) =>
            el.child(
              TextButton(
                "back-terminals",
                "Back to terminals",
                () => run("layout.select", { stack: WORK_STACK, child: WORK_BODY }),
                { icon: ICONS.terminal, tooltip: "Show the space's terminals again" },
              ),
            ),
          ),
      );
  }

  /** Shows every row of a list section, or only its first rows again. */
  toggleGroup(key, cx) {
    if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
    else this.expandedGroups.add(key);
    cx.notify();
  }

  /**
   * The workspace picker: "Workspace: Herdr core ▾", a dropdown, and a dim line beside it that
   * says what the workspace covers. The Overview's lists All repos first, then every workspace,
   * and hides with no workspaces. The Board's lists the workspaces with a board and hides with one.
   * @param {object} t The theme.
   * @param {{ boards?: object[], shown?: string }} [board] The Board tab's workspaces and the shown one.
   * @returns {object | null}
   */
  workspaceSwitch(t, board) {
    const workspaces = board?.boards ?? this.config?.workspaces ?? [];
    if (board ? workspaces.length < 2 : !workspaces.length) return null;
    const key = board ? "board" : "overview";
    const shownName = board?.shown ?? this.shownWorkspace()?.name ?? ALL_REPOS;
    const shown = workspaces.find((ws) => ws.name === shownName) ?? null;
    const options = [...(board ? [] : [{ name: ALL_REPOS, label: "All repos", ws: null }])];
    for (const ws of workspaces) options.push({ name: ws.name, label: ws.name, ws });
    const open = this.pickerOpen === key;
    const trigger = h_flex()
      .id(`ws-pick-${key}`)
      .h(28)
      .px(10)
      .gap(8)
      .items_center()
      .rounded(7)
      .border_1()
      .border_color(open ? t.accent : t.border)
      .bg(t.background)
      .cursor_pointer()
      .hover((style) => style.border_color(t.input))
      .on_click((_event, cx) => {
        // A press here while open already closed the list (outside it): don't open it again.
        const justClosed = Date.now() - (this.pickerClosedAt ?? 0) < 400;
        this.pickerOpen = open || justClosed ? null : key;
        cx.notify();
      })
      .text_size(12)
      .text_color(t.foreground)
      .child(shown?.name ?? "All repos")
      .child(div().text_size(11.5).text_color(t.dim).child("▾"));
    const list = v_flex()
      .id(`ws-list-${key}`)
      .mt(32)
      .min_w(240)
      .p(4)
      .gap(2)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .shadow_lg()
      .on_mouse_down_out((_event, cx) => {
        if (this.pickerOpen !== key) return;
        this.pickerOpen = null;
        this.pickerClosedAt = Date.now();
        cx.notify();
      })
      .children(
        options.map((option) =>
          v_flex()
            .id(`ws-${key}-${option.name || "all"}`)
            .px(8)
            .py(5)
            .rounded(5)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover))
            .when(option.name === shownName, (el) => el.bg(t.selected))
            .on_click((_event, cx) => {
              this.pickerOpen = null;
              this.selectWorkspace(option.name, cx);
            })
            .child(
              div()
                .text_size(12)
                .text_color(option.name === shownName ? t.accent : t.foreground)
                .child(option.label),
            )
            .child(div().text_size(11.5).text_color(t.dim).child(scopeLine(option.ws))),
        ),
      );
    return h_flex()
      .gap(10)
      .items_center()
      .child(div().text_size(12).text_color(t.dim).child("Workspace"))
      .child(open ? Popup.new(`ws-popup-${key}`, trigger).anchor("top_left").content(list) : trigger)
      .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(scopeLine(shown)));
  }

  /**
   * A dim line that ends in "Open Settings →"; a click opens Settings on a workspace.
   * @param {object} t The theme.
   * @param {string} id The element id.
   * @param {string} text The line.
   * @param {string | null} workspace The workspace Settings opens on.
   * @returns {object} The line.
   */
  settingsLine(t, id, text, workspace) {
    return h_flex()
      .id(id)
      .flex_wrap()
      .gap(6)
      .items_center()
      .cursor_pointer()
      .on_click((_event, cx) => this.openSettings({ workspace }, cx))
      .child(div().text_size(12).text_color(t.dim).child(text))
      .child(div().text_size(12).font_medium().text_color(t.accent).child("Open Settings →"));
  }

  /**
   * Opens Settings at the board picker of a workspace without a board: the one the Overview shows
   * when it has none, else the first one; with no workspace yet, at the workspaces card.
   * @param {object} cx The context.
   * @returns {void}
   */
  addBoard(cx) {
    const workspaces = this.config?.workspaces ?? [];
    const shown = this.shownWorkspace();
    const target = shown && !shown.board ? shown : (workspaces.find((ws) => !ws.board) ?? workspaces[0]);
    if (target) this.openSettings({ workspace: target.name, picker: "ws-board" }, cx);
    else {
      this.openSettings({}, cx);
      if (this.inSettings) this.scrollTo = "workspaces";
    }
  }

  /**
   * The Board tab: the shown workspace's board, or the first workspace with a board when the
   * shown one has none. It downloads the avatars its cards lack, then draws them. With no board
   * anywhere, an "Add a board" button that opens Settings at a board picker.
   * @param {object} model The fetched model.
   * @param {object} cx The render's context.
   * @returns {object} The tab's content.
   */
  board(model, cx) {
    const state = this.boardState;
    const { boards, ws } = state.workspace();
    if (!ws) return NoBoard((cx) => this.addBoard(cx));
    state.sync(ws);
    const switcher = this.workspaceSwitch(theme(), { boards, shown: ws.name });
    const wsModel = model.workspaces?.[ws.name];
    const people = (wsModel?.boardView?.items ?? []).flatMap((item) => item.assignees);
    if (this.avatars.missing(people).length) {
      cx.spawn(async (cx) => {
        await this.avatars.load(people);
        cx.notify();
      });
    }
    return v_flex()
      .gap(14)
      .when(Boolean(switcher), (el) => el.child(switcher))
      .child(
        Board(ws, wsModel, {
          ...this.launchActions(),
          loading: this.loading,
          avatarPath: (login) => this.avatars.path(login),
          onEditStatuses: (cx) => this.openSettings({ workspace: ws.name }, cx),
          ...state.options(ws),
          pinFor: (prefix) => this.pinFor(prefix),
        }),
      );
  }

  /**
   * The Dashboard tab: All repos (four tiles and every repository in scope), or one workspace
   * (its tiles, spotlight, next milestone, and the team in flight or the open PRs). A workspace
   * with only a board says what adding a repository would show.
   * @param {object} config The settings.
   * @param {object} model The fetched model.
   * @param {boolean} wide Whether the tab is wide enough for four tiles across.
   * @returns {object} The tab's content.
   */
  dashboard(config, model, wide) {
    const t = theme();
    const ws = this.shownWorkspace();
    let content = v_flex().gap(14);
    const onToggleGroup = (key, cx) => this.toggleGroup(key, cx);
    const switcher = this.workspaceSwitch(t);
    if (switcher) content = content.child(switcher);
    if (!ws) {
      const account = model.account;
      if (model.errors?.account) {
        content = content.child(Note(`GitHub: ${model.errors.account}. Try gh auth status.`, t.blocked));
      }
      if (!account) return content.child(Note(this.loading ? "Loading from GitHub…" : "No data yet."));
      return content.child(AccountTiles(account, { wide })).child(
        Repos(config, account, {
          expanded: this.expandedGroups,
          onToggleGroup,
          activeOnly: this.reposActiveOnly,
          onToggleActive: (cx) => this.toggleReposActiveOnly(cx),
        }),
      );
    }
    const wsModel = model.workspaces?.[ws.name];
    if (!wsModel) return content.child(Note(this.loading ? "Loading from GitHub…" : "Refresh to load this workspace."));
    for (const [part, error] of Object.entries(wsModel.errors ?? {})) {
      if (part === "github" || part === "board") content = content.child(Note(`GitHub (${part}): ${error}`, t.blocked));
    }
    if (ws.repo) {
      content = content
        .child(Tiles(ws, wsModel, { wide, onSettings: (cx) => this.openSettings({ workspace: ws.name }, cx) }))
        .child(
          Spotlight(ws, wsModel, {
            wide,
            expanded: this.expandedGroups,
            onToggleGroup,
            pinButton: this.pinFor("sp"),
          }),
        )
        .child(Milestone(ws, wsModel));
    }
    if (ws.board) {
      content = content.child(
        InFlight(ws, wsModel, {
          milestoneOnly: this.milestoneOnly.has(ws.name),
          onToggleMilestone: (cx) => this.toggleMilestoneOnly(ws.name, cx),
          expanded: this.expandedGroups,
          onToggleGroup,
          pinButton: this.pinFor("if"),
        }),
      );
    } else if (ws.repo) {
      content = content.child(
        OpenPrs(ws, wsModel, { ...this.launchActions(), pinButton: this.pinFor("op"), expanded: this.expandedGroups, onToggleGroup }),
      );
    }
    if (!ws.repo) {
      content = content.child(
        this.settingsLine(t, "add-repo", "Add a repository to this workspace to see bugs, milestones and the nightly.", ws.name),
      );
    }
    return content;
  }

  /**
   * The Daypack tab: today's focus across the top, then review requests and your PRs in one
   * column and your issues in the other, from every repository in scope.
   */
  today(config, model, wide) {
    const t = theme();
    const items = this.focus.items();
    const focus = FocusList(items, this.input, {
      toggle: (id, cx) => {
        this.focus.update(id, { done: !items.find((item) => item.id === id)?.done });
        this.persist(cx);
      },
      remove: (id, cx) => {
        this.focus.remove(id);
        this.persist(cx);
      },
      launch: (item, options) => this.launch(item, options),
      command: (kind) => this.prompt(kind),
      edit: {
        id: this.editingTodo,
        input: this.todoEdit,
        start: (item, cx) => this.startTodoEdit(item, cx),
        cancel: (cx) => this.cancelTodoEdit(cx),
      },
    });
    const account = model.account;
    if (!account) {
      return v_flex()
        .gap(14)
        .child(focus)
        .when(Boolean(model.errors?.account), (el) => el.child(Note(`GitHub: ${model.errors.account}`, t.blocked)));
    }
    const actions = this.launchActions();
    const reviews = Reviews(account, { ...actions, pinButton: this.pinFor("rv") });
    const mine = MyIssues(config, account, { ...actions, pinButton: this.pinFor("mi") });
    const myPrs = MyPrs(account, { ...actions, pinButton: this.pinFor("mp") });
    const lists = wide
      ? h_flex()
          .gap(14)
          .items_start()
          .child(v_flex().flex_1().min_w(0).gap(14).child(reviews).child(myPrs))
          .child(div().flex_1().min_w(0).child(mine))
      : v_flex().gap(14).child(reviews).child(myPrs).child(mine);
    return v_flex().gap(14).child(focus).child(lists);
  }

  /** Starts the Settings form over from the file, dropping unsaved edits. */
  revertSettings(cx) {
    cx.spawn(async (cx) => {
      const { config, error, text } = this.demo ? demoConfig() : await loadConfig();
      this.config = config ?? this.config;
      this.configError = error ?? null;
      if (config) this.settings.load(config, text);
      this.settings.message = null;
      cx.notify();
    });
  }

  /**
   * Fetches again when the shown data is over 2 hours old: on open, or when Alp shows again after
   * a while. Once per fetch time, so a failed fetch is not retried on every draw.
   * @param {object} cx The context.
   * @returns {void}
   */
  fetchIfStale(cx) {
    if (this.demo || this.loading || this.tab === TABS.settings || this.tab === TABS.herds) return;
    const fetchedAt = this.model?.fetchedAt;
    if (!fetchedAt || Date.now() - fetchedAt <= STALE_AFTER || this.staleFetchFor === fetchedAt) return;
    if (window()?.visible === false) return;
    this.staleFetchFor = fetchedAt;
    this.refreshSoon(cx);
  }

  /**
   * Settings' parts, for Settings in place and the settings copy.
   * @param {object} cx The context.
   * @returns {object[]} The parts: the save bar, the account card, the workspaces card.
   */
  settingsParts(cx) {
    return this.settings.parts(cx, {
      configError: this.configError,
      onRevert: (cx) => this.revertSettings(cx),
      onReset: (cx) => {
        this.settings.load(normalizeConfig({}), this.configText ?? null);
        cx.notify();
      },
    });
  }

  /**
   * Scrolls Settings to the part asked for once it is drawn. The second request, after a frame,
   * brings a part taller than the window to its top.
   * @param {number} index The part's index among the scroll area's children.
   * @param {object} cx The context.
   * @returns {void}
   */
  scrollToPart(index, cx) {
    this.scrollTo = null;
    this.scroll.scroll_to_item(index);
    // Kept on the view: a dropped task would not fire.
    this.scrollTask = cx.timer.after(40, (cx) => {
      this.scroll.scroll_to_item(index);
      cx.notify();
    });
  }

  /**
   * Draws the header and the shown view, or Settings in place of it. Settings' parts are the
   * scroll area's own children, so it can scroll to the workspaces card.
   * @param {object} cx The render's context.
   * @returns {object} The tab.
   */
  render(cx) {
    this.syncFocus(cx);
    this.syncSettings(cx);
    this.fetchIfStale(cx);
    const t = theme();
    const wide = this.width >= WIDE;
    const config = this.config;
    const model = this.model;
    const root = v_flex()
      .id("alpmeister")
      .size_full()
      .bg(t.canvas)
      .overflow_y_scrollbar()
      .track_scroll(this.scroll)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1 || Math.abs(size.height - this.height) > 1) {
          this.width = size.width;
          this.height = size.height;
          cx.notify();
        }
      });
    if (this.tab === TABS.settings || this.inSettings) {
      // Settings' parts are the scroll area's own children, so it can scroll to a workspace.
      const parts = [this.header(t), ...this.settingsParts(cx)];
      if (this.scrollTo) this.scrollToPart(this.scrollTo === "workspaces" ? parts.length - 1 : 0, cx);
      return root.p(18).gap(14).children(parts);
    }
    if (this.scrollTo) this.scrollToPart(0, cx);
    // The Herds canvas in full tab hides the header too: the canvas takes the whole tab.
    const fullCanvas = this.tab === TABS.herds && this.herdsCanvas.full;
    let content = v_flex().w_full().p(18).gap(14).when(!fullCanvas, (el) => el.child(this.header(t)));
    if (this.tab === TABS.herds) {
      if (this.herdsFailure) content = content.child(Note(`Reading sessions failed: ${this.herdsFailure}`, t.blocked));
      content = content.child(
        Herds(this.herds, {
          model: this.herds,
          loading: this.herdsLoading,
          picking: this.picking,
          pick: (sessionId, cx) => {
            this.picking = sessionId;
            cx.notify();
          },
          link: (sessionId, address, cx) => this.linkTab(sessionId, address, cx),
          expandedAgents: this.expandedAgents,
          toggleAgents: (sessionId, cx) => this.toggleAgents(sessionId, cx),
          canvas: this.herdsCanvas,
          // In the Herds tab the canvas takes 30% of the tab (half in the demo, so its herd
          // fits large enough to read); Full tab gives it all the room under its row of
          // controls (the tab's padding, the row, the gap).
          canvasHeight: Math.max(220, Math.round(this.height * (this.demo ? 0.5 : 0.3))),
          fullHeight: Math.max(300, this.height - 36 - 30 - 8),
        }),
      );
    } else {
      if (this.configError) {
        content = content.child(
          Card(
            "settings",
            "Settings",
            [TextButton("open-settings-card", "Open Settings", (cx) => this.openSettings({}, cx))],
            Note(this.configError, t.blocked),
          ),
        );
      }
      if (this.failure) content = content.child(Note(`Refresh failed: ${this.failure}`, t.blocked));
      if (!config || !model) {
        if (!this.configError) content = content.child(Note(this.loading ? "Loading from GitHub…" : "No data yet."));
      } else {
        content = content.child(
          this.tab === TABS.today
            ? this.today(config, model, wide)
            : this.tab === TABS.board
              ? this.board(model, cx)
              : this.dashboard(config, model, wide),
        );
      }
    }
    return root.child(content);
  }
}
