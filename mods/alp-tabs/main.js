import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, home, readTextFile, terminals } from "herdr";

// Alp's tab bar: Herdr's `tabs` (0.1.16) with Alpmeister and two button groups added.
// Alpmeister comes first, pinned before the space's tabs: it belongs to no space. A click swaps
// the `work-stack` to the `alpmeister-view` block, so only Alpmeister shows; a space tab, a new
// tab, another space, or Alpmeister again swaps back to the terminals. After +, icon buttons in
// groups split by a line: [Files Changes | Basecamp]. Basecamp shows or hides the `basecamp`
// column (the Daypack and Run tabs), when the layout has one. A button that is on gets the
// selected fill and a white icon. A layout without `work-stack` gets Alpmeister as an icon
// button instead, going to the space's Alpmeister tab or opening one. An Alpmeister tab in a
// space shows Alpmeister's icon before its name.

const ALPMEISTER = "alpmeister";
const ALPMEISTER_ICON = "mods/alp-tabs/dashboard.svg";
const WORK_STACK = "work-stack";
const WORK_BODY = "work-body";
const ALPMEISTER_VIEW = "alpmeister-view";
const BASECAMP_ID = "basecamp";
const BASECAMP_ICON = "mods/alp-tabs/panel-right.svg";
const FILES_ICON = "mods/alp-tabs/files.svg";
const CHANGES_ICON = "mods/alp-tabs/changes.svg";
const FOCUS_STAMP = "alp.focusStamp";

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

export default class Tabs extends View {
  init() {
    this.trailStamp = undefined;
    this.trailOpen = 0;
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
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

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
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

  render(cx) {
    this.syncTrail(cx);
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    // A thin line after the pinned Alpmeister tab, and between the panel buttons and Alp's own.
    const separator = () => div().w(1).h(16).mx(5).flex_none().bg(t.border);
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const root = layout(), stack = find(root, WORK_STACK);
    const pinned = Boolean(stack && find(stack, ALPMEISTER_VIEW));
    const alpOn = pinned && stack.active === ALPMEISTER_VIEW;
    const showTerminals = () => { if (alpOn) run("layout.select", { stack: WORK_STACK, child: WORK_BODY }); };
    this.leaveAlpmeister(space, selected, alpOn, showTerminals);
    const item = (c, i) => {
      const on = c.active && !alpOn;
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else { run("tab.select", { id: c.id }); showTerminals(); }
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        // Alp: an Alpmeister tab carries the same icon as its button.
        .when(!program?.icon && lead?.mod === ALPMEISTER, el => el.child(svg(ALPMEISTER_ICON).size(14).flex_none().text_color(on ? t.foreground : t.muted)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = !alpOn && panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).size(26).flex_none().items_center().justify_center().rounded(6)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(`${on ? "Hide" : "Show"} ${label}`)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { showTerminals(); run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(15));
    };
    const basecamp = find(root, BASECAMP_ID);
    const hasPanels = enabled.includes("files") || enabled.includes("changes");
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .when(pinned, el => el.child(this.alpmeisterTab(t, alpOn, stop)).child(separator()))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", FILES_ICON)))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", CHANGES_ICON)))
      .when(hasPanels && (!pinned || Boolean(basecamp)), el => el.child(separator()))
      .when(!pinned, el => el.child(this.alpmeisterButton(t, space, stop)))
      .when(Boolean(basecamp), el => el.child(this.basecampButton(t, basecamp, stop)))
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
      .tooltip(on ? "Back to the terminals" : "Show Alpmeister")
      .child(svg(ALPMEISTER_ICON).size(14).flex_none().text_color(on ? t.foreground : t.muted))
      .child("Alpmeister");
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
        else run("tab.new", { mod: ALPMEISTER, name: "Alpmeister" });
      })
      .tooltip(pane ? "Go to Alpmeister" : "Open Alpmeister");
  }

  /**
   * Basecamp's button, last: shows or hides the `basecamp` column. The tooltip counts open trail
   * items and runs still running.
   * @param {object} t The theme.
   * @param {object} column The layout's `basecamp` node.
   * @param {Function} stop Keeps the press from dragging the window.
   * @returns {object}
   */
  basecampButton(t, column, stop) {
    const open = !column.hidden;
    const running = terminals().filter((terminal) => terminal.state === "live" && terminal.labels?.["alp.run"] && !terminal.labels["alp.run.exit"]).length;
    const counts = [this.trailOpen ? `${this.trailOpen} open` : "", running ? `${running} running` : ""].filter(Boolean).join(" · ");
    return this.iconButton(t, "basecamp-button", BASECAMP_ICON, open, stop)
      .on_click(() => run("layout.toggle", { id: BASECAMP_ID }))
      .tooltip(`${open ? "Hide" : "Show"} Basecamp${counts ? ` · ${counts}` : ""}`);
  }
}
