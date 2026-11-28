import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, focused, exec, keys, run, openOverlay, closeOverlay, props, theme, window, shared, setShared, layout, settings, home, readTextFile, terminals } from "herdr";

// Alp's tab bar: Herdr's `tabs` (0.1.16) with Alpmeister and two button groups added.
// Alpmeister comes first, pinned before the space's tabs: it belongs to no space. A click swaps
// the `work-stack` to the `alpmeister-view` block, so only Alpmeister shows; a space tab, a new
// tab, another space, or Alpmeister again swaps back to the terminals. After + and a line, one
// icon button, Basecamp, shows or hides the `basecamp` dock (its Files, Changes, Today and Run
// tabs) when the layout has one; it is lit while the dock shows, and the dock is remembered per
// space. A layout without `work-stack` gets Alpmeister as an icon button before it instead,
// going to the space's Alpmeister tab or opening one. An Alpmeister tab in a space shows
// Alpmeister's icon before its name.
// The space's tabs shrink evenly to a minimum width, then a "+N" lists the ones that don't fit.
// While Alpmeister shows they are greyed; a click goes back to the terminals on that tab. The
// active tab has a ⋯ (the same menu as a right-click), a zoomed tab an expand icon, and Basecamp
// shows how many files changed. The menus are this mod again, opened as a popup with props.menu.

const ALPMEISTER = "alpmeister";
const ALPMEISTER_ICON = "mods/alp-tabs/dashboard.svg";
const WORK_STACK = "work-stack";
const WORK_BODY = "work-body";
const ALPMEISTER_VIEW = "alpmeister-view";
const BASECAMP_ID = "basecamp";
const BASECAMP_STACK = "basecamp-body";
const BASECAMP_ICON = "mods/alp-tabs/panel-right.svg";
// The dock's tabs, in its order, and the tab it opens on when none was picked.
const DOCK_TABS = [["files", "Files"], ["changes", "Changes"], ["basecamp-daypack", "Today"], ["basecamp-run", "Run"]];
const DOCK_FIRST = "basecamp-daypack";
// The changed-file count, shared with the dock's Changes tab.
const CHANGED_KEY = "alp.changedFiles";
const FOCUS_STAMP = "alp.focusStamp";
const ZOOMED_ICON = "mods/alp-tabs/zoomed.svg";
const UNZOOM_ICON = "mods/alp-tabs/unzoom.svg";
const DONE_ICON = "mods/alp-tabs/done.svg";
const MORE_ICON = "mods/alp-tabs/more.svg";
const ZOOMED_TIP = "Zoomed: one pane fills this tab. Click to show all panes.";
// Between tabs; the widest a tab's name gets; how narrow names get before "+N" takes the rest.
const GAP = 3;
const LABEL_MAX = 170;
const LABEL_MIN = 48;
// The most rows "+N"'s menu shows before it scrolls.
const MENU_ROWS = 12;
// The Changes count: the same read-only `git status` the Changes tab runs, at most every 10 s.
const STATUS_ARGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
const CHANGES_POLL = 10000;

/**
 * How many trail items are still open, from the focus file Alpmeister and the Daypack keep.
 * @returns {Promise<number>} The count; 0 when the file is missing or unreadable.
 */
async function openTrailItems() {
  const text = await readTextFile(`${home()}/.local/state/alp/focus.json`);
  try {
    return (JSON.parse(text ?? "{}").items ?? []).filter((item) => !item.done).length;
  } catch {
    return 0;
  }
}

/**
 * The pane showing Alpmeister in a space, if any.
 * @param {object | undefined} space The space, from `spaces()`.
 * @returns {object | undefined} Its pane, from `panes()`.
 */
function alpmeisterPane(space) {
  const tabs = new Set((space?.tabs ?? []).map((tab) => tab.id));
  return panes().find((pane) => pane.mod === ALPMEISTER && tabs.has(pane.tab));
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

/**
 * The app's zoom: on_size_change reports px at it, while max_w and friends take unzoomed px.
 * @returns {number}
 */
const zoom = () => settings().zoom || 1;

/**
 * Where the Changes tab looks: the focused pane's folder, else the space's, and its machine.
 * The same rule as Herdr's `changes` mod, so the count matches the tab.
 * @returns {{ cwd: string | null, on: string | null }}
 */
function changesPlace() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}

/**
 * The dock's tabs this layout shows, as stack child ids: Files and Changes only when the welcome
 * turned them on (shared "workspace.panels"), and only children the stack really holds.
 * @param {object | null} body The layout's `basecamp-body` stack.
 * @returns {string[]}
 */
function dockTabs(body) {
  const enabled = shared("workspace.panels") ?? ["files", "changes"];
  const held = new Set((body?.children ?? []).map((child) => child.id));
  return DOCK_TABS.map(([id]) => id).filter((id) => held.has(id) && (id !== "files" && id !== "changes" || enabled.includes(id)));
}

/**
 * The dock's state per space (null for closed, else the stack child it shows), kept on this
 * computer. Null until migrateDocks has made it from the older panels' state.
 * @returns {Record<string, string | null> | null}
 */
function loadDocks() {
  try {
    const stored = JSON.parse(localStorage.getItem("dock") ?? "null");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the dock's state per space.
 * @param {Record<string, string | null>} docks
 */
function saveDocks(docks) {
  try { localStorage.setItem("dock", JSON.stringify(docks)); } catch { /* not kept this time */ }
}

/**
 * Shares the changed-file count with the dock's Changes tab, when it moved.
 * @param {number} count
 */
function publishChanged(count) {
  if ((shared(CHANGED_KEY) ?? 0) !== count) setShared(CHANGED_KEY, count);
}

/**
 * Which tabs fit in the row, and how wide their names may be. Names shrink evenly (the longest
 * first, as far as needed) down to LABEL_MIN; past that, tabs from the end go to the "+N" menu,
 * the active one always kept.
 * @param {{ tab: number, label: number }[]} sizes Each tab's natural width and its name's, in order.
 * @param {number} room The row's width.
 * @param {number} active The active tab's index, or -1.
 * @param {number} more The "+N" button's width.
 * @returns {{ shown: number[], cap: number }} The indices to show, and the widest a name may be.
 */
function fit(sizes, room, active, more) {
  const fixed = (i) => sizes[i].tab - sizes[i].label;
  const width = (list, cap) => list.reduce((sum, i) => sum + fixed(i) + Math.min(sizes[i].label, cap), 0) + GAP * Math.max(0, list.length - 1);
  const widest = (list, space) => {
    if (width(list, LABEL_MAX) <= space) return LABEL_MAX;
    let lo = LABEL_MIN, hi = LABEL_MAX;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (width(list, mid) <= space) lo = mid; else hi = mid;
    }
    return Math.floor(lo);
  };
  const all = sizes.map((_, i) => i);
  if (width(all, LABEL_MIN) <= room) return { shown: all, cap: widest(all, room) };
  const space = room - more - GAP;
  const shown = [];
  let used = active >= 0 ? fixed(active) + Math.min(sizes[active].label, LABEL_MIN) : 0, full = false;
  for (const i of all) {
    if (i === active) { shown.push(i); continue; }
    const w = GAP + fixed(i) + Math.min(sizes[i].label, LABEL_MIN);
    if (!full && used + w <= space) { shown.push(i); used += w; } else full = true;
  }
  return { shown, cap: widest(shown, space) };
}

/**
 * The key bound to a command, for the hint on a menu row (as in Herdr's `menu`).
 * @param {string} name The command.
 * @param {object} [args] Its arguments; `pane.split:right` binds pane.split with { direction: "right" }.
 * @returns {string} The keys, or "".
 */
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

/**
 * A tab's menu rows (the ⋯ and a right-click): Rename, Show all panes when zoomed, Move left and
 * right, New tab, then Put away and Close. Or, for "+N", the tabs that didn't fit.
 * @param {{ menu: "tab" | "more", id?: string, ids?: string[], space: string }} p The popup's props.
 * @returns {{ label: string, icon?: string, tab?: object, command: string, args: object, apart?: boolean, tip?: string }[]}
 */
function menuItems(p) {
  const space = spaces().find((s) => s.id === p.space);
  const tabs = space?.tabs ?? [];
  if (p.menu === "more") return tabs.filter((c) => p.ids?.includes(c.id)).map((c) => ({ label: c.name, tab: c, command: "tab.select", args: { id: c.id } }));
  const c = tabs.find((x) => x.id === p.id);
  if (!c) return [];
  const zoomed = panes().find((pane) => pane.tab === c.id && pane.zoomed);
  return [
    { label: "Rename", icon: "mods/workspace-chrome/square-pen.svg", command: "tab.rename", args: { id: c.id } },
    zoomed && { label: "Show all panes", icon: UNZOOM_ICON, command: "pane.zoom", args: { pane: zoomed.pane } },
    c.index > 1 && { label: "Move left", icon: "mods/workspace-chrome/chevron-left.svg", command: "tab.move", args: { id: c.id, by: -1 } },
    c.index < tabs.length && { label: "Move right", icon: "mods/workspace-chrome/chevron-right.svg", command: "tab.move", args: { id: c.id, by: 1 } },
    { label: "New tab", icon: "mods/workspace-chrome/plus.svg", command: "tab.new", args: { space: space.id } },
    { label: "Put away", icon: "mods/workspace-chrome/archive.svg", command: "tab.settle", args: { id: c.id }, apart: true,
      tip: "Out of the lists, still running. It comes back when shown or when an agent in it needs you." },
    { label: "Close", icon: "mods/workspace-chrome/x.svg", command: "tab.close", args: { id: c.id } },
  ].filter(Boolean);
}

/**
 * The red "!" a tab that needs you carries (a colour alone doesn't say it).
 * @param {object} t The theme.
 * @returns {object}
 */
function needsYou(t) {
  return div().h(16).px(5).rounded(4).flex_none().flex().items_center().bg(`${t.blocked}26`).text_color(t.blocked).text_size(11).font_bold().child("!");
}

/**
 * Opens a tab's menu (Rename, Move, Close…) under the pointer.
 * @param {object} c The tab.
 * @param {object} space Its space.
 */
function openTabMenu(c, space) {
  const p = { menu: "tab", id: c.id, space: space.id };
  const rows = menuItems(p);
  openOverlay({ mod: "alp-tabs", kind: "popup", width: 220, height: 12 + rows.length * 31 + rows.filter((r) => r.apart).length * 9, props: p });
}

export default class Tabs extends View {
  init(_props, cx) {
    if (props()?.menu) {
      this.at = 0;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.trailStamp = undefined;
    this.trailOpen = 0;
    this.pressed = null;
    this.sizes = {}; // tab id -> { tab, label }: natural widths, from the hidden copy
    this.moreWidth = 40;
    this.room = undefined;
    this.changes = null; // { key, count } for the place changesPlace() named
    this.changesAt = 0;
    this.changesBusy = false; // a reload can strand a running git: init starts over

    cx.timer.every(1000, (cx) => this.syncChanges(cx));
    this.docks = loadDocks();
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  /**
   * The dock is remembered per space: switching shows that space's choice (closed, or open on
   * the tab it had), and opening, closing or picking a tab records it. A space with no choice
   * yet leaves the dock as it is, as Today and Run belong to no space.
   * @param {object | undefined} space The active space.
   * @param {object | null} dock The layout's `basecamp` node.
   * @param {object | null} body Its `basecamp-body` stack.
   * @param {string[]} tabs The dock's tabs this layout shows (stack child ids).
   */
  syncDock(space, dock, body, tabs) {
    if (!space || !dock) return;
    this.migrateDocks(dock, body);
    const now = dock.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      this.space = space.id; this.pending = null;
      if (space.id in this.docks) {
        const stored = this.docks[space.id] ?? null, want = stored && !tabs.includes(stored) ? tabs[0] ?? null : stored;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: BASECAMP_STACK, child: want }); run("layout.show", { id: BASECAMP_ID }); }
          else run("layout.hide", { id: BASECAMP_ID });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.docks[space.id] === now) return;
    this.docks[space.id] = now;
    saveDocks(this.docks);
  }

  /**
   * Once, from the two right-hand panels before the dock: a space whose Files or Changes panel
   * was open opens the dock on that tab; one where it was closed gets Basecamp's last state
   * (open on Today or Run, or closed), as Basecamp was the same in every space.
   * @param {object} dock The layout's `basecamp` node.
   * @param {object | null} body Its `basecamp-body` stack.
   */
  migrateDocks(dock, body) {
    if (this.docks) return;
    let panels = {};
    try { panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { panels = {}; }
    if (!panels || typeof panels !== "object" || Array.isArray(panels)) panels = {};
    const basecamp = dock.hidden ? null : body?.active ?? DOCK_FIRST;
    this.docks = {};
    for (const [id, panel] of Object.entries(panels)) {
      this.docks[id] = panel === "files" || panel === "changes" ? panel : basecamp;
    }
    saveDocks(this.docks);
  }

  /** Counts the open trail items again when Alpmeister or the Daypack says the list changed. */
  syncTrail(cx) {
    const stamp = shared(FOCUS_STAMP) ?? null;
    if (stamp === this.trailStamp) return;
    this.trailStamp = stamp;
    cx.spawn(async (cx) => {
      this.trailOpen = await openTrailItems();
      cx.notify();
    });
  }

  /**
   * Remembers a tab's natural width or its name's, from the hidden copy; re-fits when one changed.
   * @param {string} id The tab's id.
   * @param {"tab" | "label"} part Which width.
   * @param {number} width As on_size_change reports it: px at the app's zoom.
   * @param {object} cx
   */
  measured(id, part, width, cx) {
    width /= zoom();
    const size = (this.sizes[id] ??= {});
    if (Math.abs((size[part] ?? -1) - width) < 0.5) return;
    size[part] = width;
    cx.notify();
  }

  /**
   * Counts the changed files where the Changes tab looks, for the badge on Basecamp's button and
   * the dock's Changes tab (shared as CHANGED_KEY): on a new
   * place at once, else at most every 10 s (longer after a slow git) while the window is in
   * front. Not at all when Changes isn't in the bar.
   * @param {object} cx
   */
  syncChanges(cx) {
    if (this.changesBusy) return;
    if (!(shared("workspace.panels") ?? ["files", "changes"]).includes("changes")) return;
    const where = changesPlace(), key = JSON.stringify(where);
    if (key !== this.changes?.key) publishChanged(0);
    // A new place is counted at once; the same one again only while the window is in front.
    if (key === this.changes?.key && (Date.now() < this.changesAt || window()?.active === false)) return;
    if (!where.cwd) { this.changes = { key, count: 0 }; this.changesAt = Date.now() + CHANGES_POLL; publishChanged(0); return; }
    this.changesBusy = true;
    cx.spawn(async (cx) => {
      const started = Date.now();
      let count = 0;
      try {
        const r = await exec("git", STATUS_ARGS, { cwd: where.cwd, on: where.on, timeout: 20000 });
        if (r.code === 0) count = r.stdout.split("\0").filter(Boolean).length;
      } catch {
        count = 0;
      }
      this.changesBusy = false;
      this.changesAt = Date.now() + Math.max(CHANGES_POLL, 5 * (Date.now() - started));
      const old = this.changes;
      this.changes = { key, count };
      // The place may have moved on while git ran: only the current one's count is shown.
      if (key === JSON.stringify(changesPlace())) publishChanged(count);
      if (old?.key !== key || old.count !== count) cx.notify();
    });
  }

  /**
   * One of the space's tabs: its icon, name, zoom icon, status, and on the active one ⋯ and ✕.
   * The hidden copy (`view.measure`) has the same parts and no handlers, and reports its widths.
   * @param {object} t The theme.
   * @param {object} c The tab.
   * @param {number} i Its index in the space.
   * @param {{ measure?: boolean, alpOn: boolean, cap?: number, space?: object, shown?: object[], showTerminals?: Function, stop?: Function }} view
   * @returns {object}
   */
  tab(t, c, i, view) {
    const { measure, alpOn, space, shown, showTerminals, stop } = view;
    const on = c.active && !alpOn;
    const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
    const program = lead?.program;
    const name = label(c, lead);
    const id = (part) => `${measure ? "m-" : ""}${part}-${c.id}`;
    const ink = on ? t.foreground : t.muted;
    const zoomedPane = c.zoomed && panes().find(p => p.tab === c.id && p.zoomed);
    const part = (key, el, tip, click) => measure ? el : div().id(id(key)).flex_none().flex().items_center()
      .when(Boolean(tip), d => d.tooltip(tip))
      .when(Boolean(click), d => d.on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(); }))
      .child(el);
    return h_flex().id(id("tab")).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(ink)
      .when(Boolean(measure), el => el.on_size_change((size, cx) => this.measured(c.id, "tab", size.width, cx)))
      // Greyed while Alpmeister shows in place of the terminals; a hover shows it's still a way back.
      .when(alpOn && !measure, el => el.opacity(0.55))
      .when(!measure, el => el.hover(s => s.bg(t.hover).opacity(1))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else { run("tab.select", { id: c.id }); showTerminals(); }
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openTabMenu(c, space); }))
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none()))
      // Alp: an Alpmeister tab carries the same icon as its button.
      .when(!program?.icon && lead?.mod === ALPMEISTER, el => el.child(svg(ALPMEISTER_ICON).size(14).flex_none().text_color(on ? t.foreground : ink)))
      .child(div().id(id("label")).max_w(measure ? LABEL_MAX : Math.min(LABEL_MAX, view.cap ?? LABEL_MAX)).truncate().child(name)
        .when(Boolean(measure), el => el.on_size_change((size, cx) => this.measured(c.id, "label", size.width, cx))))
      .when(c.zoomed, el => el.child(part("zoom", svg(ZOOMED_ICON).size(12).flex_none().text_color(ink), ZOOMED_TIP, () => {
        if (zoomedPane) run("pane.zoom", { pane: zoomedPane.pane });
      })))
      .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(c.status === "blocked", el => el.child(part("status", needsYou(t), "Needs you")))
      .when(c.status === "done", el => el.child(part("status", svg(DONE_ICON).size(12).flex_none().text_color(t.done), "Done")))
      .when(on, el => el.child(part("more", svg(MORE_ICON).size(14).flex_none().text_color(t.muted), "Tab menu", () => openTabMenu(c, space)))
        .child(part("close", svg("mods/pane/close.svg").size(12).flex_none().text_color(t.dim), "Close tab", () => run("tab.close", { id: c.id }))));
  }

  /**
   * The "+N" button after the tabs that fit: opens a menu of the rest. A red "!" when one of them
   * needs you.
   * @param {object} t The theme.
   * @param {object[]} hidden The tabs that didn't fit (empty for the hidden copy).
   * @param {object} [space] The active space.
   * @param {Function} [stop] Keeps the press from dragging the window.
   * @returns {object}
   */
  moreButton(t, hidden, space, stop) {
    const measure = !space;
    const blocked = hidden.some(c => c.status === "blocked");
    const el = h_flex().id(measure ? "m-tab-more" : "tab-more").h(29).px(8).gap(5).rounded(7).items_center().flex_none().text_size(12.8).text_color(t.muted)
      .child(measure ? "+99" : `+${hidden.length}`)
      // The hidden copy always has the "!", so there's room for it.
      .when(measure || blocked, d => d.child(needsYou(t)));
    if (measure) return el.on_size_change((size, cx) => { const w = size.width / zoom(); if (Math.abs(w - this.moreWidth) >= 0.5) { this.moreWidth = w; cx.notify(); } });
    const p = { menu: "more", ids: hidden.map(c => c.id), space: space.id };
    return el.hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
      .tooltip(hidden.length === 1 ? "1 more tab" : `${hidden.length} more tabs`)
      .on_click(() => openOverlay({ mod: "alp-tabs", kind: "popup", width: 260, height: 12 + Math.min(MENU_ROWS, hidden.length) * 31, props: p }));
  }

  /**
   * The popup copy: a tab's menu, or the tabs "+N" holds. ↑/↓ move, Enter runs, Esc closes; the
   * pointer moves the same highlight, so only one row is ever lit.
   * @param {object} t The theme.
   * @returns {object}
   */
  menu(t) {
    const p = props();
    const list = menuItems(p);
    if (this.at >= list.length) this.at = 0;
    const choose = (i) => {
      const it = list[i];
      if (!it) return;
      closeOverlay(p.overlay);
      run(it.command, it.args);
      // Picking a tab from "+N" while Alpmeister shows goes back to the terminals, on that tab.
      const stack = find(layout(), WORK_STACK);
      if (it.command === "tab.select" && stack?.active === ALPMEISTER_VIEW) run("layout.select", { stack: WORK_STACK, child: WORK_BODY });
    };
    return v_flex().id("tab-menu").track_focus(this.handle).size_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (!list.length && e.key !== "escape") return;
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      // A long "+N" list scrolls; a scroll box needs a set height to have one at all.
      .child(v_flex().id("tab-menu-rows").w_full().when(p.menu === "more", el => el.h(Math.min(MENU_ROWS, list.length) * 31).overflow_y_scrollbar())
      .children(list.map((it, i) => {
        const lead = it.tab && (panes().find(x => x.tab === it.tab.id && x.program?.agent) ?? panes().find(x => x.tab === it.tab.id));
        const program = lead?.program;
        return v_flex()
          .when(Boolean(it.apart) && i > 0, el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
          .child(h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().flex_none().text_color(t.foreground)
            .when(i === this.at, el => el.bg(t.selected))
            .when(Boolean(it.tip), el => el.tooltip(it.tip))
            .on_hover((hovered, cx) => { if (hovered && this.at !== i) { this.at = i; cx.notify(); } })
            .on_click(() => choose(i))
            .when(Boolean(it.icon), el => el.child(svg(it.icon).size(14).flex_none().text_color(t.muted)))
            .when(Boolean(it.tab), el => el.child(program?.icon
              ? (program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none())
              : div().size(14).flex_none()))
            .child(div().flex_1().min_w(0).truncate().child(it.tab ? label(it.tab, lead) : it.label))
            .when(it.tab?.zoomed, el => el.child(svg(ZOOMED_ICON).size(12).flex_none().text_color(t.muted)))
            .when(it.tab?.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
            .when(it.tab?.status === "blocked", el => el.child(needsYou(t)))
            .when(it.tab?.status === "done", el => el.child(svg(DONE_ICON).size(12).flex_none().text_color(t.done)))
            .when(!it.tab, el => el.child(div().text_size(11.5).text_color(t.dim).child(shortcut(it.command, it.args)))));
      })));
  }

  /**
   * The bar: Alp's pinned tab, the space's tabs fitted to the row (the rest behind "+N"), +, and
   * Basecamp's button. The popup copy draws its menu instead.
   * @param {object} cx
   * @returns {object}
   */
  render(cx) {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    this.syncTrail(cx);
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    const stop = (_e, cx) => cx.stop_propagation();
    // A thin line after the pinned Alpmeister tab, and between + and the buttons after it.
    const separator = () => div().w(1).h(16).mx(5).flex_none().bg(t.border);
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const root = layout(), stack = find(root, WORK_STACK);
    const pinned = Boolean(stack && find(stack, ALPMEISTER_VIEW));
    const alpOn = pinned && stack.active === ALPMEISTER_VIEW;
    const showTerminals = () => { if (alpOn) run("layout.select", { stack: WORK_STACK, child: WORK_BODY }); };
    this.leaveAlpmeister(space, selected, alpOn, showTerminals);
    // Until every tab has been measured, show them all at their natural width.
    const sizes = shown.map(c => this.sizes[c.id]);
    const known = this.room !== undefined && sizes.every(s => s?.tab !== undefined && s?.label !== undefined);
    const fitted = known ? fit(sizes, this.room - 1, active, this.moreWidth) : { shown: shown.map((_, i) => i), cap: LABEL_MAX };
    const visible = new Set(fitted.shown);
    const hidden = shown.filter((_, i) => !visible.has(i));
    const view = { alpOn, cap: fitted.cap, space, shown, showTerminals, stop };
    const sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const dock = find(root, BASECAMP_ID), body = find(root, BASECAMP_STACK);
    const tabs = dockTabs(body);
    this.syncDock(space, dock, body, tabs);
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .when(pinned, el => el.child(this.alpmeisterTab(t, alpOn, stop)).child(separator()))
      .child(h_flex().id("tab-row").flex_1().min_w(0).h_full().items_center().gap(GAP).overflow_hidden().relative()
        .on_size_change((size, cx) => { const w = size.width / zoom(); if (this.room === undefined || Math.abs(w - this.room) >= 0.5) { this.room = w; cx.notify(); } })
        .children(fitted.shown.map(i => this.tab(t, shown[i], i, view)))
        .when(hidden.length > 0, el => el.child(this.moreButton(t, hidden, space, stop)))
        // The hidden copy: every tab at its natural width, for fit().
        .child(h_flex().absolute().top(0).left(0).h_full().items_center().gap(GAP).opacity(0)
          .children(shown.map((c, i) => this.tab(t, c, i, { measure: true, alpOn })))
          .child(this.moreButton(t, []))))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(!pinned || Boolean(dock), el => el.child(separator()))
      .when(!pinned, el => el.child(this.alpmeisterButton(t, space, stop)))
      .when(Boolean(dock), el => el.child(this.basecampButton(t, dock, body, tabs, stop)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/alp-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/alp-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/alp-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }

  /**
   * One of the bar's icon buttons: the selected fill and a white icon while it's on, muted while
   * off, white on hover.
   * @param {object} t The theme.
   * @param {string} id Element id.
   * @param {string} icon The icon's path.
   * @param {boolean} on Whether what it opens is showing.
   * @param {Function} stop Keeps the press from dragging the window.
   * @returns {object}
   */
  iconButton(t, id, icon, on, stop) {
    return h_flex().id(id).size(26).flex_none().items_center().justify_center().rounded(6)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .child(svg(icon).size(15).flex_none());
  }

  /**
   * While Alpmeister shows, going to another tab or space (a click elsewhere, a key, a new tab)
   * swaps back to the terminals so that tab shows.
   * @param {object | undefined} space The active space.
   * @param {string | undefined} selected The active tab's id.
   * @param {boolean} alpOn Whether Alpmeister's view shows.
   * @param {Function} back Swaps back to the terminals.
   */
  leaveAlpmeister(space, selected, alpOn, back) {
    const where = `${space?.id}:${selected}`;
    const moved = this.where !== undefined && where !== this.where;
    this.where = where;
    if (moved) back();
  }

  /**
   * Alpmeister's pinned tab, before the space's tabs: shows Alpmeister's view in place of the
   * terminals, or the terminals again when it already shows.
   * @param {object} t The theme.
   * @param {boolean} on Whether Alpmeister's view shows.
   * @param {Function} stop Keeps the press from dragging the window.
   * @returns {object}
   */
  alpmeisterTab(t, on, stop) {
    return h_flex().id("alpmeister-tab").h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run("layout.select", { stack: WORK_STACK, child: on ? WORK_BODY : ALPMEISTER_VIEW }))
      .tooltip(on ? "Back to the terminals" : "Show Alp")
      .child(svg(ALPMEISTER_ICON).size(14).flex_none().text_color(on ? t.foreground : t.muted))
      .child("Alp");
  }

  /**
   * Alpmeister's button, for a layout without `work-stack`: goes to the space's Alpmeister tab, or opens one. On while that tab shows.
   * @param {object} t The theme.
   * @param {object | undefined} space The active space.
   * @param {Function} stop Keeps the press from dragging the window.
   * @returns {object}
   */
  alpmeisterButton(t, space, stop) {
    const pane = alpmeisterPane(space);
    const shown = Boolean(pane && space?.tabs?.find((tab) => tab.id === pane.tab)?.active);
    return this.iconButton(t, "alpmeister", ALPMEISTER_ICON, shown, stop)
      .on_click(() => {
        if (pane) run("tab.select", { id: pane.tab });
        else run("tab.new", { mod: ALPMEISTER, name: "Alp" });
      })
      .tooltip(pane ? "Go to Alp" : "Open Alp");
  }

  /**
   * Basecamp's button, last: shows or hides the dock, on the tab it last showed. The tooltip
   * names the dock's tabs, with how many files changed, trail items are open and runs are
   * still running, each count left out when it is zero; the changed files also show as a badge
   * on the icon.
   * @param {object} t The theme.
   * @param {object} dock The layout's `basecamp` node.
   * @param {object | null} body Its `basecamp-body` stack.
   * @param {string[]} tabs The dock's tabs this layout shows (stack child ids).
   * @param {Function} stop Keeps the press from dragging the window.
   * @returns {object}
   */
  basecampButton(t, dock, body, tabs, stop) {
    const open = !dock.hidden;
    const changed = tabs.includes("changes") && this.changes?.key === JSON.stringify(changesPlace()) ? this.changes.count : 0;
    const running = terminals().filter((terminal) => terminal.state === "live" && terminal.labels?.["alp.run"] && !terminal.labels["alp.run.exit"]).length;
    const counts = { changes: changed && `${changed} changed`, "basecamp-daypack": this.trailOpen && `${this.trailOpen} open`, "basecamp-run": running && `${running} running` };
    const names = DOCK_TABS.filter(([id]) => tabs.includes(id)).map(([id, name]) => (counts[id] ? `${name} (${counts[id]})` : name));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
    return this.iconButton(t, "basecamp-button", BASECAMP_ICON, open, stop).relative()
      .on_click(() => {
        if (open) { run("layout.hide", { id: BASECAMP_ID }); return; }
        // A tab the welcome turned off since: open on the first one there is.
        if (!tabs.includes(body?.active)) run("layout.select", { stack: BASECAMP_STACK, child: tabs.includes(DOCK_FIRST) ? DOCK_FIRST : tabs[0] });
        run("layout.show", { id: BASECAMP_ID });
      })
      .tooltip(open ? "Hide Basecamp" : `Show Basecamp: ${list}`)
      // The count, as editors show it: a small badge on the icon's corner.
      .when(changed > 0, el => el.child(div().absolute().top(0).right(-2).min_w(14).h(14).px(3).rounded(7).flex().items_center().justify_center()
        .bg(t.accent).text_color(t.chrome).text_size(10).font_bold().child(changed > 99 ? "99+" : String(changed))));
  }
}
