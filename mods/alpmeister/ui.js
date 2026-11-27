// The pieces every Alpmeister widget draws with, in Alp's look: the pane header's chips,
// the usage-limits bar with its time tick, and the agents list's status colors.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, notify, run, spaces, theme } from "herdr";

const DAY = 86400000;
const SESSION_STATUS_LABELS = { working: "working", blocked: "needs you", done: "done", idle: "idle" };

/** The Claude button's tooltip for a filled prompt. */
export const claudeTooltip = (prompt) =>
  `Open a Claude tab running ${prompt}. Middle-click opens it in the background.`;

/**
 * The tooltip of a Claude button whose prompt is not set.
 * @param {string} kind "pr" or "issue".
 * @returns {string}
 */
export const noPromptTooltip = (kind) =>
  `No Claude prompt for ${kind === "pr" ? "PRs" : "issues"} yet. Click to set it in Settings, under Claude buttons.`;

/** Opens a URL in the default browser. */
export const openUrl = (url) => exec("open", [url]).catch((error) => console.log(`alpmeister: open failed: ${error}`));

/**
 * A GitHub item's key, unique across repositories: "owner/name#12".
 * @param {{ repo?: string | null, number: number }} item An issue or PR.
 * @returns {string}
 */
export const itemKey = (item) => `${item.repo ?? ""}#${item.number}`;

/**
 * A repository's name without its owner.
 * @param {string | null | undefined} repo `owner/name`.
 * @returns {string}
 */
export const shortRepo = (repo) => repo?.split("/")[1] ?? "";

/**
 * A Claude prompt for an item: `{number}` and `{repo}` filled in.
 * @param {string} template The prompt from the settings.
 * @param {{ repo?: string | null, number: number }} item The issue or PR.
 * @returns {string}
 */
export const fillPrompt = (template, item) =>
  template
    .split("{number}")
    .join(String(item.number))
    .split("{repo}")
    .join(item.repo ?? "");

/**
 * A duration as its largest unit: "2y", "4mo", "3d", "5h", "12m".
 * @param {number} ms The duration in milliseconds.
 * @returns {string}
 */
export function ago(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 60) return `${Math.floor(days / 30)}mo`;
  if (minutes >= 1440) return `${days}d`;
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

/**
 * The warning color: orange, for cautions that are not errors (stale data, unsaved edits,
 * "Unassigned"). Yellow stays for working and red for "act now".
 * @param {object} t The theme.
 * @returns {string} The theme's `warning`, or orange when the theme has none.
 */
export function warningColor(t) {
  return t.warning ?? "#ffb86c";
}

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

/**
 * A chip as the pane header draws them: 20px, rounded, `hover` fill.
 * @param {string | object} text The chip's label, or an element.
 * @param {{ color?: string, fill?: string, tooltip?: string, id?: string }} [options] Its text color,
 *   fill, and a tooltip (shown only with an id).
 * @returns {object} The chip.
 */
export function Chip(text, { color, fill, tooltip, id } = {}) {
  const t = theme();
  const chip = h_flex()
    .flex_none()
    .px(6)
    .h(20)
    .items_center()
    .rounded(5)
    .bg(fill ?? t.hover)
    .text_size(11.5)
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

/**
 * A card holding one widget: a title row with optional extras, then the body.
 * @param {string} id The card's element id.
 * @param {string} title The card's title.
 * @param {object[] | null} extras Chips and buttons on the right of the title row.
 * @param {object} body The card's content.
 * @param {string} [note] A short dim clause after the title that says what the card lists.
 * @returns {object} The card.
 */
export function Card(id, title, extras, body, note) {
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
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .when(Boolean(note), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(note)))
        .child(div().flex_1())
        .children(extras ?? []),
    )
    .child(body);
}

/**
 * A small text button in the agents list's style.
 * @param {string} id A unique element id.
 * @param {string} label The label.
 * @param {Function} onClick Called with the window context.
 * @param {{ icon?: string, tooltip?: string }} [options] An icon before the label, and a tooltip.
 * @returns {object} The button.
 */
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
    .text_size(11.5)
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

/**
 * A link's words with its icon on their left, both in the link's color: the gear on a link that
 * opens Settings, the GitHub mark on one that opens GitHub.
 * @param {string | null} icon The icon's path, such as `ICONS.settings` or `ICONS.github`; null for none.
 * @param {string} text The link's words.
 * @param {number} [size] The icon's size: about the text's, 12 for 11.5-12px text.
 * @returns {object} The words and the icon, side by side.
 */
export function LinkLabel(icon, text, size = 12) {
  return h_flex()
    .flex_none()
    .gap(5)
    .items_center()
    .when(Boolean(icon), (el) => el.child(svg(icon).size(size).flex_none()))
    .child(text);
}

/** Icons this mod draws: its own, Herdr's shipped pin and close, and the Claude program icon. */
export const ICONS = {
  github: "mods/alpmeister/github.svg",
  zoomIn: "mods/alpmeister/zoom-in.svg",
  zoomOut: "mods/alpmeister/zoom-out.svg",
  fit: "mods/alpmeister/fit.svg",
  fullTab: "mods/alpmeister/full-tab.svg",
  exitFullTab: "mods/alpmeister/exit-full-tab.svg",
  resetLayout: "mods/alpmeister/reset-layout.svg",
  lineCurved: "mods/alpmeister/line-curved.svg",
  lineStep: "mods/alpmeister/line-step.svg",
  pin: "mods/workspace-chrome/pin.svg",
  close: "mods/workspace-chrome/x.svg",
  edit: "mods/alpmeister/pencil.svg",
  filter: "mods/alpmeister/filter.svg",
  claude: "icons/claude.svg",
  terminal: "mods/workspace-chrome/terminal.svg",
  iteration: "mods/alpmeister/iteration.svg",
  milestone: "mods/alpmeister/milestone.svg",
  settings: "mods/workspace-chrome/settings.svg",
};

/**
 * The mark Claude buttons show while their prompt is not set: the Claude mark's place, drawn as a
 * dashed outline.
 * @param {object} t The theme.
 * @returns {object} The mark.
 */
export function DashedMark(t) {
  return div().flex_none().w(13).h(11).rounded(3).border_1().border_dashed().border_color(t.dim);
}

/**
 * A 22px icon button with a tooltip. `color` tints a one-color icon; `picture` draws a
 * full-color icon as it is, such as a program's, a little faded until hovered or focused; `mark`
 * draws an element in place of the icon. `onMiddleClick`, when given, runs on a middle-button
 * release over the button.
 *
 * With a `label`, the button is a Tab stop (Enter or Space presses it). It stays an icon on hover
 * and focus: the label goes into the tooltip ("Review: Open a Claude tab…"), unless the tooltip
 * already starts with it ("Pin to Today").
 * @param {string} id A unique element id.
 * @param {string | null} icon The icon's path, or null with `mark`.
 * @param {(cx: object) => void} onClick Called with the window context.
 * @param {{ tooltip?: string, color?: string, picture?: boolean, mark?: object, label?: string,
 *   onMiddleClick?: (cx: object) => void }} [options]
 * @returns {object} The button.
 */
export function IconButton(id, icon, onClick, { tooltip, color, picture = false, mark, label, onMiddleClick } = {}) {
  const t = theme();
  const glyph = mark ?? (picture ? image(icon).w(13).h(13) : svg(icon).size(13));
  const press = (cx) => {
    cx.stop_propagation();
    onClick(cx);
  };
  const tip = label && !(tooltip ?? "").startsWith(label) ? (tooltip ? `${label}: ${tooltip}` : label) : tooltip;
  const lit = (style) => style.bg(t.hover).text_color(color ?? t.foreground).opacity(1);
  return h_flex()
    .id(id)
    .flex_none()
    .size(22)
    .items_center()
    .justify_center()
    .rounded(5)
    .text_color(color ?? t.dim)
    .cursor_pointer()
    .on_click((_event, cx) => press(cx))
    .when(Boolean(onMiddleClick), (el) =>
      el.on_mouse_up("middle", (_event, cx) => {
        cx.stop_propagation();
        onMiddleClick(cx);
      }),
    )
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(Boolean(label), (el) =>
      el
        .when(picture && !color, (el) => el.opacity(0.65))
        .tab_index(0)
        .focus(lit)
        .on_key_down((event, cx) => {
          if (event.key === "enter" || event.key === "space") press(cx);
        }),
    )
    .hover(lit)
    .child(glyph);
}

/** The name a Claude tab opened on an issue or PR carries: `repo#12`, or `PR repo#12`. */
export const sessionName = (item) => `${item.kind === "pr" ? "PR " : ""}${shortRepo(item.repo)}#${item.number}`;

/** The ids of a space's tabs named `name`. */
export function tabIdsNamed(spaceId, name) {
  const space = spaces().find((candidate) => candidate.id === spaceId);
  return (space?.tabs ?? []).filter((candidate) => candidate.name === name).map((candidate) => candidate.id);
}

/**
 * Tells the person a Claude tab opened in the background. A click on the notification shows the
 * tab. `spaces()` lists a new tab only a moment after `tab.new`, so this waits (up to 2s) for a
 * tab with the session name that is not in `before`, then posts the notification with it.
 * @param {{ kind: string, repo: string, number: number, title?: string }} item The issue or PR.
 * @param {string | undefined} spaceId The space the tab opened in.
 * @param {string[]} before The ids of that space's tabs with the session name, taken before `tab.new`.
 * @param {object} cx The event's context, to wait in.
 */
export function announceBackgroundTab(item, spaceId, before, cx) {
  const name = sessionName(item);
  const known = new Set(before);
  const newTab = () => tabIdsNamed(spaceId, name).find((id) => !known.has(id)) ?? null;
  cx.spawn(async (cx) => {
    let tabId = newTab();
    for (let tries = 0; !tabId && tries < 40; tries++) {
      await cx.sleep(50);
      tabId = newTab();
    }
    notify({
      title: `Claude tab ${name} opened in the background`,
      ...(item.title ? { body: item.title } : {}),
      level: "info",
      icon: "icons/claude.svg",
      ...(tabId ? { action: { name: "tab.select", args: { id: tabId } } } : {}),
    });
  });
}

/**
 * The open tab that carries an issue's or PR's session name, and its space.
 * @param {{ kind: string, repo?: string, number?: number }} item The focus item.
 * @returns {{ space: object, tab: object } | null} The first such tab, or null when none is open.
 */
export function sessionTab(item) {
  if (item.number == null || !item.repo) return null;
  const name = sessionName(item);
  for (const space of spaces()) {
    const tab = space.tabs.find((candidate) => candidate.named && candidate.name === name);
    if (tab) return { space, tab };
  }
  return null;
}

/**
 * A terminal icon in the color of a Claude tab's agent status. A click shows that tab.
 * @param {string} id A unique element id.
 * @param {{ space: object, tab: object }} session The tab and its space, from `sessionTab`.
 * @returns {object} The button.
 */
export function SessionButton(id, { space, tab }) {
  const t = theme();
  const colors = { working: t.working, blocked: t.blocked, done: t.done };
  const status = SESSION_STATUS_LABELS[tab.status] ?? "open";
  return h_flex()
    .id(id)
    .flex_none()
    .size(22)
    .items_center()
    .justify_center()
    .rounded(5)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .tooltip(`Claude tab ${tab.name} in ${space.name}: ${status}. Click to show it.`)
    .on_click((_event, cx) => {
      cx.stop_propagation();
      run("space.select", { id: space.id });
      run("tab.select", { id: tab.id });
    })
    .text_color(colors[tab.status] ?? t.dim)
    .child(svg(ICONS.terminal).size(13));
}

/**
 * A small switch of options side by side, the picked one highlighted, as the tab switch draws
 * its pills. An option shows its icon, its label, or both, and its tooltip on hover.
 * @param {string} id A unique element id.
 * @param {{ value: string, label?: string, icon?: string, tooltip?: string }[]} options
 * @param {string} value The picked option's value.
 * @param {(value: string, cx: object) => void} onPick
 * @returns {object}
 */
export function Segmented(id, options, value, onPick) {
  const t = theme();
  return h_flex()
    .id(id)
    .flex_none()
    .gap(2)
    .p(2)
    .rounded(7)
    .bg(t.canvas)
    .border_1()
    .border_color(t.border)
    .children(
      options.map((option) =>
        h_flex()
          .id(`${id}-${option.value}`)
          .h(20)
          .px(option.label ? 8 : 5)
          .gap(5)
          .items_center()
          .rounded(5)
          .text_size(11.5)
          .cursor_pointer()
          .bg(option.value === value ? t.selected : t.canvas)
          .text_color(option.value === value ? t.foreground : t.dim)
          .hover((style) => style.text_color(t.foreground))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            if (option.value !== value) onPick(option.value, cx);
          })
          .when(Boolean(option.tooltip), (el) => el.tooltip(option.tooltip))
          .when(Boolean(option.icon), (el) => el.child(svg(option.icon).size(13).flex_none()))
          .when(Boolean(option.label), (el) => el.child(option.label)),
      ),
    );
}

/**
 * A filter toggle: a checkbox-like dot and its label, in the accent color while on.
 * @param {string} id A unique element id.
 * @param {string} label The label.
 * @param {boolean} on Whether it is on.
 * @param {Function} onToggle Called with the window context.
 * @param {string} [tooltip] A tooltip.
 * @returns {object} The toggle.
 */
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
    .text_size(11.5)
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

/**
 * A clickable list row: the number, `lead` chips, the title, then chips and buttons on the right.
 * `repo` adds the repository's name before the title, for lists that span repositories.
 */
export function Row(id, { number, repo, lead = [], title, url, chips = [], buttons = [], dim = false }) {
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
    .when(Boolean(repo), (el) => el.child(Chip(shortRepo(repo), { color: t.dim, id: `${id}-repo`, tooltip: repo })))
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

/**
 * A group heading inside a card: a status name and its count.
 * @param {string} name The status name.
 * @param {number} count How many items it has.
 * @param {string} color The status color.
 * @returns {object} The heading.
 */
export function GroupHeading(name, count, color) {
  const t = theme();
  return h_flex()
    .pt(6)
    .gap(6)
    .items_center()
    .text_size(11.5)
    .child(div().size(7).rounded(4).bg(color))
    .child(div().font_medium().text_color(t.foreground).child(name))
    .child(div().text_color(t.dim).child(String(count)));
}

/**
 * Presses a focusable element's action on Enter or Space.
 * @param {(cx: object) => void} press The action.
 * @returns {(event: object, cx: object) => void} A key-down handler.
 */
export const pressOnKey = (press) => (event, cx) => {
  if (event.key !== "enter" && event.key !== "space") return;
  cx.stop_propagation();
  press(cx);
};


/**
 * The words a card's filter shows on hover, or on the Board's button: what it shows, and
 * whether it is saved for this card.
 * @param {string} summary The filter in words, such as "bugs only · open".
 * @param {boolean} saved Whether the settings hold a filter other than the default.
 * @returns {string} Such as "Filter: label support · saved for this card".
 */
export const filterTooltip = (summary, saved) => `Filter: ${summary}${saved ? " · saved for this card" : ""}`;

/**
 * The filter's way in on a card or a tile: a small funnel that opens the filter dialog, with an
 * accent dot when the saved filter isn't the default. Hovering shows the filter in words. It is a
 * Tab stop: Enter or Space opens the dialog too.
 * @param {string} id A unique element id.
 * @param {{ saved: boolean, tooltip: string, onOpen(cx: object): void }} options `saved`: the
 *   settings hold a filter other than the default.
 * @returns {object} The button, 22px square.
 */
export function FilterIcon(id, { saved, tooltip, onOpen }) {
  const t = theme();
  const open = (cx) => onOpen(cx);
  return div()
    .id(id)
    .relative()
    .flex_none()
    .size(22)
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .text_color(saved ? t.accent : t.dim)
    .cursor_pointer()
    .tab_index(0)
    .hover((style) => style.bg(t.hover).text_color(saved ? t.accent : t.foreground))
    .focus((style) => style.bg(t.hover).text_color(t.foreground))
    .tooltip(tooltip)
    .on_click((_event, cx) => {
      cx.stop_propagation();
      open(cx);
    })
    .on_key_down(pressOnKey(open))
    .child(svg(ICONS.filter).size(13))
    .when(saved, (el) => el.child(div().absolute().top(2).right(2).size(6).rounded(3).bg(t.accent)));
}

/**
 * The filter's way in where a header has room for words, as on the Board: "▾ Filter: <summary>",
 * quiet at the default and in the accent once saved. A click, Enter or Space opens the filter
 * dialog.
 * @param {string} id A unique element id.
 * @param {{ summary: string, saved: boolean, onOpen(cx: object): void, tooltip?: string }} options
 * @returns {object} The button.
 */
export function FilterButton(id, { summary, saved, onOpen, tooltip }) {
  const t = theme();
  const color = saved ? t.accent : t.muted;
  const open = (cx) => onOpen(cx);
  return h_flex()
    .id(id)
    .min_w(0)
    .max_w(360)
    .h(22)
    .px(8)
    .gap(6)
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(saved ? color : t.border)
    .text_size(11.5)
    .text_color(color)
    .cursor_pointer()
    .tab_index(0)
    .hover((style) => style.bg(t.hover))
    .focus((style) => style.bg(t.hover).border_color(t.accent))
    .tooltip(tooltip ?? "Change what this card shows")
    .on_click((_event, cx) => {
      cx.stop_propagation();
      open(cx);
    })
    .on_key_down(pressOnKey(open))
    .child(div().flex_none().child("▾"))
    .child(div().min_w(0).truncate().child(`Filter: ${summary}`));
}
