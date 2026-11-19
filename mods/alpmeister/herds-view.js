// The Herds tab: each herd drawn as a graph, its herdsman on top with lines down to the sessions
// it is linked to, each line labelled with how (a message and its time, or a worktree). Below,
// the sessions grazing alone, a card each, striped in their space's color. A click opens a tab.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, panes, run, shared, spaces, theme } from "herdr";
import { herdsOf } from "./herds-data.js";
import { Card, Chip, Note, TextButton, formatTime } from "./ui.js";

const SPINNER = "mods/workspace-chrome/spinner.svg";

/** The room each member of a herd gets: the graph stays compact on a wide tab. */
const MEMBER_WIDTH = 260;

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

/** One session as a box: status, name, where it runs. A click opens its tab. */
function SessionBox(t, session, live, actions, { herdsman = false } = {}) {
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
        ),
    )
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_size(10.5)
        .text_color(t.dim)
        .h(20)
        .when(herdsman, (el) => el.child(div().flex_none().text_color(t.accent).font_medium().child("herdsman")))
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

/** A line down to one member, solid for a message and dotted for a worktree, with its label. */
function Connector(t, index, count, link) {
  const line = t.border;
  const dotted = link?.kind === "worktree";
  const stub = dotted
    ? v_flex()
        .w(1)
        .h(22)
        .gap(3)
        .flex_none()
        .children([0, 1, 2, 3].map(() => div().w(1).h(3).bg(t.dim)))
    : div().w(1).h(22).flex_none().bg(line);
  const label = link ? (link.kind === "message" ? `msg ${formatTime(link.at)}` : "worktree") : "";
  return v_flex()
    .w_full()
    .child(
      h_flex()
        .w_full()
        .h(1)
        .child(div().flex_1().h(1).when(index > 0, (el) => el.bg(line)))
        .child(div().flex_1().h(1).when(index < count - 1, (el) => el.bg(line))),
    )
    .child(
      h_flex()
        .w_full()
        .child(div().flex_1())
        .child(stub)
        .child(div().flex_1().pl(5).pt(5).text_size(10).text_color(t.dim).child(label)),
    );
}

/** The latest link from the herdsman to a member: a message before a worktree. */
function linkTo(herd, member) {
  const from = herd.links.filter((link) => link.from === herd.herdsman.id && link.to === member.id);
  return from.find((link) => link.kind === "message") ?? from[0] ?? null;
}

/** One herd: the herdsman's box, a line down, then the members side by side. */
function HerdGraph(t, herd, sessions, live, actions) {
  const count = herd.members.length;
  const others = herd.links.filter((link) => link.from !== herd.herdsman.id);
  const name = (id) => sessions.find((session) => session.id === id)?.name ?? id;
  return v_flex()
    .w_full()
    .items_center()
    .child(SessionBox(t, herd.herdsman, live, actions, { herdsman: true }))
    .when(actions.picking === herd.herdsman.id, (el) =>
      el.child(div().pt(6).child(TabPicker(t, herd.herdsman.id, sessions, live, actions))),
    )
    .child(div().w(1).h(14).bg(t.border))
    .child(
      h_flex()
        .w_full()
        .max_w(count * MEMBER_WIDTH)
        .items_start()
        .children(
          herd.members.map((member, index) =>
            v_flex()
              .flex_1()
              .min_w(0)
              .items_center()
              .child(Connector(t, index, count, linkTo(herd, member)))
              .child(div().w_full().px(6).flex().justify_center().child(SessionBox(t, member, live, actions)))
              .when(actions.picking === member.id, (el) =>
                el.child(div().pt(6).px(6).child(TabPicker(t, member.id, sessions, live, actions))),
              ),
          ),
        ),
    )
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
 * `actions`: `{ model, loading, picking, pick(sessionId|null, cx), link(sessionId, address|null, cx) }`.
 */
export function Herds(model, actions) {
  const t = theme();
  if (!model) return Note(actions.loading ? "Reading your Claude sessions…" : "No sessions read yet.");
  const live = new Map(agents().map((agent) => [agent.address, agent]));
  const { herds, grazing } = herdsOf(model);
  const shown = [...herds.flatMap((herd) => [herd.herdsman, ...herd.members]), ...grazing];
  const working = shown.filter((session) => statusOf(session, live) === "working").length;
  const blocked = shown.filter((session) => statusOf(session, live) === "blocked").length;
  return v_flex()
    .gap(14)
    .child(
      Card(
        "herds",
        "Herds",
        [
          Chip(`${shown.length} sessions · ${working} working · ${blocked} need you`, { color: t.dim }),
        ],
        v_flex()
          .gap(18)
          .when(!herds.length, (el) =>
            el.child(
              Note("No herds: no session has messaged another or made a worktree for one."),
            ),
          )
          .children(herds.map((herd) => HerdGraph(t, herd, model.sessions, live, actions))),
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
