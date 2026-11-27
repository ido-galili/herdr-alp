// The "Today's focus" card: a todo input, then the picks and todos with checkboxes. An item
// added before today shows how many days ago.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { theme } from "herdr";
import { daysSinceAdded } from "./focus.js";
import {
  Card,
  Chip,
  ICONS,
  IconButton,
  NeedsYou,
  Note,
  SessionButton,
  claudeTooltip,
  fillPrompt,
  openUrl,
  sessionTab,
  shortRepo,
  statusColor,
} from "./ui.js";

// The item types in the order the Daypack lists them, each under its own heading.
const SECTIONS = [
  { kind: "todo", title: "Todos" },
  { kind: "pr", title: "PRs" },
  { kind: "issue", title: "Issues" },
];

/**
 * A section heading: the item type and how many of its items are still open.
 * @param {string} title The item type's heading.
 * @param {object[]} rows The section's items.
 * @returns {object} The heading.
 */
function SectionHeading(title, rows) {
  const t = theme();
  return h_flex()
    .px(6)
    .pt(6)
    .gap(6)
    .items_center()
    .text_size(11.5)
    .child(div().font_medium().text_color(t.muted).child(title))
    .child(div().text_color(t.dim).child(String(rows.filter((item) => !item.done).length)));
}

/** A 14px checkbox drawn in Alp's colors. */
function Checkbox(id, checked, onToggle) {
  const t = theme();
  return h_flex()
    .id(id)
    .flex_none()
    .size(14)
    .items_center()
    .justify_center()
    .rounded(4)
    .border_1()
    .border_color(checked ? t.done : t.input)
    .bg(checked ? t.done : t.background)
    .cursor_pointer()
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onToggle(cx);
    })
    .when(checked, (el) => el.child(div().text_size(10).text_color(t.background).child("✓")));
}

/**
 * Where a GitHub item stands, as of the last refresh, checked or not: an issue's board status
 * (or "Closed" when it has none), or a PR's review decision while it is open, else "Merged" or
 * "Closed". Null for a todo, or before the first refresh has read it.
 */
function StandingChip(t, item) {
  if (item.kind === "issue") {
    if (item.status) return Chip(item.status, { color: statusColor(t, item.status) });
    if (item.state === "CLOSED") return Chip("Closed", { color: t.done });
    return null;
  }
  if (item.kind === "pr") {
    if (item.state === "MERGED") return Chip("Merged", { color: t.done });
    if (item.state === "CLOSED") return Chip("Closed", { color: t.dim });
    if (item.review === "APPROVED") return Chip("Approved", { color: t.done });
    if (item.review === "CHANGES_REQUESTED") {
      return NeedsYou("Changes Requested").id(`fc-rd-${item.id}`).tooltip("A reviewer asked for changes");
    }
    if (item.review === "REVIEW_REQUIRED") return Chip("In Review", { color: t.muted });
  }
  return null;
}

/**
 * A todo's text being edited: Enter or a click away saves, Esc cancels.
 * @param {object} t The theme.
 * @param {object} edit The edit actions: `{ input, cancel(cx) }`.
 */
function TodoEditor(t, edit) {
  return div()
    .flex_1()
    .min_w(0)
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      cx.stop_propagation();
      edit.cancel(cx);
    })
    .child(
      Input.new(edit.input)
        .h(24)
        .px(6)
        .rounded(6)
        .border_1()
        .border_color(t.accent)
        .bg(t.background)
        .text_size(12)
        .text_color(t.foreground),
    );
}

/**
 * One focus item: checkbox, text, an issue's status or a PR's review decision, days since it was
 * added, a Claude button for a GitHub item, an edit button for a todo, and a remove button. A
 * GitHub item opens on click. A todo's text opens for editing on a double-click or the edit button.
 */
function FocusItem(item, actions) {
  const t = theme();
  const label = item.kind === "todo" ? item.text : item.title;
  const days = daysSinceAdded(item);
  const command = item.kind === "todo" ? "" : actions.command(item.kind);
  const isTodo = item.kind === "todo";
  const editing = isTodo && actions.edit.id === item.id;
  const session = isTodo ? null : sessionTab(item);
  return h_flex()
    .id(`fc-${item.id}`)
    .w_full()
    .min_w(0)
    .gap(8)
    .px(6)
    .py(5)
    .items_center()
    .rounded(6)
    .hover((style) => style.bg(t.hover))
    .when(item.kind !== "todo", (el) => el.cursor_pointer().on_click(() => openUrl(item.url)))
    .child(Checkbox(`fc-check-${item.id}`, item.done, (cx) => actions.toggle(item.id, cx)))
    .when(item.kind !== "todo", (el) =>
      el.child(
        Chip(`${item.kind === "pr" ? "PR " : ""}${shortRepo(item.repo)}#${item.number}`, {
          color: t.dim,
          id: `fc-num-${item.id}`,
          tooltip: item.repo ?? "",
        }),
      ),
    )
    .when(editing, (el) => el.child(TodoEditor(t, actions.edit)))
    .when(!editing, (el) =>
      el.child(
        div()
          .id(`fc-text-${item.id}`)
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(12)
          .text_color(item.done ? t.dim : t.foreground)
          .when(item.done, (el) => el.line_through())
          .when(isTodo, (el) =>
            el.on_mouse_down("left", (event, cx) => {
              if (event.click_count === 2) actions.edit.start(item, cx);
            }),
          )
          .child(label),
      ),
    )
    .children([StandingChip(t, item)].filter(Boolean))
    .when(days > 0, (el) =>
      el.child(
        Chip(`${days}d`, {
          color: t.dim,
          id: `fc-days-${item.id}`,
          tooltip: `Added ${days === 1 ? "yesterday" : `${days} days ago`}, on ${item.added}`,
        }),
      ),
    )
    .when(Boolean(session), (el) => el.child(SessionButton(`fc-session-${item.id}`, session)))
    .when(Boolean(command), (el) =>
      el.child(
        IconButton(`fc-go-${item.id}`, ICONS.claude, () => actions.launch(item), {
          picture: true,
          tooltip: claudeTooltip(fillPrompt(command, item)),
          onMiddleClick: (cx) => actions.launch(item, { background: true, cx }),
        }),
      ),
    )
    .when(isTodo && !editing, (el) =>
      el.child(IconButton(`fc-edit-${item.id}`, ICONS.edit, (cx) => actions.edit.start(item, cx), { tooltip: "Edit" })),
    )
    .child(IconButton(`fc-remove-${item.id}`, ICONS.close, (cx) => actions.remove(item.id, cx), { tooltip: "Remove" }));
}

/**
 * The focus card. `actions`: `{ toggle(id, cx), remove(id, cx), launch(item, options?), command(kind), edit }`,
 * where `command` is the configured Claude command for that kind, or "" when none is set, and
 * `edit` is `{ id, input, start(item, cx), cancel(cx) }` for the todo being edited.
 * `input` is the todo field's InputState.
 */
export function FocusList(items, input, actions) {
  const t = theme();
  const open = items.filter((item) => !item.done).length;
  return Card(
    "focus",
    "Today",
    [Chip(`${open} open · ${items.length - open} done`, { color: t.dim })],
    v_flex()
      .gap(6)
      .child(
        Input.new(input)
          .h(32)
          .px(10)
          .rounded(8)
          .border_1()
          .border_color(t.input)
          .bg(t.background)
          .text_size(12)
          .text_color(t.foreground),
      )
      .when(!items.length, (el) => el.child(Note("Pin an issue or PR from the lists below, or type a todo.")))
      .children(
        SECTIONS.flatMap((section) => {
          const rows = items.filter((item) => item.kind === section.kind);
          return rows.length ? [SectionHeading(section.title, rows), ...rows.map((item) => FocusItem(item, actions))] : [];
        }),
      ),
  );
}
