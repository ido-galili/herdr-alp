// The Herds tab, one view at a time behind a Map | Cards switch. The Map (`herds-canvas.js`)
// draws each herd as a tree, its herdsman on top with lines down to the sessions it is linked to,
// each line labelled with how (a message and its time, or a worktree), and to the agents it
// started; the sessions grazing alone sit in a labelled lane under the herds. Cards lists the same
// sessions by what needs you: Needs you, then the herds, then grazing, with the sessions that have
// no tab folded into one line. Both views draw one card (`SessionCard`), and hovering a session
// lights it wherever it shows. A click opens its tab.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, panes, run, shared, spaces, theme } from "herdr";
import { agentsByAge, herdsOf } from "./herds-data.js";
import { Chip, Note, TextButton, formatTime } from "./ui.js";

const SPINNER = "mods/workspace-chrome/spinner.svg";

/**
 * The marks for who is who in a herd, Alp's own line icons: the herdsman's crook, a cow for a
 * member session, a lamb for a fork (a copy of its session), a herding dog for any other agent.
 */
const ROLE_ICONS = {
  herdsman: { icon: "mods/alpmeister/crook.svg", tooltip: "Herdsman: leads this herd" },
  member: { icon: "mods/alpmeister/cow.svg", tooltip: "In the herd: a session of its own" },
  grazing: { icon: "mods/alpmeister/cow.svg", tooltip: "Grazing: a session on its own" },
  fork: { icon: "mods/alpmeister/lamb.svg", tooltip: "Fork: a copy of its session, with its context" },
  agent: { icon: "mods/alpmeister/dog.svg", tooltip: "Agent: sent out by its session" },
};

/** The key's row and the gap under it, taken off the map's height while the key shows. */
const KEY_ROOM = 40;

/** A session's card at 100%, the same in Cards and on the Map: two lines, a stripe down the left. */
export const CARD = { w: 210, h: 54 };

/** Link or unlink a background session's tab, as a small button; null for other sessions. */
export function LinkButton(session, actions, prefix) {
  if (session.kind !== "bg" || (session.shownIn && !session.linked)) return null;
  return session.linked
    ? TextButton(`${prefix}-unlink-${session.id}`, "Unlink tab", (cx) => actions.link(session.id, null, cx), {
        tooltip: "Forget which tab shows this session",
      })
    : TextButton(`${prefix}-link-${session.id}`, "Link a tab", (cx) => actions.pick(session.id, cx), {
        tooltip: "Pick the tab that shows this background session",
      });
}

/**
 * Where a session runs: its space and what the tab bar shows for it (the terminal's title, else
 * the tab's name), else in the background or in Claude Desktop. `space: false` leaves the
 * space out, for a row already under its space.
 */
export function placeOf(session, live, { space = true } = {}) {
  const agent = live.get(session.terminal);
  if (agent) return space ? `${agent.space_name} / ${agent.title || agent.tab_name}` : agent.title || agent.tab_name;
  if (session.kind === "bg") return "background";
  if (session.entrypoint === "claude-desktop") return "Claude Desktop";
  return "no tab";
}

/**
 * A session's status: a background session's own state, else its terminal's live status from
 * Herdr, else what the registry last said.
 */
export function statusOf(session, live) {
  if (session.kind === "bg") return session.status;
  return live.get(session.terminal)?.status ?? session.status;
}

/**
 * A session's git branch: its terminal's live branch while it runs in its own terminal, else
 * the branch in its folder when the sessions were read. A tab showing a background session
 * sits in another folder, so it does not count.
 */
export function branchOf(session) {
  if (session.terminal && !session.shownIn) {
    const pane = panes().find((candidate) => candidate.terminal === session.terminal);
    if (pane?.branch) return pane.branch;
  }
  return session.branch ?? null;
}

/** The status mark, as the agents list draws it: spinner, Needs you, done dot, idle ring. */
export function StatusMark(t, status) {
  if (status === "working") return svg(SPINNER).size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return Chip("Needs you", { color: t.blocked, fill: `${t.blocked}26` });
  if (status === "done") return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
  return div()
    .size(7)
    .mx(2)
    .flex_none()
    .rounded(4)
    .border(1.5)
    .border_color(t.idle ?? t.dim);
}

/**
 * A role's mark at the end of a box's first line, with its meaning on hover.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {"herdsman" | "member" | "grazing" | "fork" | "agent"} role
 * @param {string} [color] The tint; the herdsman's is the accent.
 * @param {number} [size] The icon's size.
 * @returns {object}
 */
export function RoleIcon(t, id, role, color, size = 14) {
  const { icon, tooltip } = ROLE_ICONS[role];
  return div()
    .id(id)
    .flex_none()
    .text_color(color ?? t.muted)
    .tooltip(tooltip)
    .child(svg(icon).size(size));
}

/**
 * The "bg" tag: a session or an agent that runs in the background (the key says so).
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {number} [z] The zoom it is drawn at.
 * @returns {object} The tag.
 */
export function BgTag(t, id, z = 1) {
  return div()
    .id(id)
    .flex_none()
    .px(Math.max(2, 4 * z))
    .rounded(Math.max(2, 3 * z))
    .bg(t.hover)
    .text_size(Math.max(8, 11.5 * z))
    .text_color(t.muted)
    .tooltip("Runs in the background")
    .child("bg");
}

/**
 * The tabs to link a background session to: tabs viewing a background session first.
 * @param {object} t The theme.
 * @param {string} sessionId The background session to link.
 * @param {object[]} sessions Every session.
 * @param {Map} live The live tabs by terminal.
 * @param {object} actions The tab's callbacks.
 * @returns {object} The picker.
 */
function TabPicker(t, sessionId, sessions, live, actions) {
  const viewers = new Set(sessions.filter((session) => session.viewer).map((session) => session.terminal));
  const tabs = [...live.values()]
    .filter((agent) => agent.app === "claude-code")
    .sort((a, b) => Number(viewers.has(b.address)) - Number(viewers.has(a.address)));
  return v_flex()
    .w_full()
    .max_w(320)
    .p(6)
    .gap(2)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .child(div().px(6).py(2).text_size(11.5).text_color(t.dim).child("Which tab shows it?"))
    .children(
      tabs.map((agent) =>
        h_flex()
          .id(`hp-${agent.address}`)
          .px(6)
          .py(4)
          .gap(6)
          .rounded(5)
          .text_size(11.5)
          .text_color(t.foreground)
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => actions.link(sessionId, agent.address, cx))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .child(`${agent.space_name} / ${agent.title || agent.tab_name}`),
          )
          .when(viewers.has(agent.address), (el) =>
            el.child(div().text_size(11.5).text_color(t.accent).child("shows a background session")),
          ),
      ),
    )
    .child(TextButton(`hp-cancel-${sessionId}`, "Cancel", (cx) => actions.pick(null, cx)));
}

/** How a line to a member session reads: solid with the message time, or dotted for a worktree. */
export function linkLine(link) {
  if (!link) return { label: "", dotted: false };
  return link.kind === "message"
    ? { label: `msg ${formatTime(link.at)}`, dotted: false }
    : { label: "worktree", dotted: true };
}

/**
 * How a line to an agent reads: its type, always solid. Dotted means a worktree only; a
 * background agent says so with a "bg" tag on its box instead.
 */
export const agentLine = (agent) => ({ label: agent.type, dotted: false });

/** The latest link from the herdsman to a member: a message before a worktree. */
export function linkTo(herd, member) {
  const from = herd.links.filter((link) => link.from === herd.herdsman.id && link.to === member.id);
  return from.find((link) => link.kind === "message") ?? from[0] ?? null;
}

// A space's stored color as the spaces mod paints it (the same table as the agents list).
const MARK = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};

/**
 * The space colors to paint with: the demo's own in demo mode, else Herdr's.
 * @param {object} model loadHerds()'s result.
 * @returns {Record<string, string>}
 */
const spaceColors = (model) => model?.demo?.colors ?? shared("space.colors") ?? {};

/** A space's color, as its avatar in the sidebar shows it. */
function spaceColor(t, space, colors) {
  const color = colors[space] ?? "ansi6";
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
}

/**
 * The live tabs to draw with: the demo's made-up tabs in demo mode, else Herdr's.
 * @param {object} model loadHerds()'s result.
 * @returns {Map<string, object>} The tabs by terminal address.
 */
export const liveTabs = (model) => new Map((model?.demo?.agents ?? agents()).map((agent) => [agent.address, agent]));

/**
 * Sessions in the sidebar's space order, then by name; ones in no space last.
 * @param {object[]} sessions The sessions.
 * @param {Map} live The live tabs by terminal.
 * @param {object} model loadHerds()'s result.
 * @returns {object[]} A sorted copy.
 */
export function sortedBySpace(sessions, live, model) {
  const order = new Map((model?.demo?.spaces ?? spaces()).map((space, index) => [space.id, index]));
  const rank = (session) => order.get(live.get(session.terminal)?.space) ?? order.size;
  return [...sessions].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * The card's second line by default: the space and the branch, else where it runs.
 * @param {object} session The session.
 * @param {Map} live The live tabs by terminal.
 * @returns {string}
 */
function spaceAndBranch(session, live) {
  const parts = [live.get(session.terminal)?.space_name, branchOf(session)].filter(Boolean);
  return parts.length ? parts.join(" · ") : placeOf(session, live);
}

/**
 * A session's card, the one design both views draw: a stripe in its space's color down the left
 * edge; its status (a spinner while working, a dot when done), its name, then "Needs you" or
 * "idle", "bg" for a background session and the crook for a herdsman; below, its space and
 * branch. `z` scales it for the Map's zoom; under `compact` it shows the first line only. The
 * caller places it and adds what a press does.
 * @param {object} t The theme.
 * @param {object} session The session.
 * @param {Map} live The live tabs by terminal.
 * @param {object} actions The Herds tab's actions (`model`, `canvas`, `link`, `pick`).
 * @param {{ id: string, z?: number, width?: number, height?: number, role?: string, sub?: string,
 *   extras?: object[], compact?: boolean, tooltip?: string }} options
 * @returns {object} The card.
 */
export function SessionCard(t, session, live, actions, options) {
  const { id, z = 1, width = CARD.w, height = CARD.h, role, sub, extras = [], compact = false, tooltip } = options;
  const canvas = actions.canvas;
  const agent = live.get(session.terminal);
  const status = statusOf(session, live);
  const blocked = status === "blocked";
  const herdsman = role === "herdsman";
  const hot = canvas?.hot === session.id;
  const outlined = hot || (blocked && canvas?.outlineBlocked);
  const ring = hot ? t.accent : t.blocked;
  const text = (size) => Math.max(8, size * z);
  const lead =
    status === "working"
      ? svg(SPINNER).size(text(11)).flex_none().text_color(t.working).spin(900)
      : status === "done"
        ? div().size(text(7)).flex_none().rounded(text(4)).bg(t.done)
        : null;
  const trail = [
    blocked
      ? div()
          .flex_none()
          .px(Math.max(2, 4 * z))
          .rounded(Math.max(2, 4 * z))
          .bg(`${t.blocked}26`)
          .text_size(text(11.5))
          .text_color(t.blocked)
          .child("Needs you")
      : null,
    status === "idle" ? div().flex_none().text_size(text(11.5)).text_color(t.dim).child("idle") : null,
    session.kind === "bg" ? BgTag(t, `${id}-bg`, z) : null,
    herdsman ? RoleIcon(t, `${id}-role`, "herdsman", t.accent, text(13)) : null,
  ].filter(Boolean);
  // An outline is 2px: the padding gives up the extra pixel, so the text does not move.
  const border = outlined ? 2 : 1;
  const radius = Math.max(4, 8 * z);
  // The stripe is the card's own fill, showing left of the content: a child would square off
  // the rounded corners, since overflow_hidden clips to a plain rectangle.
  const stripe = agent ? spaceColor(t, agent.space, spaceColors(actions.model)) : t.border;
  return h_flex()
    .id(id)
    .w(width * z)
    .h(height * z)
    .flex_none()
    .items_stretch()
    .overflow_hidden()
    .rounded(radius)
    .border(border)
    .border_color(outlined ? ring : blocked ? t.blocked : herdsman ? (t.ansi8 ?? t.dim) : t.border)
    .bg(stripe)
    .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
    .when(Boolean(canvas), (el) =>
      el.on_hover((hovered, cx) => {
        if (hovered) canvas.setHot(session.id, cx);
        else if (canvas.hot === session.id) canvas.setHot(null, cx);
      }),
    )
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .ml(Math.max(2, 3 * z))
        .rounded_r(Math.max(0, radius - border))
        .bg(t.background)
        .hover((style) => style.bg(t.hover))
        .pl(Math.max(3, 9 * z) - (border - 1))
        .pr(Math.max(3, 9 * z) - (border - 1))
        .justify_center()
        .gap(Math.max(1, 3 * z))
        .child(
          h_flex()
            .gap(Math.max(3, 5 * z))
            .items_center()
            .min_w(0)
            .children(lead ? [lead] : [])
            .child(
              div()
                .flex_1()
                .min_w(0)
                .truncate()
                .text_size(text(12))
                .font_medium()
                .text_color(t.foreground)
                .child(session.name),
            )
            .children(trail),
        )
        .when(!compact, (el) =>
          el.child(
            h_flex()
              .gap(Math.max(3, 6 * z))
              .items_center()
              .min_w(0)
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_size(text(11.5))
                  .text_color(t.dim)
                  .child(sub ?? spaceAndBranch(session, live)),
              )
              .children(extras.filter(Boolean)),
          ),
        ),
    );
}

/**
 * Opens a session's tab, unless it has none or it is the demo's (made up: nothing to open).
 * @param {object} session The session.
 * @param {Map} live The live tabs by terminal.
 * @param {object} model loadHerds()'s result.
 */
function openTab(session, live, model) {
  if (live.has(session.terminal) && !model?.demo) run("pane.focus", { terminal: session.terminal });
}

/**
 * A card in the Cards view: the session's card, a click opening its tab.
 * @param {object} t The theme.
 * @param {object} session The session.
 * @param {Map} live The live tabs by terminal.
 * @param {object} actions The Herds tab's actions.
 * @param {{ role?: string, sub?: string }} [options] The herdsman's crook, and another second line.
 * @returns {object} The card.
 */
function ListCard(t, session, live, actions, options = {}) {
  const agent = live.get(session.terminal);
  return SessionCard(t, session, live, actions, {
    id: `hk-${session.id}`,
    extras: [LinkButton(session, actions, "hk")],
    tooltip: agent ? `Open its tab in ${agent.space_name}` : undefined,
    ...options,
  })
    .when(Boolean(agent), (el) => el.cursor_pointer())
    .on_click(() => openTab(session, live, actions.model));
}

/**
 * A section heading in the Cards view: its name and count.
 * @param {object} t The theme.
 * @param {string} name The section's name.
 * @param {number} count How many it holds.
 * @param {string} [color] The name's color.
 * @returns {object} The heading.
 */
function SectionHeading(t, name, count, color) {
  return h_flex()
    .gap(6)
    .items_center()
    .text_size(11.5)
    .font_semibold()
    .child(
      div()
        .text_color(color ?? t.muted)
        .child(name),
    )
    .child(div().text_color(t.dim).child(String(count)));
}

/** A wrapping row of cards. */
const CardRow = () => h_flex().flex_wrap().items_center().gap(8);

/**
 * What a herd's agents are doing, in words: "2 agents working · Explore, Plan".
 * @param {object} herd A herd from herdsOf().
 * @returns {string | null} The words, or null when none works.
 */
function agentsWorking(herd) {
  const working = [herd.herdsman, ...herd.members]
    .flatMap((session) => agentsByAge(session).recent)
    .filter((agent) => agent.status === "working");
  if (!working.length) return null;
  const types = [...new Set(working.map((agent) => (agent.fork ? "fork" : agent.type)))].slice(0, 3).join(", ");
  return `${working.length} agent${working.length === 1 ? "" : "s"} working · ${types}`;
}

/**
 * The Cards view: Needs you first (whatever its place), then each herd as its lead card, an
 * arrow and its members, then the sessions grazing alone, then the sessions with no tab folded
 * into one line. Each session shows once: a herd member that needs you is named in its herd's
 * row ("+ checkout-ui, above"), and hovering that name lights its card.
 * @param {object} t The theme.
 * @param {object} model loadHerds()'s result.
 * @param {{ herds: object[], grazing: object[] }} groups herdsOf()'s result.
 * @param {Map} live The live tabs by terminal.
 * @param {object} actions The Herds tab's actions.
 * @returns {object} The view.
 */
function CardsView(t, model, groups, live, actions) {
  const canvas = actions.canvas;
  const blocked = (session) => statusOf(session, live) === "blocked";
  const herdOf = new Map();
  for (const herd of groups.herds) for (const member of herd.members) herdOf.set(member.id, herd);
  const leads = new Set(groups.herds.map((herd) => herd.herdsman.id));
  const everyone = [...groups.herds.flatMap((herd) => [herd.herdsman, ...herd.members]), ...groups.grazing];
  const needsYou = sortedBySpace(everyone.filter(blocked), live, model);
  const grazing = groups.grazing.filter((session) => !blocked(session));
  const withTab = sortedBySpace(
    grazing.filter((session) => live.has(session.terminal)),
    live,
    model,
  );
  const background = sortedBySpace(
    grazing.filter((session) => !live.has(session.terminal)),
    live,
    model,
  );
  const space = (session) => live.get(session.terminal)?.space_name;
  // Where a session that needs you belongs, since its card is not in its herd's row.
  const whereFrom = (session) =>
    [
      space(session) ?? placeOf(session, live),
      leads.has(session.id)
        ? "leads a herd"
        : herdOf.has(session.id)
          ? `in ${herdOf.get(session.id).herdsman.name}'s herd`
          : "grazing",
    ].join(" · ");
  /** A name in a herd's row for a card shown above; hovering it lights that card. */
  const above = (session) =>
    div()
      .id(`hk-above-${session.id}`)
      .text_size(11.5)
      .text_color(canvas?.hot === session.id ? t.accent : t.dim)
      .on_hover((hovered, cx) => {
        if (hovered) canvas?.setHot(session.id, cx);
        else if (canvas?.hot === session.id) canvas.setHot(null, cx);
      })
      .child(`+ ${session.name}, above`);
  const arrow = () => div().text_size(12).text_color(t.dim).child("→");
  return v_flex()
    .gap(10)
    .when(needsYou.length > 0, (el) =>
      el
        .child(SectionHeading(t, "Needs you", needsYou.length, t.blocked))
        .child(
          CardRow().children(
            needsYou.map((session) =>
              ListCard(t, session, live, actions, {
                role: leads.has(session.id) ? "herdsman" : undefined,
                sub: whereFrom(session),
              }),
            ),
          ),
        ),
    )
    .when(groups.herds.length > 0, (el) =>
      el.child(SectionHeading(t, "Herds", groups.herds.length)).children(
        groups.herds.map((herd) => {
          const kept = herd.members.filter((member) => !blocked(member));
          const shownAbove = herd.members.filter(blocked);
          const doing = agentsWorking(herd);
          return CardRow()
            .child(
              blocked(herd.herdsman)
                ? above(herd.herdsman)
                : ListCard(t, herd.herdsman, live, actions, { role: "herdsman" }),
            )
            .child(arrow())
            .children(kept.map((member) => ListCard(t, member, live, actions)))
            .children(shownAbove.map(above))
            .when(Boolean(doing), (row) => row.child(Chip(doing, { color: t.muted })));
        }),
      ),
    )
    .when(withTab.length > 0, (el) =>
      el
        .child(SectionHeading(t, "Grazing", withTab.length))
        .child(CardRow().children(withTab.map((session) => ListCard(t, session, live, actions)))),
    )
    .when(background.length > 0, (el) =>
      el
        .child(
          h_flex()
            .id("hk-background")
            .gap(6)
            .items_center()
            .self_start()
            .px(4)
            .h(22)
            .rounded(5)
            .text_size(11.5)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover).text_color(t.foreground))
            .tooltip("Sessions with no tab: in the background, in Claude Desktop, or their tab closed")
            .on_click((_event, cx) => canvas?.toggleBackground(cx))
            .child(
              svg(`mods/workspace-chrome/chevron-${canvas?.backgroundOpen ? "down" : "right"}.svg`)
                .size(12)
                .flex_none(),
            )
            .child(`Background, no tab · ${background.length}`),
        )
        .when(Boolean(canvas?.backgroundOpen), (open) =>
          open.child(CardRow().children(background.map((session) => ListCard(t, session, live, actions)))),
        ),
    )
    .when(!everyone.length, (el) => el.child(Note("No Claude Code sessions are running.")));
}

/**
 * A count in the toolbar, as a rounded pill: its text color on a faint fill of it.
 * @param {string} id A unique element id.
 * @param {string} text The words.
 * @param {string} color The text color.
 * @param {string} fill The fill.
 * @returns {object} The pill.
 */
function Pill(id, text, color, fill) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(22)
    .px(8)
    .gap(5)
    .items_center()
    .rounded(11)
    .bg(fill)
    .text_size(11.5)
    .font_semibold()
    .text_color(color)
    .child(text);
}

/**
 * The key to the marks, under the toolbar, until you hide it: the crook, the fork's lamb, the
 * agent's dog, the two lines, the "bg" tag and the space stripe.
 * @param {object} t The theme.
 * @param {object} canvas The HerdsCanvas, which remembers whether the key is hidden.
 * @returns {object} The key row.
 */
function Key(t, canvas) {
  const entry = (mark, words) => h_flex().flex_none().gap(6).items_center().child(mark).child(words);
  const icon = (path, color) =>
    svg(path)
      .size(13)
      .flex_none()
      .text_color(color ?? t.muted);
  return h_flex()
    .flex_wrap()
    .items_center()
    .gap_x(18)
    .gap_y(6)
    .px(12)
    .py(6)
    .rounded(8)
    .bg(t.canvas)
    .border_1()
    .border_color(t.border)
    .text_size(11.5)
    .text_color(t.muted)
    .child(div().font_semibold().text_color(t.dim).child("Key"))
    .child(entry(icon(ROLE_ICONS.herdsman.icon, t.accent), "leads others"))
    .child(entry(icon(ROLE_ICONS.fork.icon), "fork"))
    .child(entry(icon(ROLE_ICONS.agent.icon), "agent"))
    .child(entry(div().w(20).h(1).bg(t.muted), "messaged"))
    .child(
      entry(
        h_flex()
          .w(20)
          .gap(4)
          .children([0, 1, 2].map(() => div().w(4).h(1).bg(t.muted))),
        "made its worktree",
      ),
    )
    .child(entry(BgTag(t, "herds-key-bg"), "runs in background"))
    .child(entry(div().w(3).h(14).rounded(1).bg(t.working), "space colour"))
    .child(div().flex_1())
    .child(TextButton("herds-key-hide", "Hide key", (cx) => canvas.setKeyHidden(true, cx)));
}

/**
 * The Herds tab. `model` is loadHerds()'s result, or null before the first load.
 * `actions`: `{ model, loading, picking, pick(sessionId|null, cx), link(sessionId, address|null, cx),
 * expandedAgents: Set<sessionId>, toggleAgents(sessionId, cx), canvas: HerdsCanvas, canvasHeight,
 * fullHeight }`. One toolbar for both views: the counts as pills ("N need you" first, red; a
 * click outlines those cards), the Map | Cards switch, then on the Map Fit, zoom and Lines ▾,
 * then full tab, and the key under it. With no herds the switch stays: the Map then holds only
 * the grazing lane. The map is `canvasHeight` tall, or `fullHeight` in full tab.
 * @param {object | null} model loadHerds()'s result.
 * @param {object} actions The actions above.
 * @returns {object} The tab's content.
 */
export function Herds(model, actions) {
  const t = theme();
  if (!model) return Note(actions.loading ? "Reading your Claude sessions…" : "No sessions read yet.");
  const live = liveTabs(model);
  const groups = herdsOf(model);
  const { herds, grazing } = groups;
  const shown = [...herds.flatMap((herd) => [herd.herdsman, ...herd.members]), ...grazing];
  const working = shown.filter((session) => statusOf(session, live) === "working").length;
  const blocked = shown.filter((session) => statusOf(session, live) === "blocked").length;
  const agentsWorking = shown
    .flatMap((session) => session.agents ?? [])
    .filter((agent) => agent.status === "working").length;
  const canvas = actions.canvas;
  const full = canvas.full;
  const onMap = canvas.view === "map";
  const picking = shown.find((session) => session.id === actions.picking);
  const name = (id) => model.sessions.find((session) => session.id === id)?.name ?? id;
  // On the map, the links between members (not from the herdsman) are listed under it.
  const others = herds.flatMap((herd) => herd.links.filter((link) => link.from !== herd.herdsman.id));

  const pills = [
    blocked
      ? Pill("herds-need-you", `● ${blocked} need${blocked === 1 ? "s" : ""} you`, t.blocked, `${t.blocked}26`)
          .cursor_pointer()
          .when(canvas.outlineBlocked, (el) => el.border_1().border_color(t.blocked))
          .hover((style) => style.bg(`${t.blocked}40`))
          .tooltip(canvas.outlineBlocked ? "Stop outlining them" : "Outline the sessions that need you")
          .on_click((_event, cx) => canvas.toggleOutline(herds, live, actions, cx))
      : null,
    working ? Pill("herds-working", `${working} working`, t.working, `${t.working}1f`) : null,
    Pill(
      "herds-sessions",
      `${shown.length} session${shown.length === 1 ? "" : "s"}${
        agentsWorking ? ` · ${agentsWorking} agent${agentsWorking === 1 ? "" : "s"}` : ""
      }`,
      t.muted,
      t.hover,
    ).when(agentsWorking > 0, (el) => el.tooltip(`${agentsWorking} agents working`)),
  ].filter(Boolean);

  const toolbar = h_flex()
    .items_center()
    .gap(8)
    .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("Herds"))
    .child(div().w(4))
    .children(pills)
    .child(div().flex_1())
    .children(canvas.switcher())
    .children(onMap ? [div().w(1).h(16).mx(4).bg(t.border), ...canvas.mapControls(t)] : [])
    .when(canvas.keyHidden, (el) =>
      el.child(
        TextButton("herds-key-show", "Key", (cx) => canvas.setKeyHidden(false, cx), { tooltip: "Show the key" }),
      ),
    )
    .child(canvas.fullButton());

  const noHerds = Note("No herds: no session has messaged another, made a worktree for one, or started agents lately.");
  const body = onMap
    ? v_flex()
        .gap(8)
        .when(!herds.length, (el) => el.child(noHerds))
        .child(
          canvas.render(
            t,
            groups,
            live,
            actions,
            // The key's row and its gap come off the map's height while it shows.
            Math.max(
              220,
              (full ? (actions.fullHeight ?? 600) : (actions.canvasHeight ?? 520)) - (canvas.keyHidden ? 0 : KEY_ROOM),
            ),
          ),
        )
        .when(others.length > 0, (el) =>
          el.child(
            v_flex()
              .gap(2)
              .text_size(11.5)
              .text_color(t.dim)
              .children(
                others.map((link) =>
                  div().child(
                    `${name(link.from)} → ${name(link.to)} · ${link.kind === "message" ? `msg ${formatTime(link.at)}` : "worktree"}`,
                  ),
                ),
              ),
          ),
        )
    : v_flex()
        .gap(10)
        .when(!herds.length, (el) => el.child(noHerds))
        .child(CardsView(t, model, groups, live, actions));

  const content = v_flex()
    .gap(10)
    .child(toolbar)
    .when(!canvas.keyHidden && herds.length > 0, (el) => el.child(Key(t, canvas)))
    .child(body)
    // The tab picker opens under the view, so the cards keep one height.
    .when(Boolean(picking), (el) => el.child(TabPicker(t, actions.picking, model.sessions, live, actions)));
  if (full) return content;
  return v_flex()
    .id("herds")
    .min_w(0)
    .p(14)
    .rounded(10)
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .child(content);
}
