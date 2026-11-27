// Alpmeister: the team lead's start-of-day view, in three views, and its settings, which the
// Settings button shows in place of the view (Back returns to it).
//   Dashboard  one workspace at a time (tiles for open bugs by priority, triage bugs, customer
//              issues and the nightly run, your review requests, PRs and issues there, the
//              Milestone card and the team in flight), or All repos: your GitHub as a whole
//              (Red checks, your review requests, PRs and issues, and the repositories).
//   Board      a workspace's board items that match its Board tab filter, a column per status.
//   Herds      your Claude Code sessions and how they are linked.
// The Today list (pins and todos) is Basecamp's Today tab (the `daypack` mod); the pins here
// add to it, in ~/.local/state/alp/focus.json.
//   Settings   everything in ~/.config/alp/alpmeister.json, as a form: a copy opened with
//              props.tab "settings" shows only this.
// It fetches when it opens, when it is shown with data over 2 hours old, and from Refresh.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Popup, ScrollHandle } from "gpui-base";
import {
  checking,
  exec,
  layout,
  panes,
  props,
  readTextFile,
  run,
  setShared,
  settings,
  shared,
  spaces,
  theme,
  watchFolder,
  window,
  writeTextFile,
} from "herdr";
import { OpenPrs, RedChecks, Repos } from "./account.js";
import { Avatars } from "./avatars.js";
import { BoardState } from "./board-state.js";
import { Board, COLUMN_PADDING, MoveToast, NoBoard } from "./board-view.js";
import {
  DEFAULT_QUERIES,
  WORKSPACE_FILTER_DEFAULTS,
  configPath,
  folderOf,
  loadConfig,
  normalizeConfig,
  stateDir,
  withCardFilter,
  withWorkspaceFilter,
  withWorkspaceSearch,
  workspaceFilter,
} from "./config.js";
import { MODEL_VERSION, loadAll, loadCardSearch, loadNoMilestone, loadPickStates, loadWorkspaceCard } from "./data.js";
import { FocusStore, pickId } from "./focus.js";
import { FilterDialog, openFilterDialog } from "./filter-dialog.js";
import { loadDemoHerds } from "./demo-herds.js";
import {
  demoCardSearch,
  demoConfig,
  demoDiscovery,
  demoFocus,
  demoModel,
  demoNoMilestone,
  demoWorkspaceCard,
} from "./demo-data.js";
import { loadHerds, saveTabLink, sessionsDir } from "./herds-data.js";
import { Herds } from "./herds-view.js";
import { HerdsCanvas } from "./herds-canvas.js";
import { InFlight } from "./in-flight.js";
import { MyIssues, MyPrs, Reviews, filterChips, narrowAccount } from "./my-day.js";
import { summaryWords, toggleTerm } from "./search-terms.js";
import { saveSettings } from "./settings-data.js";
import { MilestoneCard } from "./spotlight.js";
import { Tiles } from "./project.js";
import { SettingsForm } from "./settings-view.js";
import {
  Card,
  FilterIcon,
  ICONS,
  IconButton,
  LinkLabel,
  Note,
  TextButton,
  ago,
  announceBackgroundTab,
  fillPrompt,
  filterTooltip,
  sessionName,
  tabIdsNamed,
  warningColor,
} from "./ui.js";

const STALE_AFTER = 2 * 3600000;
/** The pause after an agents folder changes before it is watched again: agents write often. */
const AGENT_WATCH_PAUSE = 3000;
const WIDE = 1000;
const TABS = { dashboard: "dashboard", board: "board", herds: "herds", settings: "settings" };
/**
 * Other names `props.tab` (and a remembered tab) takes for a tab: the Dashboard is shown as
 * Overview, and the old Today view, whose lists are on the Overview now, opens the Overview.
 */
const TAB_ALIASES = new Map([
  ["overview", TABS.dashboard],
  ["today", TABS.dashboard],
]);
const TAB_KEY = "alpmeister.tab";
/** Set after the settings file is saved, so every other copy fetches with the new settings. */
const SETTINGS_STAMP_KEY = "alp.settingsStamp";
const WORKSPACE_KEY = "alpmeister.workspace";
/** Team in flight's old "Only the next milestone" switch (packages 2 and 16), as a JSON object of workspace name to true; read once to migrate. */
const MILESTONE_ONLY_KEY = "alpmeister.milestoneOnly";
/** Team in flight's own milestone filter, as a JSON object of workspace name to a milestone's title, or "" for No milestone; All milestones when absent. */
const IN_FLIGHT_MILESTONE_KEY = "alpmeister.inFlightMilestone";
/** The Milestone card's pick, as a JSON object of workspace name to a milestone's title, or "" for No milestone; Next when absent. */
const MILESTONE_PICK_KEY = "alpmeister.milestonePick";
/** A migrated "Only the next milestone" switch, until the workspace's next milestone is known. */
const NEXT_MILESTONE = "\u0001next";
/** The Repos card's "With open work" switch on All repos: "true" when it is on. */
const REPOS_ACTIVE_ONLY_KEY = "alpmeister.reposActiveOnly";
/** The Dashboard switch's value for your GitHub as a whole. */
const ALL_REPOS = "";
const FOCUS_STAMP_KEY = "alp.focusStamp";
/** The first run's "Add a workspace" card on All repos: "true" once "Not now" hid it. */
const ADD_WORKSPACE_DISMISSED_KEY = "alpmeister.addWorkspaceDismissed";
/** Set by Basecamp's Today tab to ask the pinned Alp to show Settings in place. */
const OPEN_SETTINGS_KEY = "alp.openSettings";
/** The views' names, as the header's tabs and Settings' "Back to <view>" show them. */
const VIEW_NAMES = { [TABS.dashboard]: "Overview", [TABS.board]: "Board", [TABS.herds]: "Herds" };
/** The Alp layout's stack that shows the terminals or, pinned in their place, Alpmeister. */
const WORK_STACK = "work-stack";
const WORK_BODY = "work-body";
const ALPMEISTER_VIEW = "alpmeister-view";
/** Bumped after a filter dialog saved, so the copy that opened it redraws. */
const FILTER_STAMP_KEY = "alpmeister.filterStamp";
/** Where each of your lists' count sits in the account's `counts`, by its search's key. */
const CARD_LISTS = { review: "reviews", myPrs: "myPrs", mine: "mine" };
/** Each filtered card's name, as its title and the filter dialog's title say it. */
const CARD_NAMES = {
  review: "Waiting for your review",
  myPrs: "Your open PRs",
  mine: "Your issues",
  bugs: "Open bugs",
  triage: "Triage bugs",
  customer: "Customer issues",
  prs: "Open PRs",
};

/**
 * The count a workspace's Overview card shows, from the workspace's model.
 * @param {object | undefined} wsModel The workspace's model.
 * @param {"bugs" | "triage" | "customer" | "prs"} key The card.
 * @returns {number | null} The count, or null before the card is loaded.
 */
function workspaceCardCount(wsModel, key) {
  if (!wsModel) return null;
  if (key === "bugs") return wsModel.bugs?.total ?? null;
  if (key === "triage") return wsModel.counts?.triage ?? null;
  if (key === "customer") return wsModel.customer?.count ?? null;
  return wsModel.openPrsTotal ?? null;
}

/**
 * The id of a workspace Overview card's filter, as `filterTarget` reads it.
 * @param {string} name The workspace's name.
 * @param {"bugs" | "triage" | "customer" | "prs"} key The card.
 * @returns {string} Such as "ws:Website:bugs".
 */
const wsFilterId = (name, key) => `ws:${name}:${key}`;

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
 * A remembered choice per workspace: a JSON object of workspace name to a string.
 * @param {string} key The local storage key.
 * @returns {Record<string, string> | null} The choices; null when nothing is remembered.
 */
function rememberedChoices(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!saved || typeof saved !== "object") return null;
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string"));
  } catch (error) {
    console.log(`alpmeister: no remembered ${key}: ${error}`);
    return null;
  }
}

/**
 * Remembers a choice per workspace.
 * @param {string} key The local storage key.
 * @param {Record<string, string>} choices Workspace name to its choice.
 * @returns {void}
 */
function rememberChoices(key, choices) {
  try {
    localStorage.setItem(key, JSON.stringify(choices));
  } catch (error) {
    console.log(`alpmeister: ${key} not remembered: ${error}`);
  }
}

/**
 * Team in flight's milestone filter per workspace, as remembered. The first time, the old
 * "Only the next milestone" switch is carried over: on becomes the next milestone (resolved once
 * the workspace's milestones are loaded), off is All milestones.
 * @returns {Record<string, string>} Workspace name to a milestone's title, "" or `NEXT_MILESTONE`.
 */
function rememberedInFlightMilestones() {
  const saved = rememberedChoices(IN_FLIGHT_MILESTONE_KEY);
  if (saved) return saved;
  try {
    const old = localStorage.getItem(MILESTONE_ONLY_KEY);
    if (old == null) return {};
    const raw = JSON.parse(old) ?? {};
    const migrated = Object.fromEntries(
      Object.keys(raw)
        .filter((name) => raw[name] === true)
        .map((name) => [name, NEXT_MILESTONE]),
    );
    rememberChoices(IN_FLIGHT_MILESTONE_KEY, migrated);
    localStorage.removeItem(MILESTONE_ONLY_KEY);
    return migrated;
  } catch (error) {
    console.log(`alpmeister: old milestone switch not carried over: ${error}`);
    return {};
  }
}

/**
 * Whether a switch stored as "true" in this copy's storage is on.
 * @param {string} key The storage key.
 * @returns {boolean} True when it is; false when nothing is remembered.
 */
function rememberedFlag(key) {
  try {
    return localStorage.getItem(key) === "true";
  } catch (error) {
    console.log(`alpmeister: ${key} not read: ${error}`);
    return false;
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
    // A copy opened with `props.part` "filter" is the filter dialog another copy opened.
    this.dialog = props()?.part === "filter" ? new FilterDialog(cx) : null;
    if (this.dialog) return;
    this.config = null;
    this.configError = null;
    this.model = null;
    this.loading = false;
    this.refreshAgain = false;
    this.configText = null;
    // `props.workspace` opens a copy on that workspace's Dashboard; "" is All repos.
    this.workspaceName = typeof props()?.workspace === "string" ? props().workspace : rememberedWorkspace();
    this.reposActiveOnly = rememberedReposActiveOnly();
    this.addWorkspaceDismissed = rememberedFlag(ADD_WORKSPACE_DISMISSED_KEY);
    this.failure = null;
    // Per workspace: the Milestone card's pick (absent: Next) and Team in flight's own milestone
    // filter (absent: All milestones). A title, or "" for No milestone.
    this.milestonePick = this.demo ? {} : (rememberedChoices(MILESTONE_PICK_KEY) ?? {});
    this.inFlightMilestone = this.demo ? {} : rememberedInFlightMilestones();
    // Per workspace: the Milestone card's pressed flag ("unassigned" or "notStarted"), not remembered.
    this.milestoneFlag = {};
    // Per workspace: the open issues without a milestone, fetched when the card shows No milestone:
    // `{ parts, fetchedFor }`, `{ loading: true }` or `{ error }`.
    this.noMilestone = {};
    // The Board narrowed to one milestone from the Milestone card's link: `{ ws, title }` (title
    // null for No milestone), until "Show every milestone" or another tab.
    this.boardMilestone = null;
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
    // With `props.firstRun` too, the demo is a first run: no settings file, so no workspace.
    this.demoFirstRun = this.demo && props()?.firstRun === true;
    this.herds = null;
    this.herdsLoading = false;
    this.herdsAgain = false;
    this.herdsWatching = false;
    this.agentWatches = new Map();
    this.expandedAgents = new Set();
    this.herdsFailure = null;
    this.picking = null;
    // `props.herdsView` ("map" or "cards") and `props.herdsFull` open Herds on that view, for demos
    // and screenshots; otherwise it opens on Cards in a tab and on the Map in full tab.
    this.herdsCanvas = new HerdsCanvas({ view: props()?.herdsView, full: props()?.herdsFull === true });
    this.focus = new FocusStore(this.demo ? demoFocus() : null);
    this.focusStamp = shared(FOCUS_STAMP_KEY) ?? null;
    // What a filter dialog (another copy) left for this copy's own context: see `runQueued`.
    this.queued = [];
    this.settings = new SettingsForm((cx) => this.announceSettings(cx));
    // Settings › Card filters' Edit opens the same dialog as the cards; its Save writes at once.
    this.settings.onEditFilter = (row) =>
      this.openFilter(row.workspace === null ? row.key : wsFilterId(row.workspace, row.key), {
        start: row.value,
        after: (query, written) => this.settings.filterSaved(row.id, query, written),
      });
    if (this.demo) this.settings.useDemo(demoDiscovery(demoConfig().config));
    this.settingsStamp = shared(SETTINGS_STAMP_KEY) ?? null;
    this.openSettingsStamp = shared(OPEN_SETTINGS_KEY) ?? null;
    // Settings shown in place of the view, with "Back to <view>"; its edits stay while Alp is open.
    this.inSettings = false;
    // A save while Settings shows in place fetches again on Back.
    this.fetchOnBack = false;
    // "top" once drawn scrolls the view, or Settings' page, back to its top.
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
    const { config, error, text } = this.demo ? this.demoSettings() : await loadConfig();
    this.config = config ?? null;
    this.configError = error ?? null;
    this.configText = text;
    if (config && !this.settings.dirty()) this.settings.load(config, text);
    return config ?? null;
  }

  /**
   * The demo's settings. With `props.firstRun` too, the demo is a first run: no settings file,
   * so no workspaces, and Overview's All repos shows the "Add a workspace" card.
   * @returns {{ config: object, text: string | null }}
   */
  demoSettings() {
    const demo = demoConfig();
    if (!this.demoFirstRun) return demo;
    return { config: { ...demo.config, workspaces: [] }, text: null };
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
   * Shows Settings in place when Basecamp's Today tab asked for it (a dashed Claude button or the
   * key's "set it in Settings" there), in the pinned Alp only. Called from `render`.
   * @param {object} cx The render's context.
   * @returns {void}
   */
  syncOpenSettings(cx) {
    const stamp = shared(OPEN_SETTINGS_KEY) ?? null;
    if (stamp === this.openSettingsStamp) return;
    this.openSettingsStamp = stamp;
    if (!props()?.pane && this.tab !== TABS.settings && !this.inSettings) this.openSettings({}, cx);
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
   * Shows Settings in place of the view, with "Back to <view>", on the page it showed last.
   * Edits not saved yet are still there. Given a workspace, Settings opens on its page, with one
   * of its dropdowns open when `picker` names one ("ws-board" for the board picker). The
   * settings copy shows Settings already.
   * @param {{ workspace?: string | null, picker?: string }} [options] Where Settings opens.
   * @param {object} [cx] The context, to redraw.
   * @returns {void}
   */
  openSettings({ workspace, picker } = {}, cx) {
    if (this.tab === TABS.settings) return;
    this.inSettings = true;
    this.pickerOpen = null;
    if (workspace != null) this.settings.showWorkspace(workspace, { picker });
    this.scrollTo = "top";
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
   * What a card's filter edits: one of your lists' searches (`account.queries`, the same on All
   * repos and on a workspace), or one of a workspace's Overview cards (`ws:<workspace>:<key>`).
   * @param {string} id The filter's id: "review", "myPrs", "mine", or `wsFilterId(name, key)`.
   * @returns {{ ws: object | null, key: string, saved: string, fallback: string }} The workspace
   *   (null for one of your lists), the card's key, the search the settings hold, and the default.
   */
  filterTarget(id) {
    if (!id.startsWith("ws:")) {
      return { ws: null, key: id, saved: this.config?.account.queries[id] ?? DEFAULT_QUERIES[id], fallback: DEFAULT_QUERIES[id] };
    }
    const key = id.slice(id.lastIndexOf(":") + 1);
    const name = id.slice(3, id.lastIndexOf(":"));
    const ws = this.config?.workspaces.find((each) => each.name === name) ?? null;
    const fallback = WORKSPACE_FILTER_DEFAULTS[key];
    return { ws, key, saved: ws ? workspaceFilter(ws, key) : fallback, fallback };
  }

  /**
   * Whether a card's saved filter is other than its default: its filter icon then has a dot. An
   * edit lives only in the filter dialog; the card always shows the saved filter.
   * @param {string} id The filter's id.
   * @returns {boolean}
   */
  cardFilterSaved(id) {
    const { saved, fallback } = this.filterTarget(id);
    return saved !== fallback;
  }

  /**
   * A card's filter in words, for its icon's tooltip: "bugs only · open"; Customer issues
   * filters by part of a label's name: "labels with customer".
   * @param {string} id The filter's id.
   * @param {string} query The search.
   * @returns {string}
   */
  filterWords(id, query) {
    if (this.filterTarget(id).key !== "customer") return summaryWords(query);
    return query ? `labels with ${query}` : "any label";
  }

  /**
   * The count a card shows now, from the loaded data.
   * @param {string} id The filter's id.
   * @returns {number | null} The count, or null before the card is loaded.
   */
  cardCount(id) {
    const { ws, key } = this.filterTarget(id);
    if (!ws) return this.model?.account?.counts?.[CARD_LISTS[key]] ?? null;
    return workspaceCardCount(this.model?.workspaces?.[ws.name], key);
  }

  /**
   * What the filter dialog draws for a card: its title, the chips (the card's own under Show, the
   * search's labels and "+ Label" under Labels), the field and the card's count now. Customer
   * issues filters by part of a label's name, not a search, so it has no chips.
   * @param {string} id The filter's id.
   * @param {{ query: string }} draft The dialog's edit.
   * @returns {import("./filter-dialog.js").DialogSpec}
   */
  filterSpec(id, draft) {
    const { ws, key } = this.filterTarget(id);
    const prefix = id.replace(/[^\w-]/g, "_");
    // Settings lists every workspace's cards, so its dialog names the workspace too.
    const where = ws && (this.inSettings || this.tab === TABS.settings) ? ` · ${ws.name}` : "";
    const customer = key === "customer";
    const chips = customer ? [] : filterChips(key, draft.query);
    const own = chips.filter((entry) => !entry.term.startsWith("label:"));
    const labels = chips.filter((entry) => entry.term.startsWith("label:"));
    const chip = (entry, index) => ({
      id: `${prefix}-chip-${index}`,
      label: entry.label,
      on: entry.on,
      tooltip: entry.term,
      press: (edit) => ({ ...edit, query: toggleTerm(edit.query, entry.term) }),
    });
    const groups = customer
      ? []
      : [
          { label: "Show", chips: own.map(chip) },
          {
            label: "Labels",
            chips: [
              ...labels.map((entry, index) => chip(entry, own.length + index)),
              { id: `${prefix}-label`, label: "+ Label", on: false, add: true, press: "label" },
            ],
          },
        ];
    return {
      title: `Filter: ${CARD_NAMES[key]}${where}`,
      groups,
      inputLabel: customer ? "Label contains" : "GitHub search",
      placeholder: customer ? "Part of a label's name, such as customer" : "A GitHub search, such as is:issue is:open type:Bug",
      hint: customer
        ? "Counts open issues with a label whose name has this in it. Enter updates the preview."
        : "The chips write this. Enter updates the preview.",
      noun: ["review", "myPrs", "prs"].includes(key) ? ["PR", "PRs"] : ["issue", "issues"],
      now: this.cardCount(id),
      saveLabel: "Save for this card",
      demo: this.demo,
    };
  }

  /**
   * Counts what a card would show with a search, for the filter dialog, without touching the
   * card. In the demo it counts the made-up items. A copy that has loaded nothing (the Settings
   * tab) counts with GitHub's search alone.
   * @param {string} id The filter's id.
   * @param {string} query The search.
   * @returns {Promise<number>}
   * @throws {Error} With GitHub's message when it refuses the search.
   */
  async filterCount(id, query) {
    const { ws, key } = this.filterTarget(id);
    const config = this.config;
    if (!config) throw new Error("The settings aren't read yet.");
    if (id.startsWith("ws:") && !ws) throw new Error("This workspace isn't in the settings file yet.");
    const base = this.model ?? (this.demo ? demoModel(config) : null);
    if (!ws) {
      const picked = Array.isArray(config.account.repos) ? config.account.repos : [];
      const account = base?.account ?? { repos: picked.map((repo) => ({ repo })), counts: {}, queries: {} };
      const next = this.demo ? demoCardSearch(account, key, query) : await loadCardSearch(config, account, key, query);
      return next.counts[CARD_LISTS[key]] ?? 0;
    }
    const wsModel = base?.workspaces?.[ws.name] ?? { queries: {}, errors: {}, counts: {} };
    const edited = withWorkspaceSearch(ws, key, query);
    const next = this.demo ? demoWorkspaceCard(edited, wsModel, key) : await loadWorkspaceCard(edited, wsModel, key);
    return workspaceCardCount(next, key) ?? 0;
  }

  /**
   * Runs one card's search and puts its result in the model, leaving the other cards as they
   * are. In the demo it filters the made-up items instead.
   * @param {string} id The filter's id.
   * @param {string} query The search.
   * @returns {Promise<void>}
   * @throws {Error} With GitHub's message when it refuses the search.
   */
  async searchCard(id, query) {
    const { ws, key } = this.filterTarget(id);
    if (!this.config || !this.model) return;
    if (!ws) {
      const account = this.model.account;
      if (!account) return;
      const next = this.demo ? demoCardSearch(account, key, query) : await loadCardSearch(this.config, account, key, query);
      this.model = { ...this.model, account: next };
      return;
    }
    const wsModel = this.model.workspaces?.[ws.name];
    if (!wsModel) return;
    const edited = withWorkspaceSearch(ws, key, query);
    const next = this.demo ? demoWorkspaceCard(edited, wsModel, key) : await loadWorkspaceCard(edited, wsModel, key);
    this.model = { ...this.model, workspaces: { ...this.model.workspaces, [ws.name]: next } };
  }

  /**
   * Writes one card's search to the settings file, through `saveSettings` (which keeps the old
   * file as alpmeister.json.bak), or removes it so the card goes back to its default. Everything
   * else in the file stays as it was.
   * @param {string} id The filter's id.
   * @param {string | null} query The search to save, or null to remove it.
   * @returns {Promise<string>} The file's text now.
   * @throws {Error} When the file can't be read, has lost the workspace, or changed on disk meanwhile.
   */
  async writeCardFilter(id, query) {
    const { ws, key } = this.filterTarget(id);
    const text = await readTextFile(configPath());
    let raw = {};
    try {
      raw = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`${configPath()} is not valid JSON: ${error}`);
    }
    const index = ws ? this.config.workspaces.findIndex((each) => each.name === ws.name) : -1;
    const next = ws ? withWorkspaceFilter(raw ?? {}, index, key, query) : withCardFilter(raw ?? {}, key, query);
    const written = await saveSettings(next, text);
    this.settingsSaved(normalizeConfig(next), written);
    return written;
  }

  /**
   * The filter dialog's Save: writes the card's search to the settings file at once (only that
   * card's key; the default removes it), then fetches that card again. Unchanged, nothing is
   * written. In the demo the settings change for this copy only, and nothing is written.
   * @param {string} id The filter's id.
   * @param {string} query The search.
   * @returns {Promise<string | null>} The file's text after the write, or null when nothing was written.
   * @throws {Error} When the workspace isn't saved yet, or the write fails.
   */
  async saveCardFilter(id, query) {
    const { ws, key, saved, fallback } = this.filterTarget(id);
    if (id.startsWith("ws:") && !ws) throw new Error("Save this workspace in Settings first: it isn't in the settings file yet.");
    if (query === saved) return null;
    let written = null;
    if (this.demo) {
      const config = this.config;
      this.config = ws
        ? { ...config, workspaces: config.workspaces.map((each) => (each.name === ws.name ? withWorkspaceSearch(each, key, query) : each)) }
        : { ...config, account: { ...config.account, queries: { ...config.account.queries, [key]: query } } };
    } else {
      written = await this.writeCardFilter(id, query === fallback ? null : query);
    }
    try {
      await this.searchCard(id, query);
    } catch (error) {
      console.log(`alpmeister: ${id} not fetched after its filter was saved: ${error?.message ?? error}`);
    }
    return written;
  }

  /**
   * Opens the filter dialog on a card. It starts on the saved filter, or on `start`; Save writes
   * it and `after` then hears what was saved (Settings › Card filters keeps its draft in step).
   * @param {string} id The filter's id.
   * @param {{ start?: string, after?(query: string, written: string | null): void }} [options]
   * @returns {void}
   */
  openFilter(id, { start, after } = {}) {
    const { saved, fallback } = this.filterTarget(id);
    openFilterDialog({
      start: { query: start ?? saved },
      fallback: { query: fallback },
      spec: (draft) => this.filterSpec(id, draft),
      count: (draft) => this.filterCount(id, draft.query.trim()),
      save: async (draft) => {
        const written = await this.saveCardFilter(id, draft.query);
        after?.(draft.query, written);
        this.filterDone();
      },
    });
  }

  /**
   * Redraws this copy after its filter dialog saved: the dialog is another copy, so it can't
   * redraw this one; shared state changing redraws every copy.
   * @returns {void}
   */
  filterDone() {
    setShared(FILTER_STAMP_KEY, Date.now());
  }

  /**
   * Runs what the filter dialog left for this copy's own context, such as keeping the Board's
   * people on this computer. Called from `render`.
   * @param {object} _cx The render's context.
   * @returns {void}
   */
  runQueued(_cx) {
    shared(FILTER_STAMP_KEY);
    const queued = this.queued.splice(0);
    for (const task of queued) task();
  }

  /**
   * A card's filter icon, for a tile's or a card header's top-right corner: it opens the filter
   * dialog, has a dot when the saved filter isn't the default, and says the filter on hover.
   * @param {string} id The filter's id.
   * @returns {object} The icon button.
   */
  cardFilter(id) {
    const { saved: query } = this.filterTarget(id);
    const saved = this.cardFilterSaved(id);
    return FilterIcon(`cf-${id.replace(/[^\w-]/g, "_")}`, {
      saved,
      tooltip: filterTooltip(this.filterWords(id, query), saved),
      onOpen: () => this.openFilter(id),
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

  /** Tells Basecamp's Today tab (and its count) that the focus list changed on disk. */
  announceFocus() {
    if (this.demo) return;
    this.focusStamp = Date.now();
    setShared(FOCUS_STAMP_KEY, this.focusStamp);
  }

  /** Reloads the focus list when Basecamp's Today tab changed it, so the pins show lit. */
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

  /**
   * Saves the focus list, tells Basecamp's Today tab, then redraws.
   * @param {object} cx The context.
   * @returns {void}
   */
  persist(cx) {
    cx.spawn(async (cx) => {
      await this.focus.save();
      this.announceFocus();
      cx.notify();
    });
    cx.notify();
  }

  /**
   * A pin control for a row: "Pin to Today" (the list in Basecamp's Today tab), or, lit in the
   * accent color, "Unpin from Today" for an item already on it.
   * @param {string} prefix Keeps ids unique when an item shows in two widgets.
   * @returns {(item: object) => object} Draws the pin for an item.
   */
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
          tooltip: pinned ? "Unpin from Today" : "Pin to Today",
          color: pinned ? theme().accent : undefined,
          label: pinned ? "Unpin" : "Pin",
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

  /**
   * The actions every row with a Claude button needs. `openSettings` is for a Claude button
   * whose prompt is not set.
   * @returns {{ launch: Function, prompt: Function, openSettings: Function }}
   */
  launchActions() {
    return {
      launch: (item, options) => this.launch(item, options),
      prompt: (kind) => this.prompt(kind),
      openSettings: (cx) => this.openSettings({}, cx),
    };
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
   * Opens or closes one of the milestone dropdowns (the Milestone card's, "ms-card", or Team in
   * flight's, "ms-if"). A press on the button that just closed it (outside the list) leaves it shut.
   * @param {string} key The dropdown.
   * @param {object} cx The context.
   */
  toggleMenu(key, cx) {
    const justClosed = Date.now() - (this.pickerClosedAt ?? 0) < 400;
    this.pickerOpen = this.pickerOpen === key || justClosed ? null : key;
    cx.notify();
  }

  /**
   * Closes a dropdown after a press outside it.
   * @param {string} key The dropdown.
   * @param {object} cx The context.
   */
  closeMenu(key, cx) {
    if (this.pickerOpen !== key) return;
    this.pickerOpen = null;
    this.pickerClosedAt = Date.now();
    cx.notify();
  }

  /**
   * Shows a milestone on a workspace's Milestone card, and remembers it for that workspace:
   * null goes back to Next, "" is No milestone (its issues are fetched then).
   * @param {object} ws The workspace.
   * @param {string | null} pick The milestone's title, "" or null.
   * @param {object} cx The context.
   */
  pickMilestone(ws, pick, cx) {
    this.pickerOpen = null;
    delete this.milestoneFlag[ws.name];
    if (pick === null) delete this.milestonePick[ws.name];
    else this.milestonePick[ws.name] = pick;
    if (!this.demo) rememberChoices(MILESTONE_PICK_KEY, this.milestonePick);
    cx.notify();
  }

  /**
   * Shows one milestone in a workspace's Team in flight, or all (null), or the issues without
   * one (""), and remembers it for that workspace.
   * @param {string} name The workspace's name.
   * @param {string | null} pick The milestone's title, "" or null.
   * @param {object} cx The context.
   */
  pickInFlightMilestone(name, pick, cx) {
    this.pickerOpen = null;
    if (pick === null) delete this.inFlightMilestone[name];
    else this.inFlightMilestone[name] = pick;
    if (!this.demo) rememberChoices(IN_FLIGHT_MILESTONE_KEY, this.inFlightMilestone);
    cx.notify();
  }

  /**
   * Lists a flag's issues on the Milestone card in place of its Issues, or the Issues again.
   * @param {string} name The workspace's name.
   * @param {"unassigned" | "notStarted"} flag The flag pressed.
   * @param {object} cx The context.
   */
  toggleMilestoneFlag(name, flag, cx) {
    if (this.milestoneFlag[name] === flag) delete this.milestoneFlag[name];
    else this.milestoneFlag[name] = flag;
    cx.notify();
  }

  /**
   * The Milestone card's pick and Team in flight's filter for a workspace, as they apply to its
   * loaded milestones: a picked milestone that has closed goes back to Next (and All), and a
   * carried-over "Only the next milestone" becomes the next one. Both are remembered again
   * when they change.
   * @param {object} ws The workspace.
   * @param {object} wsModel The workspace's model.
   * @returns {{ pick: string | null, inFlight: string | null }}
   */
  milestoneChoices(ws, wsModel) {
    const data = wsModel.milestones;
    const open = (title) => !data || data.list.some((milestone) => milestone.title === title);
    let pick = this.milestonePick[ws.name] ?? null;
    if (pick && data && !open(pick)) {
      delete this.milestonePick[ws.name];
      if (!this.demo) rememberChoices(MILESTONE_PICK_KEY, this.milestonePick);
      pick = null;
    }
    let inFlight = this.inFlightMilestone[ws.name] ?? null;
    // undefined: no change. A carried-over switch waits for the repository's milestones; a
    // workspace without a repository had no next milestone, so it showed all.
    let changed;
    if (inFlight === NEXT_MILESTONE && (data || !ws.repo)) changed = data?.next ?? null;
    else if (inFlight && inFlight !== NEXT_MILESTONE && !open(inFlight)) changed = null;
    if (changed !== undefined) {
      if (changed === null) delete this.inFlightMilestone[ws.name];
      else this.inFlightMilestone[ws.name] = changed;
      if (!this.demo) rememberChoices(IN_FLIGHT_MILESTONE_KEY, this.inFlightMilestone);
      inFlight = changed;
    }
    return { pick, inFlight: inFlight === NEXT_MILESTONE ? null : inFlight };
  }

  /**
   * The open issues without a milestone for a workspace's Milestone card, fetched the first time
   * they are shown and again after each refresh.
   * @param {object} ws The workspace, with a repository.
   * @param {object} wsModel The workspace's model.
   * @param {object} cx The context.
   * @returns {{ parts?: object, error?: string } | null} What is known so far.
   */
  noMilestoneFor(ws, wsModel, cx) {
    const known = this.noMilestone[ws.name];
    if (known?.loading || (known && known.fetchedFor === wsModel.fetchedAt)) return known;
    if (this.demo) {
      this.noMilestone[ws.name] = { parts: demoNoMilestone(ws), fetchedFor: wsModel.fetchedAt };
      return this.noMilestone[ws.name];
    }
    this.noMilestone[ws.name] = { ...(known ?? {}), loading: true };
    cx.spawn(async (cx) => {
      try {
        this.noMilestone[ws.name] = { parts: await loadNoMilestone(ws), fetchedFor: wsModel.fetchedAt };
      } catch (error) {
        this.noMilestone[ws.name] = { error: String(error?.message ?? error), fetchedFor: wsModel.fetchedAt };
      }
      cx.notify();
    });
    return known ?? null;
  }

  /**
   * Shows the Board on a workspace with only one milestone's items, from the Milestone card.
   * @param {object} ws The workspace, with a board.
   * @param {string | null} title The milestone, or null for the items without one.
   * @param {object} cx The context.
   */
  openMilestoneOnBoard(ws, title, cx) {
    this.boardMilestone = { ws: ws.name, title };
    this.selectTab(TABS.board, cx);
  }

  /** Shows one of the tabs and remembers it for this copy. */
  selectTab(tab, cx) {
    this.tab = tab;
    if (tab !== TABS.board) this.boardMilestone = null;
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
   * The views as underlined tabs: Overview, Board and Herds.
   * @param {object} t The theme.
   * @returns {object} The row of tabs.
   */
  tabs(t) {
    const tab = (name) => {
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
        .child(VIEW_NAMES[name]);
    };
    return h_flex()
      .gap(14)
      .items_center()
      .child(tab(TABS.dashboard))
      .child(tab(TABS.board))
      .child(tab(TABS.herds));
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
   * A dim line that ends in "Open Settings →", the gear on its left; a click opens Settings on a workspace.
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
      .child(div().text_size(12).font_medium().text_color(t.accent).child(LinkLabel(ICONS.settings, "Open Settings →")));
  }

  /**
   * Opens Settings on a new workspace's page, with one of its dropdowns open when `picker` names
   * one. Like "+ Add workspace" there, it is an unsaved change until Save.
   * @param {{ picker?: string }} options The dropdown to open, such as "ws-repo".
   * @param {object} cx The context.
   * @returns {void}
   */
  addWorkspace({ picker } = {}, cx) {
    this.openSettings({}, cx);
    if (this.inSettings || this.tab === TABS.settings) this.settings.addWorkspace(cx, { picker });
  }

  /**
   * The first run's card on All repos, while there is no workspace: what All repos is, "Add a
   * workspace" and "Not now", which hides it for good on this computer (for this copy, in the demo).
   * @param {object} t The theme.
   * @returns {object | null} The card, or null once dismissed or with a workspace.
   */
  firstRunCard(t) {
    if (this.addWorkspaceDismissed || (this.config?.workspaces.length ?? 0) > 0) return null;
    const dismiss = (cx) => {
      this.addWorkspaceDismissed = true;
      if (!this.demo) {
        try {
          localStorage.setItem(ADD_WORKSPACE_DISMISSED_KEY, "true");
        } catch (error) {
          console.log(`alpmeister: "Not now" not remembered: ${error}`);
        }
      }
      cx.notify();
    };
    return h_flex()
      .id("first-run")
      .w_full()
      .p(14)
      .gap(14)
      .items_center()
      .rounded(10)
      .border_1()
      .border_color(t.accent)
      .bg(t.selected)
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("This is every repo you can reach."))
          .child(
            div().text_size(12).text_color(t.muted).child("Add a workspace to see one team's board, bugs and milestones."),
          ),
      )
      .child(
        h_flex()
          .id("first-run-add")
          .flex_none()
          .h(28)
          .px(12)
          .items_center()
          .rounded(6)
          .bg(t.accent)
          .text_size(12)
          .font_semibold()
          .text_color(t.accent_foreground ?? t.background)
          .cursor_pointer()
          .hover((style) => style.opacity(0.85))
          .on_click((_event, cx) => this.addWorkspace({ picker: "ws-repo" }, cx))
          .child(LinkLabel(ICONS.settings, "Add a workspace")),
      )
      .child(TextButton("first-run-dismiss", "Not now", dismiss, { tooltip: "Hide this; Settings adds a workspace any time" }));
  }

  /**
   * Opens Settings at the board picker of a workspace without a board: the one the Overview shows
   * when it has none, else the first one; with no workspace yet, on a new one.
   * @param {object} cx The context.
   * @returns {void}
   */
  addBoard(cx) {
    const workspaces = this.config?.workspaces ?? [];
    const shown = this.shownWorkspace();
    const target = shown && !shown.board ? shown : (workspaces.find((ws) => !ws.board) ?? workspaces[0]);
    if (target) this.openSettings({ workspace: target.name, picker: "ws-board" }, cx);
    else this.addWorkspace({ picker: "ws-board" }, cx);
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
    const t = theme();
    const switcher = this.workspaceSwitch(t, { boards, shown: ws.name });
    let wsModel = model.workspaces?.[ws.name];
    // Narrowed from the Milestone card's "Open v2.4 on the Board →": only that milestone's items.
    const only = this.boardMilestone?.ws === ws.name ? this.boardMilestone : null;
    if (only && wsModel?.boardView) {
      const items = wsModel.boardView.items.filter((item) => (item.milestone?.title ?? null) === only.title);
      wsModel = { ...wsModel, boardView: { ...wsModel.boardView, items, total: items.length } };
    }
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
      .when(Boolean(only), (el) =>
        el.child(
          h_flex()
            .gap(8)
            .items_center()
            .child(
              div()
                .text_size(12)
                .text_color(t.foreground)
                .child(only.title === null ? "Only the items without a milestone" : `Only the items in ${only.title}`),
            )
            .child(
              TextButton("bv-every-milestone", "Show every milestone", (cx) => {
                this.boardMilestone = null;
                cx.notify();
              }),
            ),
        ),
      )
      .child(
        Board(ws, wsModel, {
          ...this.launchActions(),
          loading: this.loading,
          avatarPath: (login) => this.avatars.path(login),
          ...state.options(ws),
          pinFor: (prefix) => this.pinFor(prefix),
        }),
      );
  }

  /**
   * The Dashboard tab: All repos (Red checks, your review requests, PRs and issues, and every
   * repository in scope), or one workspace (its tiles, your lists narrowed to its repositories,
   * the Milestone card, and the team in flight or the open PRs). A workspace with only a board
   * says what adding a repository would show.
   * @param {object} config The settings.
   * @param {object} model The fetched model.
   * @param {boolean} wide Whether the tab is wide enough for four tiles across.
   * @param {object} cx The render's context, to fetch the issues without a milestone when shown.
   * @returns {object} The tab's content.
   */
  dashboard(config, model, wide, cx) {
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
      const firstRun = this.firstRunCard(t);
      if (firstRun) content = content.child(firstRun);
      if (!account) return content.child(Note(this.loading ? "Loading from GitHub…" : "No data yet."));
      return content
        .child(this.myLists(config, account, wide, RedChecks(account)))
        .child(
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
    const choices = this.milestoneChoices(ws, wsModel);
    if (ws.repo) {
      content = content.child(
        Tiles(ws, wsModel, {
          wide,
          onSettings: (cx) => this.openSettings({ workspace: ws.name }, cx),
          filter: (key) => this.cardFilter(wsFilterId(ws.name, key)),
        }),
      );
    }
    // Your lists, narrowed to the workspace: after its tiles, before the team's cards.
    if (model.account) content = content.child(this.myLists(config, narrowAccount(model.account, ws, wsModel), wide));
    if (ws.repo) {
      content = content.child(
        MilestoneCard(ws, wsModel, {
          expanded: this.expandedGroups,
          onToggleGroup,
          pinButton: this.pinFor("sp"),
          pick: choices.pick,
          menuOpen: this.pickerOpen === "ms-card",
          onToggleMenu: (cx) => this.toggleMenu("ms-card", cx),
          onCloseMenu: (cx) => this.closeMenu("ms-card", cx),
          onPick: (pick, cx) => this.pickMilestone(ws, pick, cx),
          noMilestone: choices.pick === "" && wsModel.milestones ? this.noMilestoneFor(ws, wsModel, cx) : null,
          flag: this.milestoneFlag[ws.name] ?? null,
          onFlag: (flag, cx) => this.toggleMilestoneFlag(ws.name, flag, cx),
          onBoard: ws.board ? (title, cx) => this.openMilestoneOnBoard(ws, title, cx) : null,
        }),
      );
    }
    if (ws.board) {
      content = content.child(
        InFlight(ws, wsModel, {
          milestone: choices.inFlight,
          menuOpen: this.pickerOpen === "ms-if",
          onToggleMenu: (cx) => this.toggleMenu("ms-if", cx),
          onCloseMenu: (cx) => this.closeMenu("ms-if", cx),
          onPick: (pick, cx) => this.pickInFlightMilestone(ws.name, pick, cx),
          expanded: this.expandedGroups,
          onToggleGroup,
          pinButton: this.pinFor("if"),
        }),
      );
    } else if (ws.repo) {
      content = content.child(
        OpenPrs(ws, wsModel, {
          ...this.launchActions(),
          pinButton: this.pinFor("op"),
          expanded: this.expandedGroups,
          onToggleGroup,
          filter: this.cardFilter(wsFilterId(ws.name, "prs")),
        }),
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
   * Your three lists, as the Today view showed them: review requests and your PRs in one column
   * and your issues in the other when wide, else one under the other. Each has its pins, Claude
   * buttons and filter icon.
   * @param {object} config The settings.
   * @param {object} account The account model, or one narrowed to a workspace (`narrowAccount`).
   * @param {boolean} wide Whether the lists go side by side.
   * @param {object | null} [aside] A tile over your issues when wide (All repos' Red checks), else
   *   over every list.
   * @returns {object} The lists.
   */
  myLists(config, account, wide, aside = null) {
    const actions = { ...this.launchActions(), filter: (key) => this.cardFilter(key) };
    const reviews = Reviews(account, { ...actions, pinButton: this.pinFor("rv") });
    const mine = MyIssues(config, account, { ...actions, pinButton: this.pinFor("mi") });
    const myPrs = MyPrs(account, { ...actions, pinButton: this.pinFor("mp") });
    return wide
      ? h_flex()
          .gap(14)
          .items_start()
          .child(v_flex().flex_1().min_w(0).gap(14).child(reviews).child(myPrs))
          .child(v_flex().flex_1().min_w(0).gap(14).when(Boolean(aside), (el) => el.child(h_flex().child(aside))).child(mine))
      : v_flex().gap(14).when(Boolean(aside), (el) => el.child(h_flex().child(aside))).child(reviews).child(myPrs).child(mine);
  }

  /** Starts the Settings form over from the file, dropping unsaved edits. */
  revertSettings(cx) {
    cx.spawn(async (cx) => {
      const { config, error, text } = this.demo ? this.demoSettings() : await loadConfig();
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
   * Settings under the header, for Settings in place and the settings copy: the side list, the
   * page in the scroll area, and the save bar.
   * @param {object} cx The context.
   * @returns {object} The element.
   */
  settingsView(cx) {
    return this.settings.view(cx, {
      scroll: this.scroll,
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
   * Forgets a filter dialog's session once its copy closes.
   * @returns {Promise<void>}
   */
  async close() {
    this.dialog?.close();
  }

  /**
   * The Board's toast after a move, floating at the bottom left of what Alp's view shows (over
   * the scroll area, not in it), so it stays in view on a board taller than the window. Its left
   * edge lines up with the board's columns.
   * @param {object} t The theme.
   * @returns {object | null} The overlay, or null when the Board shows no toast.
   */
  toastOverlay(t) {
    const state = this.boardState;
    if (this.tab !== TABS.board || !state.toast) return null;
    const toast = MoveToast(t, state.toast, (cx) => state.toast?.undo?.(cx));
    // The page's padding, the card's border and padding, and a column's padding. The toast's own
    // fill is see-through, so an opaque one under it keeps the cards behind from showing; a
    // press on it stays off the cards under it.
    return div()
      .id("toast-overlay")
      .absolute()
      .left(18 + 1 + 14 + COLUMN_PADDING)
      .bottom(18)
      .rounded(8)
      .bg(t.canvas)
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .child(toast);
  }

  /**
   * Draws the header and the shown view, or Settings in place of it. Settings scrolls only its
   * page: the header, its side list and its save bar stay put. The Board's toast after a move
   * floats over the scroll area (`toastOverlay`).
   * @param {object} cx The render's context.
   * @returns {object} The tab.
   */
  render(cx) {
    if (this.dialog) return this.dialog.render(cx);
    this.runQueued(cx);
    this.syncFocus(cx);
    this.syncSettings(cx);
    this.syncOpenSettings(cx);
    this.fetchIfStale(cx);
    const t = theme();
    const wide = this.width >= WIDE;
    const config = this.config;
    const model = this.model;
    const root = v_flex()
      .id("alpmeister")
      .relative()
      .size_full()
      .bg(t.canvas)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1 || Math.abs(size.height - this.height) > 1) {
          this.width = size.width;
          this.height = size.height;
          cx.notify();
        }
      });
    if (this.scrollTo || this.settings.scrollTop) {
      this.settings.scrollTop = false;
      this.scrollToPart(0, cx);
    }
    if (this.tab === TABS.settings || this.inSettings) {
      return root.child(div().flex_none().px(18).pt(18).pb(this.inSettings ? 0 : 10).child(this.header(t))).child(this.settingsView(cx));
    }
    const page = v_flex().id("alpmeister-page").size_full().overflow_y_scrollbar().track_scroll(this.scroll);
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
          // The map takes the room under the header and the Herds toolbar (the tab's padding,
          // the header, the card's padding, the toolbar and the gaps); in full tab, all the room
          // under the toolbar. Herds takes the key's row off both while the key shows. The size
          // comes in px at the app's zoom; heights take unzoomed px.
          canvasHeight: Math.max(260, this.height / (settings().zoom || 1) - 36 - 32 - 14 - 28 - 26 - 12),
          fullHeight: Math.max(300, this.height / (settings().zoom || 1) - 36 - 26 - 12),
        }),
      );
    } else {
      if (this.configError) {
        content = content.child(
          Card(
            "settings",
            "Settings",
            [TextButton("open-settings-card", "Open Settings", (cx) => this.openSettings({}, cx), { icon: ICONS.settings })],
            Note(this.configError, t.blocked),
          ),
        );
      }
      if (this.failure) content = content.child(Note(`Refresh failed: ${this.failure}`, t.blocked));
      if (!config || !model) {
        if (!this.configError) content = content.child(Note(this.loading ? "Loading from GitHub…" : "No data yet."));
      } else {
        content = content.child(
          this.tab === TABS.board ? this.board(model, cx) : this.dashboard(config, model, wide, cx),
        );
      }
    }
    const toast = this.toastOverlay(t);
    return root.child(page.child(content)).when(Boolean(toast), (el) => el.child(toast));
  }
}
