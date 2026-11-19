// Alpmeister: the team lead's start-of-day view, in two tabs. Dashboard: tiles for review
// requests, open bugs by priority, triage bugs and the nightly run, then the next milestone
// and the team's work in flight. Daypack: today's focus, then review requests, your PRs
// and your issues.
// It refreshes when it opens and from its button only.
// Settings: ~/.config/alp/alpmeister.json (see alpmeister.example.json).

import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { checking, panes, props, readTextFile, run, setShared, shared, spaces, theme, watchFolder, writeTextFile, exec } from "herdr";
import { loadConfig, stateDir } from "./config.js";
import { loadOverview, loadPickStates } from "./data.js";
import { FocusStore } from "./focus.js";
import { FocusList } from "./focus-list.js";
import { loadHerds, saveTabLink, sessionsDir } from "./herds-data.js";
import { Herds } from "./herds-view.js";
import { InFlight } from "./in-flight.js";
import { MyIssues, MyPrs, Reviews } from "./my-day.js";
import { Spotlight } from "./spotlight.js";
import { Milestone, Tiles } from "./project.js";
import { Card, ICONS, IconButton, Note, TextButton, ago } from "./ui.js";

const STALE_AFTER = 2 * 3600000;
const WIDE = 1000;
const TABS = { dashboard: "dashboard", today: "today", herds: "herds" };
const TAB_KEY = "alpmeister.tab";
const FOCUS_STAMP_KEY = "alp.focusStamp";

const cachePath = () => `${stateDir()}/alpmeister-cache.json`;

/** The tab this copy showed last, or the dashboard. */
function rememberedTab() {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    return Object.values(TABS).includes(tab) ? tab : TABS.dashboard;
  } catch (error) {
    console.log(`alpmeister: no remembered tab: ${error}`);
    return TABS.dashboard;
  }
}

export default class Alpmeister extends View {
  init(_props, cx) {
    this.config = null;
    this.configError = null;
    this.model = null;
    this.loading = false;
    this.failure = null;
    this.milestoneOnly = false;
    this.teamIterationOnly = false;
    this.mineIterationOnly = true;
    this.expandedGroups = new Set();
    this.width = 1200;
    this.cacheSnapshot = null;
    // `props.tab` opens a copy on that tab: tab.new {mod: "alpmeister", props: {tab: "herds"}}.
    this.tab = Object.values(TABS).includes(props()?.tab) ? props().tab : rememberedTab();
    this.herds = null;
    this.herdsLoading = false;
    this.herdsAgain = false;
    this.herdsWatching = false;
    this.herdsFailure = null;
    this.picking = null;
    this.focus = new FocusStore();
    this.focusStamp = shared(FOCUS_STAMP_KEY) ?? null;
    this.input = InputState.new({ placeholder: "Add a todo and press Enter" });
    this.input.on("submit", (_event, cx) => this.addTodo(cx));
    if (checking()) return;
    cx.spawn(async (cx) => {
      const { config, error } = await loadConfig();
      this.config = config ?? null;
      this.configError = error ?? null;
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
          this.herds = await loadHerds();
          this.herdsFailure = null;
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
    if (this.herdsWatching) return;
    this.herdsWatching = true;
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(sessionsDir());
        this.reloadHerds(cx);
      }
    });
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

  /** Draws the last result at once, before the first refresh returns. */
  async loadCache() {
    const text = await readTextFile(cachePath());
    this.cacheSnapshot = text;
    try {
      if (text && !this.model) this.model = JSON.parse(text);
    } catch (error) {
      console.log(`alpmeister: cache unreadable, ignoring it: ${error}`);
    }
  }

  /** Keeps the latest result for the next first paint. */
  async saveCache(model) {
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

  /** Fetches everything again. Ignored while a refresh runs. */
  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { config, error } = await loadConfig();
        this.config = config ?? null;
        this.configError = error ?? null;
        if (config) {
          this.model = await loadOverview(config);
          this.failure = null;
          await this.saveCache(this.model);
          await this.checkPicks(config);
        }
      } catch (error) {
        this.failure = String(error?.message ?? error);
        console.log(`alpmeister: refresh failed: ${this.failure}`);
      }
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
    const picks = this.focus.items().filter((item) => item.kind !== "todo");
    if (!picks.length) return;
    const states = await loadPickStates(config, [...new Set(picks.map((item) => item.number))]);
    let changed = false;
    for (const item of picks) {
      const found = states[item.number];
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
    this.focusStamp = Date.now();
    setShared(FOCUS_STAMP_KEY, this.focusStamp);
  }

  /** Reloads the focus list when the Daypack sidebar changed it. */
  syncFocus(cx) {
    const stamp = shared(FOCUS_STAMP_KEY) ?? null;
    if (stamp === this.focusStamp) return;
    this.focusStamp = stamp;
    cx.spawn(async (cx) => {
      await this.focus.load();
      cx.notify();
    });
  }

  /** Saves the focus list, then redraws. */
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
      const pinned = this.focus.has(item.kind, item.number);
      return IconButton(
        `${prefix}-pin-${item.number}`,
        ICONS.pin,
        (cx) => {
          if (pinned) this.focus.remove(`${item.kind}-${item.number}`);
          else {
            this.focus.add({
              kind: item.kind,
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
          tooltip: pinned ? "Unpin from the Lineup" : "Pin to the Lineup",
          color: pinned ? theme().accent : undefined,
        },
      );
    };
  }

  /**
   * Opens a Claude tab on an issue or PR in the space you are in. It starts in the live folder of
   * that space's first tab when it is the configured folder or inside it, such as a worktree, else
   * in the configured folder.
   */
  launch(kind, number) {
    const { issue, pr } = this.config.launch;
    const repo = this.config.launch.folder?.replace(/\/+$/, "");
    const space = spaces().find((candidate) => candidate.active);
    const firstTab = space?.tabs?.[0]?.id;
    const liveFolder = panes().find((pane) => pane.tab === firstTab && pane.cwd)?.cwd ?? space?.folder;
    const spaceFolder = liveFolder?.replace(/\/+$/, "");
    const inRepo = Boolean(repo && spaceFolder && (spaceFolder === repo || spaceFolder.startsWith(`${repo}/`)));
    const folder = inRepo ? spaceFolder : repo;
    run("tab.new", {
      name: kind === "pr" ? `PR #${number}` : `#${number}`,
      ...(space ? { space: space.id } : {}),
      ...(folder ? { folder } : {}),
      argv: ["claude"],
      task: (kind === "pr" ? pr : issue).replace("{number}", number),
    });
  }

  /** Shows one of the tabs and remembers it for this copy. */
  selectTab(tab, cx) {
    this.tab = tab;
    if (tab === TABS.herds) this.watchHerds(cx);
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch (error) {
      console.log(`alpmeister: tab not remembered: ${error}`);
    }
    cx.notify();
  }

  /** The tab switch: Dashboard, Herds and Daypack, as pills in one rounded frame. */
  tabs(t) {
    const open = this.focus.items().filter((item) => !item.done).length;
    const pill = (tab, label) =>
      h_flex()
        .id(`tab-${tab}`)
        .h(26)
        .px(12)
        .items_center()
        .rounded(7)
        .text_size(12)
        .font_medium()
        .cursor_pointer()
        .bg(this.tab === tab ? t.selected : t.background)
        .text_color(this.tab === tab ? t.foreground : t.dim)
        .hover((style) => style.text_color(t.foreground))
        .on_click((_event, cx) => this.selectTab(tab, cx))
        .child(label);
    return h_flex()
      .gap(2)
      .p(2)
      .rounded(9)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .child(pill(TABS.dashboard, "Dashboard"))
      .child(pill(TABS.herds, "Herds"))
      .child(pill(TABS.today, open ? `Daypack · ${open}` : "Daypack"));
  }

  /**
   * The header: tabs, title, when the shown tab's data was read, and Refresh. On Herds, Refresh
   * reads the sessions again; elsewhere it fetches from GitHub.
   */
  header(t) {
    const herds = this.tab === TABS.herds;
    const fetchedAt = herds ? this.herds?.loadedAt : this.model?.fetchedAt;
    const stale = !herds && fetchedAt && Date.now() - fetchedAt > STALE_AFTER;
    const busy = herds ? this.herdsLoading : this.loading;
    return h_flex()
      .items_center()
      .gap(10)
      .child(this.tabs(t))
      .child(div().w(8))
      .child(div().text_size(18).font_semibold().text_color(t.foreground).child("Alpmeister"))
      .child(div().flex_1())
      .when(Boolean(fetchedAt), (el) =>
        el.child(
          div()
            .text_size(11)
            .text_color(stale ? t.working : t.dim)
            .child(`updated ${ago(Date.now() - fetchedAt)} ago`),
        ),
      )
      .child(
        TextButton("refresh", busy ? "Refreshing…" : "Refresh", (cx) =>
          herds ? this.reloadHerds(cx) : this.refresh(cx),
        ),
      );
  }

  /** Shows every row of a list section, or only its first rows again. */
  toggleGroup(key, cx) {
    if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
    else this.expandedGroups.add(key);
    cx.notify();
  }

  /** The Dashboard tab: the four tiles, the spotlight, the next milestone, the team in flight. */
  dashboard(config, model, wide) {
    const onToggleGroup = (key, cx) => this.toggleGroup(key, cx);
    return v_flex()
      .gap(14)
      .child(Tiles(config, model, { wide }))
      .child(
        Spotlight(config, model, {
          wide,
          expanded: this.expandedGroups,
          onToggleGroup,
          pinButton: this.pinFor("pr"),
        }),
      )
      .child(Milestone(config, model))
      .child(
        InFlight(config, model, {
          milestoneOnly: this.milestoneOnly,
          onToggleMilestone: (cx) => {
            this.milestoneOnly = !this.milestoneOnly;
            cx.notify();
          },
          iterationOnly: this.teamIterationOnly,
          onToggleIteration: (cx) => {
            this.teamIterationOnly = !this.teamIterationOnly;
            cx.notify();
          },
          expanded: this.expandedGroups,
          onToggleGroup,
          pinButton: this.pinFor("if"),
        }),
      );
  }

  /**
   * The Daypack tab: today's focus across the top, then review requests and your PRs in one
   * column and your issues in the other.
   */
  today(config, model, wide) {
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
      launch: (kind, number) => this.launch(kind, number),
      command: (kind) => (kind === "pr" ? config.launch.pr : config.launch.issue),
    });
    const launch = (kind, number) => this.launch(kind, number);
    const reviews = Reviews(config, model, { pinButton: this.pinFor("rv"), launch });
    const mine = MyIssues(config, model, {
      pinButton: this.pinFor("mi"),
      launch,
      iterationOnly: this.mineIterationOnly,
      onToggleIteration: (cx) => {
        this.mineIterationOnly = !this.mineIterationOnly;
        cx.notify();
      },
    });
    const myPrs = MyPrs(config, model, { pinButton: this.pinFor("mp"), launch });
    const lists = wide
      ? h_flex()
          .gap(14)
          .items_start()
          .child(v_flex().flex_1().min_w(0).gap(14).child(reviews).child(myPrs))
          .child(div().flex_1().min_w(0).child(mine))
      : v_flex().gap(14).child(reviews).child(myPrs).child(mine);
    return v_flex().gap(14).child(focus).child(lists);
  }

  render(cx) {
    this.syncFocus(cx);
    const t = theme();
    const wide = this.width >= WIDE;
    const config = this.config;
    const model = this.model;
    let content = v_flex().w_full().p(18).gap(14).child(this.header(t));
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
        }),
      );
    } else {
      if (this.configError) content = content.child(Card("settings", "Settings", [], Note(this.configError, t.blocked)));
      if (this.failure) content = content.child(Note(`Refresh failed: ${this.failure}`, t.blocked));
      if (model?.errors?.github) {
        content = content.child(Note(`GitHub: ${model.errors.github}. Try gh auth status.`, t.blocked));
      }
      if (!config || !model?.counts) {
        if (!this.configError) content = content.child(Note(this.loading ? "Loading from GitHub…" : "No data yet."));
      } else {
        content = content.child(
          this.tab === TABS.today ? this.today(config, model, wide) : this.dashboard(config, model, wide),
        );
      }
    }
    return v_flex()
      .id("alpmeister")
      .size_full()
      .bg(t.canvas)
      .overflow_y_scrollbar()
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(content);
  }
}
