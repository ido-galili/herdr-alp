// The bottom panel's parts: the bar over the output (the selected session and its stop, restart
// and hide buttons), the sessions list beside it, and the placeholder the output block shows when
// no session is selected.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { layout, notify, run, theme, window } from "herdr";
import { findWorkspace, loadEntries } from "./config.js";
import {
  closeAndWait,
  closeSession,
  forgetClosedSessions,
  LIST_GRACE_MS,
  sessions,
  startedAnswers,
  stopSession,
} from "./runner.js";
import { find, openRunTab, outputShows, PANEL_ID, selectedAddress, selectedAt, showSession } from "./panel.js";
import { launch, sessionMark } from "./list-view.js";

const STOP_ICON = "mods/alp-runs/stop.svg";
const RESTART_ICON = "mods/alp-runs/restart.svg";
const CLOSE_ICON = "mods/workspace-chrome/x.svg";
const ESCALATE_MS = 4000;

/** A 24px icon button. */
function iconButton(t, id, icon, tooltip, action) {
  return h_flex()
    .id(id)
    .flex_none()
    .size(24)
    .items_center()
    .justify_center()
    .rounded(6)
    .cursor_pointer()
    .text_color(t.muted)
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .tooltip(tooltip)
    .on_click(action)
    .child(svg(icon).size(12));
}

/**
 * Closes a session's terminal. A selected one hands the output block to another session of its
 * workspace first, so Herdr doesn't drop the block with the terminal.
 * @param {object} session From `sessions()`.
 */
export function closeAndMoveOn(session) {
  if (selectedAddress() === session.address) {
    const next = sessions().find((other) => other.address !== session.address && other.workspace === session.workspace);
    showSession(next?.address ?? null, { reveal: false });
  }
  closeSession(session);
}

/**
 * Starts a session's entry again with the answers it started with.
 * @param {object} session From `sessions()`.
 */
async function restart(session) {
  const workspace = await findWorkspace(session.workspace);
  const catalog = await loadEntries(workspace, window()?.platform ?? "macos");
  const entry = catalog.runs.find((item) => item.key === session.key);
  if (!entry) {
    notify({ title: `${session.title} is no longer in the workspace`, level: "warning" });
    return;
  }
  const answers = startedAnswers(session.address);
  showSession(null, { reveal: false });
  await closeAndWait(session.address);
  await launch(entry, catalog, workspace, answers);
}

export class BarPart {
  init() {
    this.stopAt = 0;
    this.fixAt = 0;
  }

  /** Keeps the output block on the selected session, or on another when it is gone. */
  keepOutput(cx, list) {
    const selected = selectedAddress();
    // A run selected a moment ago may not be in Herdr's terminal list yet.
    const fresh = Date.now() - selectedAt() < LIST_GRACE_MS;
    const exists = fresh || list.some((session) => session.address === selected);
    const want = exists ? selected : (list[0]?.address ?? null);
    if (outputShows(want) && want === selected) return;
    if (Date.now() - this.fixAt < 1000) return;
    this.fixAt = Date.now();
    cx.spawn(async () => {
      showSession(want, { reveal: false });
      forgetClosedSessions();
    });
  }

  render(cx) {
    const t = theme();
    const list = sessions();
    this.keepOutput(cx, list);
    const session = list.find((candidate) => candidate.address === selectedAddress());
    const mark = sessionMark(t, session);
    const stop = (_event, cx) => {
      const escalate = Date.now() - this.stopAt < ESCALATE_MS;
      this.stopAt = Date.now();
      cx.spawn(async () => stopSession(session, escalate ? "TERM" : "INT"));
    };
    return h_flex()
      .id("alp-runs-bar")
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .when(!session, (el) => el.child(div().flex_1().text_color(t.dim).child("No run selected")))
      .when(Boolean(session), (el) =>
        el
          .child(div().flex_none().text_size(10).text_color(mark.color).child(mark.glyph))
          .child(div().flex_none().font_medium().text_color(t.foreground).child(session.title))
          .child(
            div()
              .flex_none()
              .text_color(t.dim)
              .tooltip(`Agents read it with: hc read ${session.name}`)
              .child(session.name),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_color(t.dim)
              .child(session.running ? "" : `exited with ${session.exit}`),
          )
          .when(session.running, (el) =>
            el.child(
              iconButton(
                t,
                "runs-stop",
                STOP_ICON,
                Date.now() - this.stopAt < ESCALATE_MS ? "Stop again: terminate" : "Stop (Ctrl-C)",
                stop,
              ),
            ),
          )
          .child(
            iconButton(t, "runs-restart", RESTART_ICON, "Restart", (_event, cx) =>
              cx.spawn(async () => restart(session)),
            ),
          ),
      )
      .child(iconButton(t, "runs-hide", CLOSE_ICON, "Hide the runs panel", () => run("layout.hide", { id: PANEL_ID })));
  }
}

export class SessionsPart {
  init() {}

  /** One session: its state, its name, and its close button. */
  row(t, session, selected) {
    const mark = sessionMark(t, session);
    return h_flex()
      .id(`session-${session.address}`)
      .w_full()
      .h(26)
      .pl(10)
      .pr(4)
      .gap(7)
      .items_center()
      .text_size(12)
      .cursor_pointer()
      .bg(selected ? t.selected : t.chrome)
      .hover((style) => style.bg(selected ? t.selected : t.hover))
      .on_click(() => showSession(session.address))
      .child(div().w(10).flex_none().text_size(10).text_color(mark.color).child(mark.glyph))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(selected ? t.foreground : t.muted)
          .child(session.title),
      )
      .when(!session.running && session.exit !== 0, (el) =>
        el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(session.exit))),
      )
      .child(
        h_flex()
          .id(`session-close-${session.address}`)
          .flex_none()
          .size(20)
          .items_center()
          .justify_center()
          .rounded(5)
          .text_color(t.dim)
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .tooltip(session.running ? "Stop and close" : "Close")
          .on_click((_event, cx) => {
            cx.stop_propagation();
            closeAndMoveOn(session);
          })
          .child(svg(CLOSE_ICON).size(11)),
      );
  }

  render() {
    const t = theme();
    const list = sessions();
    const selected = selectedAddress();
    const finished = list.filter((session) => !session.running);
    const workspaces = [...new Set(list.map((session) => session.workspace))];
    const rows = workspaces.flatMap((workspace) => [
      ...(workspaces.length > 1
        ? [div().px(10).pt(8).pb(2).text_size(10.5).text_color(t.dim).truncate().child(workspace.split("/").pop())]
        : []),
      ...list
        .filter((session) => session.workspace === workspace)
        .map((session) => this.row(t, session, session.address === selected)),
    ]);
    return v_flex()
      .id("alp-runs-sessions")
      .size_full()
      .bg(t.chrome)
      .child(
        h_flex()
          .flex_none()
          .h(28)
          .px(10)
          .items_center()
          .child(div().flex_1().text_size(10.5).font_semibold().text_color(t.dim).child("SESSIONS"))
          .when(finished.length > 0, (el) =>
            el.child(
              div()
                .id("sessions-clear")
                .text_size(11)
                .text_color(t.dim)
                .cursor_pointer()
                .hover((style) => style.text_color(t.foreground))
                .tooltip("Close every finished session")
                .on_click(() => finished.forEach(closeAndMoveOn))
                .child("Clear finished"),
            ),
          ),
      )
      .when(!list.length, (el) =>
        el.child(div().px(10).py(4).text_size(11.5).text_color(t.dim).child("Nothing has run yet.")),
      )
      .child(v_flex().id("sessions-scroll").flex_1().min_h(0).overflow_y_scrollbar().children(rows));
  }
}

export class EmptyPart {
  init() {}

  render() {
    const t = theme();
    const basecamp = find(layout(), "basecamp");
    return v_flex()
      .id("alp-runs-empty")
      .size_full()
      .items_center()
      .justify_center()
      .gap(10)
      .bg(t.background)
      .text_size(12.5)
      .text_color(t.dim)
      .child("No run selected.")
      .when(Boolean(basecamp), (el) =>
        el.child(
          div()
            .id("empty-open-run")
            .px(12)
            .py(5)
            .rounded(7)
            .border_1()
            .border_color(t.input)
            .cursor_pointer()
            .text_color(t.foreground)
            .hover((style) => style.bg(t.hover))
            .on_click(() => openRunTab())
            .child("Open Basecamp's Run tab"),
        ),
      );
  }
}
