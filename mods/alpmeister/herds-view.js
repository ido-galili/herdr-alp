// The Herds tab: each herd drawn as a graph, its herdsman on top with lines down to the sessions
// it is linked to, each line labelled with how (a message and its time, or a worktree), and to
// the agents it started, each line labelled with the agent's type. Below, the sessions grazing
// alone, a card each, striped in their space's color. A click opens a tab.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, panes, run, shared, spaces, theme } from "herdr";
import { agentChildren, agentsByAge, herdsOf } from "./herds-data.js";
import { Card, Chip, Note, TextButton, ago, formatTime } from "./ui.js";

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

/** The room each member of a herd gets: the graph stays compact on a wide tab. */
const MEMBER_WIDTH = 260;

/** The room each agent gets in a row: agents are smaller than sessions. */
const AGENT_WIDTH = 180;

/** The least room a herd's column takes in the row of herds: a herdsman with one member. */
const HERD_MIN_WIDTH = MEMBER_WIDTH;

/** One height for every agent box: status and description, then type and time. */
const AGENT_HEIGHT = 58;

/** One width for every grazing card, so the grid's rows line up. */
const CARD_WIDTH = 272;

/**
 * One height for every box and card: name, tab, branch. A card without a branch keeps the room,
 * and the Link a tab button sits in the tab's line, so no card grows taller than another.
 */
const CARD_HEIGHT = 86;

/** Link or unlink a background session's tab, as a small button; null for other sessions. */
function LinkButton(session, actions, prefix) {
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
function placeOf(session, live, { space = true } = {}) {
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
function statusOf(session, live) {
  if (session.kind === "bg") return session.status;
  return live.get(session.terminal)?.status ?? session.status;
}

/**
 * A session's git branch: its terminal's live branch while it runs in its own terminal, else
 * the branch in its folder when the sessions were read. A tab showing a background session
 * sits in another folder, so it does not count.
 */
function branchOf(session) {
  if (session.terminal && !session.shownIn) {
    const pane = panes().find((candidate) => candidate.terminal === session.terminal);
    if (pane?.branch) return pane.branch;
  }
  return session.branch ?? null;
}

/** The branch tag at the bottom of a card, drawn like the pane header's: icon and name. */
function BranchTag(t, branch) {
  return h_flex()
    .max_w_full()
    .min_w(0)
    .gap(4)
    .px(6)
    .h(18)
    .items_center()
    .rounded(5)
    .bg(t.hover)
    .text_size(10.5)
    .text_color(t.muted)
    .child(svg("mods/workspace-chrome/git-branch.svg").size(11).flex_none())
    .child(div().min_w(0).truncate().child(branch));
}

/** The status mark, as the agents list draws it: spinner, Needs you, done dot, idle ring. */
function StatusMark(t, status) {
  if (status === "working") return svg(SPINNER).size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return Chip("Needs you", { color: t.blocked, fill: `${t.blocked}26` });
  if (status === "done") return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
  return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}

/**
 * A role's mark at the end of a box's first line, with its meaning on hover.
 * @param {object} t The theme.
 * @param {string} id A unique element id.
 * @param {"herdsman" | "member" | "grazing" | "fork" | "agent"} role
 * @param {string} [color] The tint; the herdsman's is the accent.
 * @returns {object}
 */
function RoleIcon(t, id, role, color) {
  const { icon, tooltip } = ROLE_ICONS[role];
  return div().id(id).flex_none().text_color(color ?? t.muted).tooltip(tooltip).child(svg(icon).size(14));
}

/**
 * One session as a box: status, name and its role in the herd, then where it runs. A click opens
 * its tab.
 */
function SessionBox(t, session, live, actions, { herdsman = false, member = false } = {}) {
  const status = statusOf(session, live);
  const hasTab = live.has(session.terminal);
  return v_flex()
    .id(`hb-${session.id}`)
    .w_full()
    .max_w(240)
    .min_w(0)
    .h(CARD_HEIGHT)
    .flex_none()
    .px(10)
    .py(8)
    .gap(4)
    .rounded(8)
    .border_1()
    .border_color(herdsman ? t.accent : t.border)
    .bg(t.canvas)
    .when(hasTab, (el) =>
      el
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click(() => run("pane.focus", { terminal: session.terminal }))
        .tooltip("Open its tab"),
    )
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .min_w(0)
        .child(StatusMark(t, status))
        .child(
          div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(session.name),
        )
        .when(herdsman, (el) => el.child(RoleIcon(t, `hb-role-${session.id}`, "herdsman", t.accent)))
        .when(member, (el) => el.child(RoleIcon(t, `hb-role-${session.id}`, "member"))),
    )
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(10.5)
        .text_color(t.dim)
        .h(20)
        .child(div().flex_1().min_w(0).truncate().child(placeOf(session, live)))
        // A background session runs in no terminal: link it by hand to the tab that shows it.
        .children([LinkButton(session, actions, "hb")].filter(Boolean)),
    )
    .when(Boolean(branchOf(session)), (el) => el.child(h_flex().pt(2).child(BranchTag(t, branchOf(session)))));
}

/** The tabs to link a background session to: tabs viewing a background session first. */
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
    .child(div().px(6).py(2).text_size(10.5).text_color(t.dim).child("Which tab shows it?"))
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
          .child(div().flex_1().min_w(0).truncate().child(`${agent.space_name} / ${agent.title || agent.tab_name}`))
          .when(viewers.has(agent.address), (el) =>
            el.child(div().text_size(10).text_color(t.accent).child("shows a background session")),
          ),
      ),
    )
    .child(TextButton(`hp-cancel-${sessionId}`, "Cancel", (cx) => actions.pick(null, cx)));
}

/** How a line to a member session reads: solid with the message time, or dotted for a worktree. */
function linkLine(link) {
  if (!link) return { label: "", dotted: false };
  return link.kind === "message"
    ? { label: `msg ${formatTime(link.at)}`, dotted: false }
    : { label: "worktree", dotted: true };
}

/** How a line to an agent reads: its type, dotted while it runs in the background. */
const agentLine = (agent) => ({ label: agent.type, dotted: agent.background });

/** A line down from the bar to one member or agent, solid or dotted, with its label. */
function Connector(t, index, count, { label, dotted }) {
  const line = t.border;
  const stub = dotted
    ? v_flex()
        .w(1)
        .h(22)
        .gap(3)
        .flex_none()
        .children([0, 1, 2, 3].map(() => div().w(1).h(3).bg(t.dim)))
    : div().w(1).h(22).flex_none().bg(line);
  return v_flex()
    .w_full()
    .child(
      h_flex()
        .w_full()
        .h(1)
        .child(div().flex_1().h(1).when(index > 0, (el) => el.bg(line)))
        .child(div().flex_1().h(1).when(index < count - 1, (el) => el.bg(line))),
    )
    // The label is cut short rather than widening its side: a long one (an agent type such as
    // general-purpose) would push the line off the column's middle, away from the bar's end
    // and the box below.
    .child(
      h_flex()
        .w_full()
        .child(div().flex_1().min_w(0))
        .child(stub)
        .child(div().flex_1().min_w(0).overflow_hidden().pl(5).pt(5).text_size(10).text_color(t.dim).truncate().child(label)),
    );
}

/**
 * One agent a session started: its status and what it is for, then its type and how long it has
 * run, or when it finished. A click opens its session's tab, where it reports.
 */
function AgentBox(t, agent, session, live) {
  const now = Date.now();
  const hasTab = live.has(session.terminal);
  const when = agent.finished
    ? `done ${ago(now - (agent.lastAt ?? now))} ago`
    : agent.startedAt
      ? `${ago(now - agent.startedAt)}${agent.status === "idle" ? " · quiet" : ""}`
      : "";
  const details = [
    agent.fork ? "fork of the session" : `${agent.type} agent`,
    agent.background ? "in the background" : "in the foreground",
    agent.model ? `model ${agent.model}` : null,
    agent.startedAt ? `started ${formatTime(agent.startedAt)}` : null,
  ].filter(Boolean);
  return v_flex()
    .id(`ha-${session.id}-${agent.id}`)
    .w_full()
    .max_w(AGENT_WIDTH - 12)
    .min_w(0)
    .h(AGENT_HEIGHT)
    .flex_none()
    .px(8)
    .py(7)
    .gap(4)
    .rounded(7)
    .border_1()
    .border_color(agent.status === "working" ? `${t.working}66` : t.border)
    .bg(t.canvas)
    .tooltip(`${agent.description}\n${details.join(" · ")}`)
    .when(hasTab, (el) =>
      el
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click(() => run("pane.focus", { terminal: session.terminal })),
    )
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .min_w(0)
        .child(StatusMark(t, agent.status))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_size(11.5)
            .text_color(agent.finished ? t.muted : t.foreground)
            .child(agent.description),
        )
        .child(RoleIcon(t, `ha-role-${session.id}-${agent.id}`, agent.fork ? "fork" : "agent")),
    )
    .child(div().text_size(10).text_color(t.dim).truncate().child(when));
}

/**
 * An agent and, under it, the agents it started, each a step in with a short line from its
 * parent, as deep as they go.
 */
function AgentTree(t, agent, session, live) {
  const children = agentChildren(session, agent);
  return v_flex()
    .w_full()
    .items_center()
    .child(div().w_full().px(6).flex().justify_center().child(AgentBox(t, agent, session, live)))
    .children(
      children.map((child) =>
        v_flex()
          .w_full()
          .pl(14)
          .items_center()
          .child(div().w(1).h(10).bg(t.border))
          .child(AgentTree(t, child, session, live)),
      ),
    );
}

/**
 * A member session's own agents, stacked under its box in its column, with the button that shows
 * or folds the ones finished earlier.
 */
function AgentStack(t, session, live, actions) {
  const { recent, earlier } = agentsByAge(session);
  const open = actions.expandedAgents?.has(session.id);
  const shown = open ? [...earlier, ...recent] : recent;
  if (!shown.length && !earlier.length) return null;
  return v_flex()
    .w_full()
    .items_center()
    .gap(4)
    .pt(6)
    .children(shown.map((agent) => AgentTree(t, agent, session, live)))
    .when(earlier.length > 0, (el) => el.child(EarlierToggle(t, session, earlier.length, open, actions)));
}

/** "+ N finished earlier": shows or folds a session's agents that finished a while ago. */
function EarlierToggle(t, session, count, open, actions) {
  return TextButton(
    `ha-earlier-${session.id}`,
    open ? "Hide the earlier agents" : `+ ${count} finished earlier`,
    (cx) => actions.toggleAgents(session.id, cx),
  );
}

/** The latest link from the herdsman to a member: a message before a worktree. */
function linkTo(herd, member) {
  const from = herd.links.filter((link) => link.from === herd.herdsman.id && link.to === member.id);
  return from.find((link) => link.kind === "message") ?? from[0] ?? null;
}

/**
 * One herd: the herdsman's box, a line down, then side by side the member sessions (each with its
 * own agents under it) and the herdsman's agents. A column as wide as its members and agents, so
 * the herds sit side by side in a row that scrolls sideways.
 */
function HerdGraph(t, herd, sessions, live, actions) {
  const { recent, earlier } = agentsByAge(herd.herdsman);
  const open = actions.expandedAgents?.has(herd.herdsman.id);
  const ownAgents = open ? [...earlier, ...recent] : recent;
  const count = herd.members.length + ownAgents.length;
  const others = herd.links.filter((link) => link.from !== herd.herdsman.id);
  const name = (id) => sessions.find((session) => session.id === id)?.name ?? id;
  const width = Math.max(HERD_MIN_WIDTH, herd.members.length * MEMBER_WIDTH + ownAgents.length * AGENT_WIDTH);
  return v_flex()
    .id(`herd-${herd.herdsman.id}`)
    .w(width)
    .flex_none()
    .items_center()
    .child(SessionBox(t, herd.herdsman, live, actions, { herdsman: true }))
    .when(actions.picking === herd.herdsman.id, (el) =>
      el.child(div().pt(6).child(TabPicker(t, herd.herdsman.id, sessions, live, actions))),
    )
    .child(div().w(1).h(14).bg(t.border))
    .child(
      h_flex()
        .w_full()
        .items_start()
        .children(
          herd.members.map((member, index) =>
            v_flex()
              .flex_grow(1)
              .flex_basis(MEMBER_WIDTH)
              .min_w(0)
              .items_center()
              .child(Connector(t, index, count, linkLine(linkTo(herd, member))))
              .child(div().w_full().px(6).flex().justify_center().child(SessionBox(t, member, live, actions, { member: true })))
              .when(actions.picking === member.id, (el) =>
                el.child(div().pt(6).px(6).child(TabPicker(t, member.id, sessions, live, actions))),
              )
              .children([AgentStack(t, member, live, actions)].filter(Boolean)),
          ),
        )
        .children(
          ownAgents.map((agent, index) =>
            v_flex()
              .flex_grow(1)
              .flex_basis(AGENT_WIDTH)
              .min_w(0)
              .items_center()
              .child(Connector(t, herd.members.length + index, count, agentLine(agent)))
              .child(AgentTree(t, agent, herd.herdsman, live)),
          ),
        ),
    )
    .when(earlier.length > 0, (el) => el.child(div().pt(8).child(EarlierToggle(t, herd.herdsman, earlier.length, open, actions))))
    .when(others.length > 0, (el) =>
      el.child(
        v_flex()
          .w_full()
          .pt(10)
          .gap(2)
          .text_size(10.5)
          .text_color(t.dim)
          .children(
            others.map((link) =>
              div().child(
                `${name(link.from)} → ${name(link.to)} · ${
                  link.kind === "message" ? `msg ${formatTime(link.at)}` : "worktree"
                }`,
              ),
            ),
          ),
      ),
    );
}

// A space's stored color as the spaces mod paints it (the same table as the agents list).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

/** A space's color, as its avatar in the sidebar shows it. */
function spaceColor(t, space) {
  const color = (shared("space.colors") ?? {})[space] ?? "ansi6";
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
}

/** A space's avatar: its first letter on its color, as the agents list and spaces mod draw it. */
function Avatar(t, key, space, name, size = 16) {
  return h_flex()
    .id(key)
    .size(size)
    .flex_none()
    .rounded(Math.round((size * 5) / 18))
    .bg(spaceColor(t, space))
    .items_center()
    .justify_center()
    .text_size((size * 10.5) / 18)
    .font_bold()
    .text_color("#ffffff")
    .child([...(name ?? "")][0]?.toUpperCase() ?? "?");
}

/** The grazing sessions in the sidebar's space order, then by name; ones in no space last. */
function sortedBySpace(grazing, live) {
  const order = new Map(spaces().map((space, index) => [space.id, index]));
  const rank = (session) => order.get(live.get(session.terminal)?.space) ?? order.size;
  return [...grazing].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * A grazing session as a card: a stripe in its space's color down the left edge, its status and
 * name, the space's avatar in the corner (its name on hover), and below what its tab is called,
 * or the space's name when the tab is titled with the session's own. A click opens its tab.
 */
function GrazingCard(t, session, live, actions) {
  const agent = live.get(session.terminal);
  const tabName = placeOf(session, live, { space: false });
  const second = agent && tabName === session.name ? agent.space_name : tabName;
  return h_flex()
    .id(`hg-${session.id}`)
    .w(CARD_WIDTH)
    .h(CARD_HEIGHT)
    .flex_none()
    .items_stretch()
    .overflow_hidden()
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.canvas)
    .when(Boolean(agent), (el) =>
      el
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click(() => run("pane.focus", { terminal: session.terminal }))
        .tooltip(`Open its tab in ${agent.space_name}`),
    )
    .child(div().w(3).flex_none().bg(agent ? spaceColor(t, agent.space) : t.border))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .px(10)
        .py(8)
        .gap(4)
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .min_w(0)
            .child(StatusMark(t, statusOf(session, live)))
            .child(
              div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(session.name),
            )
            .child(RoleIcon(t, `hg-role-${session.id}`, "grazing"))
            .when(Boolean(agent), (el) =>
              el.child(Avatar(t, `hg-av-${session.id}`, agent.space, agent.space_name, 15).tooltip(agent.space_name)),
            ),
        )
        .child(
          h_flex()
            .h(20)
            .gap(6)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(second))
            .children([LinkButton(session, actions, "hg")].filter(Boolean)),
        )
        .when(Boolean(branchOf(session)), (el) => el.child(h_flex().pt(2).child(BranchTag(t, branchOf(session))))),
    );
}

/**
 * The Herds tab. `model` is loadHerds()'s result, or null before the first load.
 * `actions`: `{ model, loading, picking, pick(sessionId|null, cx), link(sessionId, address|null, cx),
 * expandedAgents: Set<sessionId>, toggleAgents(sessionId, cx) }`.
 */
export function Herds(model, actions) {
  const t = theme();
  if (!model) return Note(actions.loading ? "Reading your Claude sessions…" : "No sessions read yet.");
  const live = new Map(agents().map((agent) => [agent.address, agent]));
  const { herds, grazing } = herdsOf(model);
  const shown = [...herds.flatMap((herd) => [herd.herdsman, ...herd.members]), ...grazing];
  const working = shown.filter((session) => statusOf(session, live) === "working").length;
  const blocked = shown.filter((session) => statusOf(session, live) === "blocked").length;
  const agentsWorking = shown.flatMap((session) => session.agents ?? []).filter((agent) => agent.status === "working").length;
  return v_flex()
    .gap(14)
    .child(
      Card(
        "herds",
        "Herds",
        [
          Chip(
            `${shown.length} sessions · ${working} working · ${blocked} need you${
              agentsWorking ? ` · ${agentsWorking} agents working` : ""
            }`,
            { color: t.dim },
          ),
        ],
        herds.length
          ? // The herds side by side, a divider between them; a wide row scrolls sideways.
            h_flex()
              .id("herds-row")
              .w_full()
              .items_start()
              .pb(10)
              .overflow_x_scrollbar()
              .children(
                herds.flatMap((herd, index) => [
                  index > 0 ? div().w(1).self_stretch().mx(16).flex_none().bg(t.border) : null,
                  HerdGraph(t, herd, model.sessions, live, actions),
                ]).filter(Boolean),
              )
          : Note("No herds: no session has messaged another, made a worktree for one, or started agents lately."),
      ),
    )
    .child(
      Card(
        "grazing",
        "Grazing",
        [Chip(String(grazing.length), { color: t.dim })],
        h_flex()
          .flex_wrap()
          .items_start()
          .gap(12)
          .when(!grazing.length, (el) => el.child(Note("Every session is in a herd.")))
          .children(sortedBySpace(grazing, live).map((session) => GrazingCard(t, session, live, actions)))
          // The tab picker opens below the grid, so the cards keep one height.
          .when(Boolean(grazing.find((session) => session.id === actions.picking)), (el) =>
            el.child(div().w_full().child(TabPicker(t, actions.picking, model.sessions, live, actions))),
          ),
      ),
    );
}
