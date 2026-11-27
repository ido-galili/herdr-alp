// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// Grouped by space opens with the priority view's Needs you section; under each space the
// idle agents fold into one row ("7 idle, last 9h – 2d"), and which folds are open is kept.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A space header's name never shrinks below this, so its summary gives way first.
const SPACE_MIN = 48;
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "By priority", icon: "clock" },
  { id: "grouped", label: "By space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// A space header's summary, in this order: "· 1 working · 1 done".
const SUMMARY = [[2, "working"], [3, "done"]];

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// What a stored color name looks like on a space avatar: the same table as the spaces mod.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space as the spaces mod draws it: its first letter on the space's color.
// At 18px it matches the spaces mod; smaller sizes scale the corner and letter with it.
function avatar(t, colors, key, space, name, size = 18) {
  const color = colors[space] ?? "ansi6";
  const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
  return h_flex()
    .id(key)
    .size(size)
    .flex_none()
    .rounded(Math.round(size * 5 / 18))
    .bg(fill)
    .items_center()
    .justify_center()
    .text_size(size * 10.5 / 18)
    .font_bold()
    .text_color("#ffffff")
    .child([...(name ?? "")][0]?.toUpperCase() ?? "?");
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Spaces whose idle agents are unfolded (grouped view); folded is the default.
    try { this.idleOpen = new Set(JSON.parse(localStorage.getItem("idle.open") ?? "[]")); } catch { this.idleOpen = new Set(); }
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  /**
   * The sort popup: a row per sort order, the current one ticked.
   * @param {Record<string, string>} t The theme.
   * @returns {object}
   */
  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11.5).text_color(t.dim).child("Show agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .children([this.status(t, { status: st }, compact)].filter(Boolean));
  }

  /**
   * An agent's status mark: a spinner while working, "Needs you" (compact: a "!" where a header
   * already says it), a check when done; idle has none (its row fades instead).
   * @param {Record<string, string>} t The theme.
   * @param {{ status: string }} a The agent, or just its status.
   * @param {boolean} [compact] Show a "!" tile instead of "Needs you".
   * @returns {object | null}
   */
  status(t, a, compact = false) {
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(11.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (a.status === "done") return svg("mods/workspace-chrome/check.svg").size(12).mx(1).flex_none().text_color(t.done);
    return null;
  }

  /**
   * The words before an agent's mark: "working", "done 4m", "idle 2d"; for any other state just
   * how long it has been in it.
   * @param {Record<string, string>} t The theme.
   * @param {{ status: string }} a The agent.
   * @param {string | null} ago How long since its state changed ("4m"), or null when not known.
   * @returns {object | null}
   */
  word(t, a, ago) {
    const text = (s, color) => div().flex_none().text_size(11.5).text_color(color).child(s);
    if (a.status === "working") return text("working", t.working);
    if (a.status === "done") return text(ago ? `done ${ago}` : "done", t.done);
    if (a.status === "idle") return text(ago ? `idle ${ago}` : "idle", t.dim);
    return ago ? text(ago, t.dim) : null;
  }

  /**
   * The agents list: its header, then a row per agent, or a line saying none have shown up yet.
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];

    /**
     * An agent's row and, unless folded, its sub-agents'.
     * @param {object} a The agent.
     * @param {string | null} kind The group it is under ("pinned", "section", "space"); null on the rail.
     * @returns {object[]}
     */
    const withKids = (a, kind) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, subs, kind);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, kind === "section"))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11.5)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row's detail is a tab someone named or the agent's own title, never an
    // automatic tab number unless two rows would otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const colors = shared("space.colors") ?? {};
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    /**
     * An agent's row: on the rail a tile with its initial; unfolded its name, then the status in
     * words ("working", "done 4m", "idle 2d") and its mark. Outside a space (pinned, a section)
     * the space's avatar goes before the name, and under a section's header "Needs you" is a "!".
     * @param {object} a The agent.
     * @param {object[]} [subs] Its sub-agents, from tree().
     * @param {string | null} [kind] The group it is under ("pinned", "section", "space"); null on the rail.
     * @returns {object}
     */
    const row = (a, subs = [], kind = null) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      const name = more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      // Rail: one tile per agent, its initial on its space's color. The status is a badge on
      // the tile's corner, as on the spaces rail. An idle agent's tile is faded, so the busy
      // ones and the ones that need you stand out.
      if (collapsed) {
        const color = colors[a.space] ?? "ansi6";
        const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
        const quiet = a.status === "idle";
        const ring = a.focused ? t.selected : t.chrome;
        const badge = a.status === "working"
          ? div().absolute().top(-4).right(-4).size(12).rounded_full().bg(ring).flex().items_center().justify_center()
            .child(svg("mods/workspace-chrome/spinner.svg").size(10).text_color(t.working).spin(900))
          : a.status === "blocked" || a.status === "done"
            ? div().absolute().top(-3).right(-3).size(9).rounded_full().border(2).border_color(ring).bg(t[a.status])
            : null;
        return h_flex()
          .id(`ag-${a.address}`)
          .h(30)
          .w(32)
          .flex_none()
          .self_center()
          .rounded(8)
          .items_center()
          .justify_center()
          .cursor_pointer()
          .tooltip(`${name}${a.space_name ? ` · ${a.space_name}` : ""}`)
          .when(a.focused, (el) => el.bg(t.selected))
          .when(!a.focused, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().relative().flex_none()
            .child(h_flex().size(22).rounded(6).items_center().justify_center()
              .bg(quiet ? fill + "33" : fill)
              .text_size(11.5).font_bold().text_color(quiet ? fill : "#ffffff")
              .child([...name].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? "?"))
            .when(Boolean(badge), (el) => el.child(badge)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the space's avatar stands for the space.
      const full = kind !== "space";
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`).when(idle, el => el.opacity(0.5))
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(7).items_center()
          .when(full, el => el.child(avatar(t, colors, `ag-space-${a.address}`, a.space, a.space_name, 14).tooltip(a.space_name || "")))
          .child(div().min_w(0).max_w(200).truncate().text_color(idle ? t.dim : t.foreground).child(name)))
        .when(Boolean(machine), el => el.child(div().text_size(11.5).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .children([this.hovered !== a.address && this.word(t, a, when ? duration(now - when) : null), this.status(t, a, kind === "section")].filter(Boolean));
    };

    // Groups in list order: priority sections, or spaces after the same Needs you section.
    // Agents of a space are next to each other in agents(), so neighbours make a group.
    const sectionOf = (a) => rankOf(a) || RANK.idle;
    const section = (r) => ({ id: `sec-${r}`, kind: "section", label: SECTION[r], status: SECTION_STATUS[r], members: [] });
    const groups = pinned.length ? [{ id: "pinned", kind: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    if (byPriority) {
      for (const a of rest) {
        const r = sectionOf(a);
        if (groups.at(-1)?.id !== `sec-${r}`) groups.push(section(r));
        groups.at(-1).members.push(a);
      }
    } else {
      // Who needs you comes first, as in priority; their spaces say so instead of listing them again.
      const needs = rest.filter((a) => sectionOf(a) === RANK.blocked);
      if (needs.length) groups.push({ ...section(RANK.blocked), members: needs });
      for (const a of rest) {
        const id = `sp-${a.space}`;
        if (groups.at(-1)?.id !== id) groups.push({ id, kind: "space", label: a.space_name || "", space: a.space, status: null, members: [], idle: [], above: 0 });
        const g = groups.at(-1);
        if (sectionOf(a) === RANK.blocked) g.above += 1;
        // An idle agent folds away, unless it's the one in view.
        else if (sectionOf(a) === RANK.idle && !a.focused) g.idle.push(a);
        else g.members.push(a);
      }
      // One idle agent isn't worth a fold: it keeps its row.
      for (const g of groups) if (g.kind === "space" && g.idle.length === 1) { g.members.push(...g.idle); g.idle = []; }
    }
    // Navigation (agent.next) goes in the order the list shows.
    setAgentOrder((collapsed ? list : groups.flatMap((g) => [...g.members, ...(g.idle ?? [])])).map((a) => a.address));

    /**
     * A space header's summary: "1 needs you, above · 1 working · 1 done", and the idle count
     * when nothing else is said or the space is folded.
     * @param {object} g The space's group.
     * @param {boolean} open Whether the group is unfolded.
     * @returns {string} The summary, "" when there's nothing to say.
     */
    const summary = (g, open) => {
      const all = [...g.members, ...g.idle];
      const parts = [
        ...(g.above ? [`${g.above} needs you, above`] : []),
        ...SUMMARY.map(([r, word]) => [all.filter((a) => sectionOf(a) === r).length, word]).filter(([n]) => n).map(([n, word]) => `${n} ${word}`),
      ];
      const idle = all.filter((a) => sectionOf(a) === RANK.idle).length;
      if (idle && (!parts.length || !open)) parts.push(`${idle} idle`);
      return parts.join(" · ");
    };

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    // A space's header is in the foreground colour with its summary ("· 1 working · 1 done").
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const space = g.kind === "space";
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      const said = space ? summary(g, open) : "";
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11.5)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .when(space, (el) => el.child(avatar(t, colors, `${g.id}-avatar`, g.space, g.label, 16)))
        .when(space, (el) => el.child(div().flex_shrink(1).min_w(SPACE_MIN).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(g.label))
          .when(Boolean(said), (el) => el.child(div().flex_shrink(3).min_w(0).truncate().font_normal().text_color(t.dim).child(`· ${said}`))))
        .when(!space, (el) => el.child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
          .when(g.kind === "section" || byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length)))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(g.kind === "pinned" && !byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };

    /**
     * Under a space, its idle agents folded into one row: "▸ 7 idle, last 9h – 2d". Click unfolds
     * them; which spaces are unfolded is kept.
     * @param {object} g The space's group.
     * @returns {object}
     */
    const idleFold = (g) => {
      const open = this.idleOpen.has(g.space);
      const ages = g.idle.map((a) => this.since(a)).filter(Boolean).map((at) => now - at);
      const newest = ages.length ? duration(Math.min(...ages)) : null;
      const oldest = ages.length ? duration(Math.max(...ages)) : null;
      const last = !newest ? "" : newest === oldest ? `, last ${newest}` : `, last ${newest} – ${oldest}`;
      return h_flex()
        .id(`idle-${g.id}`)
        .px(8)
        .h(26)
        .flex_none()
        .gap(9)
        .items_center()
        .rounded(8)
        .text_size(11.5)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.idleOpen.delete(g.space) : this.idleOpen.add(g.space);
          localStorage.setItem("idle.open", JSON.stringify([...this.idleOpen]));
          cx.notify();
        })
        .child(h_flex().w(16).flex_none().justify_center().child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11)))
        .child(div().truncate().child(`${g.idle.length} idle${last}`));
    };

    /**
     * A group's rows under its header: its agents, then a space's idle fold and, open, its idle agents.
     * @param {object} g The group.
     * @returns {object[]}
     */
    const body = (g) => [
      ...g.members.flatMap((a) => withKids(a, g.kind)),
      ...(g.idle?.length ? [idleFold(g), ...(this.idleOpen.has(g.space) ? g.idle.flatMap((a) => withKids(a, g.kind)) : [])] : []),
    ];
    const rows = collapsed
      ? list.flatMap((a) => withKids(a, null))
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : body(g))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              h_flex()
                .id("ag-sort")
                .h(22)
                .px(6)
                .mr(-6)
                .gap(4)
                .items_center()
                .rounded(6)
                .text_size(11.5)
                .text_color(t.muted)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "alp-agents", kind: "popup", width: 200, height: 110, props: { sortMenu: true } }))
                .child(sort.label)
                .child(svg("mods/workspace-chrome/chevron-down.svg").size(10).flex_none()),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agents yet. Claude Code sessions show up here.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).when(collapsed, (el) => el.pt(8).gap(2)).overflow_y_scrollbar().mode(collapsed ? "scrolling" : "always").children(rows));
  }
}
