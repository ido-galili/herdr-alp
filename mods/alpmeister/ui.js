// The pieces every Alpmeister widget draws with, in Alp's look: the pane header's chips,
// the usage-limits bar with its time tick, and the agents list's status colors.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme } from "herdr";

const DAY = 86400000;

/** Opens a URL in the default browser. */
export const openUrl = (url) => exec("open", [url]).catch((error) => console.log(`alpmeister: open failed: ${error}`));

/** A duration as its largest unit: "3d", "5h", "12m". */
export function ago(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date as "Sun 22 Nov". The runtime has no locale data, so the names are spelled out here.
 * `utc` reads the date in UTC, for GitHub's midnight-UTC due dates.
 */
export function formatDate(time, { utc = false } = {}) {
  const date = new Date(time);
  const [weekday, day, month] = utc
    ? [date.getUTCDay(), date.getUTCDate(), date.getUTCMonth()]
    : [date.getDay(), date.getDate(), date.getMonth()];
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month]}`;
}

/** A time of day in local time, as "06:05". */
export function formatTime(time) {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Whole days from now until `time`, never below zero. */
export const daysUntil = (time) => Math.max(0, Math.ceil((time - Date.now()) / DAY));

/** The theme color for a board status, matching the agents list: working, review, done. */
export function statusColor(t, status) {
  if (!status) return t.dim;
  if (/done|closed/i.test(status)) return t.done;
  if (/review/i.test(status)) return t.accent;
  if (/qa|test/i.test(status)) return t.ansi5 ?? t.accent;
  if (/develop|progress/i.test(status)) return t.working;
  if (/design/i.test(status)) return t.ansi4 ?? t.working;
  if (/hold|block/i.test(status)) return t.blocked;
  return t.muted;
}

/** The theme color for an issue type: defects in `blocked`, feature work in the accent colors. */
export function typeColor(t, type) {
  if (/bug|security/i.test(type ?? "")) return t.blocked;
  if (/epic/i.test(type ?? "")) return t.ansi5 ?? t.accent;
  if (/story|feature/i.test(type ?? "")) return t.accent;
  if (/improvement/i.test(type ?? "")) return t.done;
  return t.muted;
}

/** A chip as the pane header draws them: 18px, rounded, `hover` fill. */
export function Chip(text, { color, fill, tooltip, id } = {}) {
  const t = theme();
  const chip = h_flex()
    .flex_none()
    .px(6)
    .h(18)
    .items_center()
    .rounded(5)
    .bg(fill ?? t.hover)
    .text_size(10.5)
    .text_color(color ?? t.muted)
    .child(text);
  return tooltip && id ? chip.id(id).tooltip(tooltip) : chip;
}

/** The `Needs you` chip, as the pane header shows a blocked agent. */
export const NeedsYou = (text = "Needs you") => {
  const t = theme();
  return Chip(text, { color: t.blocked, fill: `${t.blocked}26` });
};

/** A filled bar with an optional tick, as usage-limits draws it. `fraction` and `tick` are 0..1. */
export function Bar(fraction, color, tick = null, height = 8) {
  const t = theme();
  const percent = (value) => `${Math.max(0, Math.min(1, value)) * 100}%`;
  return div()
    .relative()
    .w_full()
    .h(height)
    .child(
      div()
        .w_full()
        .h(height)
        .rounded(height / 2)
        .bg(t.border)
        .overflow_hidden()
        .child(
          div()
            .h(height)
            .w(percent(fraction))
            .rounded(height / 2)
            .bg(color),
        ),
    )
    .when(tick != null, (el) =>
      el.child(
        div()
          .absolute()
          .top(-2)
          .left(percent(tick))
          .w(2)
          .h(height + 4)
          .rounded(1)
          .bg(t.foreground),
      ),
    );
}

/** A card holding one widget: a title row with optional extras, then the body. */
export function Card(id, title, extras, body) {
  const t = theme();
  return v_flex()
    .id(id)
    .min_w(0)
    .p(14)
    .gap(10)
    .rounded(10)
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .child(div().flex_1())
        .children(extras ?? []),
    )
    .child(body);
}

/** A small text button in the agents list's style. */
export function TextButton(id, label, onClick, { icon, tooltip } = {}) {
  const t = theme();
  const button = h_flex()
    .id(id)
    .flex_none()
    .gap(4)
    .px(6)
    .h(20)
    .items_center()
    .rounded(5)
    .text_size(10.5)
    .text_color(t.dim)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .when(Boolean(icon), (el) => el.child(svg(icon).size(11).flex_none()))
    .child(label);
  return tooltip ? button.tooltip(tooltip) : button;
}

/** Icons this mod draws: its own, Herdr's shipped pin and close, and the Claude program icon. */
export const ICONS = {
  github: "mods/alpmeister/github.svg",
  pin: "mods/workspace-chrome/pin.svg",
  close: "mods/workspace-chrome/x.svg",
  claude: "icons/claude.svg",
};

/**
 * A 22px icon button with a tooltip. `color` tints a one-color icon; `picture` draws a
 * full-color icon as it is, such as a program's.
 */
export function IconButton(id, icon, onClick, { tooltip, color, picture = false } = {}) {
  const t = theme();
  return h_flex()
    .id(id)
    .flex_none()
    .size(22)
    .items_center()
    .justify_center()
    .rounded(5)
    .text_color(color ?? t.dim)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).text_color(color ?? t.foreground))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
    .child(picture ? image(icon).w(13).h(13) : svg(icon).size(13));
}

/** A filter toggle: a checkbox-like dot and its label, in the accent color while on. */
export function Toggle(id, label, on, onToggle, tooltip) {
  const t = theme();
  return h_flex()
    .id(id)
    .flex_none()
    .gap(5)
    .px(6)
    .h(20)
    .items_center()
    .rounded(5)
    .text_size(10.5)
    .text_color(on ? t.foreground : t.dim)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onToggle(cx);
    })
    .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
    .child(
      div()
        .size(8)
        .rounded(4)
        .border_1()
        .border_color(on ? t.accent : t.input)
        .bg(on ? t.accent : t.background),
    )
    .child(label);
}

/** A clickable list row: the number, `lead` chips, the title, then chips and buttons on the right. */
export function Row(id, { number, lead = [], title, url, chips = [], buttons = [], dim = false }) {
  const t = theme();
  return h_flex()
    .id(id)
    .w_full()
    .min_w(0)
    .gap(8)
    .px(6)
    .py(4)
    .items_center()
    .rounded(6)
    .text_size(12)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click(() => url && openUrl(url))
    .when(number != null, (el) => el.child(div().flex_none().w(44).text_color(t.dim).child(`#${number}`)))
    .children(lead)
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_color(dim ? t.dim : t.foreground)
        .child(title),
    )
    .children(chips)
    .children(buttons);
}

/** A muted line for empty lists and errors. */
export const Note = (text, color) =>
  div()
    .text_size(11.5)
    .text_color(color ?? theme().dim)
    .child(text);

/** A group heading inside a card: a status name and its count. */
export function GroupHeading(name, count, color) {
  const t = theme();
  return h_flex()
    .pt(6)
    .gap(6)
    .items_center()
    .text_size(11)
    .child(div().size(7).rounded(4).bg(color))
    .child(div().font_medium().text_color(t.foreground).child(name))
    .child(div().text_color(t.dim).child(String(count)));
}
