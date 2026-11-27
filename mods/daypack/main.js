// Daypack: what you carry through the day, in Basecamp's Daypack tab on the window's right edge.
// It holds today's trail, each issue and PR with the Claude button Alpmeister shows (dashed while
// its prompt is not set). It reads the
// focus list Alpmeister keeps, and reloads when Alpmeister changes it. Basecamp's header (the
// `basecamp` mod) shows how many items are open.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, notify, panes, readTextFile, run, setShared, shared, spaces, theme } from "herdr";
import { FocusFile } from "./focus-file.js";

const STAMP_KEY = "alp.focusStamp";
/** Asks the pinned Alp to show Settings in place: keep in step with Alpmeister's main.js. */
const OPEN_SETTINGS_KEY = "alp.openSettings";
/** The Alp layout's work stack and the block Alp is pinned in. */
const WORK_STACK = "work-stack";
const ALPMEISTER_VIEW = "alpmeister-view";
const CLAUDE_ICON = "icons/claude.svg";
const TERMINAL_ICON = "mods/workspace-chrome/terminal.svg";
const PR_STANDINGS = {
  MERGED: { text: "Merged", color: "done" },
  CLOSED: { text: "Closed", color: "dim" },
  APPROVED: { text: "Approved", color: "done" },
  CHANGES_REQUESTED: { text: "Changes", color: "blocked", tooltip: "A reviewer asked for changes" },
  REVIEW_REQUIRED: { text: "In Review", color: "muted" },
};
const SESSION_STATUS_LABELS = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
const SECTIONS = [
  { kind: "todo", title: "Todos" },
  { kind: "pr", title: "PRs" },
  { kind: "issue", title: "Issues" },
];

/** Opens a URL in the default browser. */
const openUrl = (url) => exec("open", [url]).catch((error) => console.log(`daypack: open failed: ${error}`));

/** The prompts Alpmeister uses when the settings name none: keep in step with its config.js. */
const DEFAULT_ISSUE_PROMPT = "Work on GitHub issue {repo}#{number}: read it, plan, then implement.";
const DEFAULT_PR_PROMPT = "Review GitHub PR {repo}#{number} and summarize what needs attention.";

/** A path with a leading `~` made absolute, without a trailing slash. */
const expandHome = (path) => (path?.startsWith("~") ? home() + path.slice(1) : (path ?? "")).replace(/\/+$/, "");

/**
 * The Claude button settings Alpmeister keeps in ~/.config/alp/alpmeister.json: the prompt for
 * an issue and for a PR, and each repository's local clone. Reads the current shape (`account`)
 * and the earlier one-repo shape (`repo` with `launch.folder`).
 * @returns {Promise<{ issue: string, pr: string, folders: Record<string, string> }>}
 */
async function loadLaunch() {
  const text = await readTextFile(`${home()}/.config/alp/alpmeister.json`);
  try {
    const raw = text ? JSON.parse(text) : {};
    if (raw.repo || raw.launch) {
      const launch = raw.launch ?? {};
      return {
        issue: launch.issue ?? DEFAULT_ISSUE_PROMPT,
        pr: launch.pr ?? DEFAULT_PR_PROMPT,
        folders: raw.repo && launch.folder ? { [raw.repo]: expandHome(launch.folder) } : {},
      };
    }
    const account = raw.account ?? {};
    return {
      issue: account.launch?.issue ?? DEFAULT_ISSUE_PROMPT,
      pr: account.launch?.pr ?? DEFAULT_PR_PROMPT,
      folders: Object.fromEntries(Object.entries(account.folders ?? {}).map(([repo, path]) => [repo, expandHome(path)])),
    };
  } catch (error) {
    console.log(`daypack: settings unreadable, no Claude buttons: ${error}`);
    return { issue: "", pr: "", folders: {} };
  }
}

/**
 * The repository of a GitHub item, from its field or, for an item pinned before workspaces,
 * its URL.
 * @param {{ repo?: string, url?: string }} item An item on the trail.
 * @returns {string} `owner/name`, or "".
 */
function repoOf(item) {
  if (item.repo) return item.repo;
  return /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\//.exec(item.url ?? "")?.[1] ?? "";
}

/**
 * A Claude prompt for an item: `{number}` and `{repo}` filled in.
 * @param {string} template The prompt.
 * @param {object} item The issue or PR.
 * @returns {string}
 */
const fillPrompt = (template, item) =>
  template.split("{number}").join(String(item.number)).split("{repo}").join(repoOf(item));

/** An item's number as the list shows it: "repo#12". */
const label = (item) => `${repoOf(item).split("/")[1] ?? ""}#${item.number}`;

/** The name Alpmeister's `sessionName` gives a Claude tab on an issue or PR: keep the two in step. */
const sessionName = (item) => (item.kind === "pr" ? `PR ${label(item)}` : label(item));

/** The open tab that carries an issue's or PR's session name, and its space, or null. */
function sessionTab(item) {
  if (item.kind === "todo" || item.number == null) return null;
  const name = sessionName(item);
  for (const space of spaces()) {
    const tab = space.tabs.find((candidate) => candidate.named && candidate.name === name);
    if (tab) return { space, tab };
  }
  return null;
}

/** The ids of a space's tabs named `name`. */
function tabIdsNamed(spaceId, name) {
  const space = spaces().find((candidate) => candidate.id === spaceId);
  return (space?.tabs ?? []).filter((candidate) => candidate.name === name).map((candidate) => candidate.id);
}

/**
 * Tells the person a Claude tab opened in the background, as Alpmeister's
 * `announceBackgroundTab` does: keep the two in step. A click on the notification shows the tab.
 * `spaces()` lists a new tab only a moment after `tab.new`, so this waits (up to 2s) for a tab
 * with the session name that is not in `before`.
 */
function announceBackgroundTab(item, spaceId, before, cx) {
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
      icon: CLAUDE_ICON,
      ...(tabId ? { action: { name: "tab.select", args: { id: tabId } } } : {}),
    });
  });
}

/**
 * Shows Alp in place of the terminals and asks it to show Settings there, as a Claude button
 * without a prompt does in Alp itself.
 * @returns {void}
 */
function openAlpSettings() {
  setShared(OPEN_SETTINGS_KEY, Date.now());
  run("layout.select", { stack: WORK_STACK, child: ALPMEISTER_VIEW });
}

export default class Daypack extends View {
  init(_props, cx) {
    this.store = new FocusFile();
    this.stamp = null;
    this.launchSettings = { issue: "", pr: "", folders: {} };
    this.reload(cx);
  }

  /**
   * Opens a Claude tab on an issue or PR in the space you are in. It starts in the live folder of
   * that space's first tab when it is the repository's local clone or inside it, such as a
   * worktree, else in the clone, else in the space's own folder. A background tab opens without
   * taking focus, and a notification says so.
   * @param {object} item The issue or PR.
   * @param {{ background?: boolean, cx?: object }} [options] `cx`: the click's context, needed in the background.
   */
  launch(item, { background = false, cx } = {}) {
    const { issue, pr, folders } = this.launchSettings;
    const repo = folders[repoOf(item)] ?? "";
    const space = spaces().find((candidate) => candidate.active);
    const firstTab = space?.tabs?.[0]?.id;
    const liveFolder = panes().find((pane) => pane.tab === firstTab && pane.cwd)?.cwd ?? space?.folder;
    const spaceFolder = liveFolder?.replace(/\/+$/, "");
    const inRepo = Boolean(repo && spaceFolder && (spaceFolder === repo || spaceFolder.startsWith(`${repo}/`)));
    const folder = inRepo ? spaceFolder : repo;
    const before = tabIdsNamed(space?.id, sessionName(item));
    run("tab.new", {
      name: sessionName(item),
      ...(space ? { space: space.id } : {}),
      ...(folder ? { folder } : {}),
      argv: ["claude"],
      task: fillPrompt(item.kind === "pr" ? pr : issue, item),
      focus: !background,
    });
    if (background) announceBackgroundTab(item, space?.id, before, cx);
  }

  /**
   * The Claude button for an issue or PR, as Alpmeister draws it: the Claude mark, a little faded
   * at rest, growing "Review" (a PR) or "Start" (an issue) on hover or Tab focus without moving
   * the row. With no prompt set, the mark is dashed and a click shows Alp's Settings in place.
   * @param {Record<string, string>} t The theme.
   * @param {object} item The focus-list item.
   * @returns {object | null} The button, or null for a todo.
   */
  claudeButton(t, item) {
    if (item.kind === "todo" || item.number == null) return null;
    const command = item.kind === "pr" ? this.launchSettings.pr : this.launchSettings.issue;
    const label = command ? (item.kind === "pr" ? "Review" : "Start") : "Set prompt";
    const press = (cx) => {
      cx.stop_propagation();
      if (command) this.launch(item);
      else openAlpSettings();
    };
    const open = (style) =>
      style
        .w(22 + 6 + Math.ceil(label.length * 6.8) + 2)
        .bg(t.border)
        .text_color(t.foreground)
        .opacity(1);
    const mark = command
      ? image(CLAUDE_ICON).w(13).h(13)
      : div().flex_none().w(13).h(11).rounded(3).border_1().border_dashed().border_color(t.dim);
    return div()
      .relative()
      .flex_none()
      .size(22)
      .child(
        h_flex()
          .id(`ds-go-${item.id}`)
          .absolute()
          .top(0)
          .right(0)
          .size(22)
          .items_center()
          .justify_end()
          .overflow_hidden()
          .rounded(5)
          .text_color(t.dim)
          .cursor_pointer()
          .when(Boolean(command), (el) => el.opacity(0.65))
          .tab_index(0)
          .hover(open)
          .focus(open)
          .tooltip(
            command
              ? `Open a Claude tab running ${fillPrompt(command, item)}. Middle-click opens it in the background.`
              : `No Claude prompt for ${item.kind === "pr" ? "PRs" : "issues"} yet. Click to set it in Alp's Settings, under Claude buttons.`,
          )
          .on_click((_event, cx) => press(cx))
          .on_key_down((event, cx) => {
            if (event.key === "enter" || event.key === "space") press(cx);
          })
          .when(Boolean(command), (el) =>
            el.on_mouse_up("middle", (_event, cx) => {
              cx.stop_propagation();
              this.launch(item, { background: true, cx });
            }),
          )
          .child(
            div()
              .absolute()
              .top(0)
              .right(22)
              .h(22)
              .pl(6)
              .flex()
              .items_center()
              .whitespace_nowrap()
              .text_size(11.5)
              .font_medium()
              .child(label),
          )
          .child(h_flex().flex_none().size(22).items_center().justify_center().child(mark)),
      );
  }

  /**
   * A terminal icon in the color of the item's Claude tab status, when that tab is open. A click
   * shows the tab.
   * @returns {object | null} The button, or null with no tab open.
   */
  sessionButton(t, item) {
    const session = sessionTab(item);
    if (!session) return null;
    const { space, tab } = session;
    const colors = { working: t.working, blocked: t.blocked, done: t.done };
    const status = SESSION_STATUS_LABELS[tab.status] ?? "open";
    return h_flex()
      .id(`ds-session-${item.id}`)
      .flex_none()
      .size(22)
      .items_center()
      .justify_center()
      .rounded(5)
      .cursor_pointer()
      .hover((style) => style.bg(t.selected))
      .tooltip(`Claude tab ${tab.name} in ${space.name}: ${status}. Click to show it.`)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        run("space.select", { id: space.id });
        run("tab.select", { id: tab.id });
      })
      .text_color(colors[tab.status] ?? t.dim)
      .child(svg(TERMINAL_ICON).size(13));
  }

  /**
   * Where a PR stands, as of Alpmeister's last refresh: Merged or Closed, else its review decision.
   * @param {Record<string, string>} t The theme.
   * @param {object} item The focus-list item.
   * @returns {object | null} The chip, or null for an issue, a todo, or a PR not yet read.
   */
  prStanding(t, item) {
    if (item.kind !== "pr") return null;
    const standing = PR_STANDINGS[item.state === "OPEN" ? item.review : (item.state ?? item.review)];
    if (!standing) return null;
    const chip = h_flex()
      .flex_none()
      .px(5)
      .h(18)
      .items_center()
      .rounded(4)
      .bg(t.hover)
      .text_size(11.5)
      .text_color(t[standing.color] ?? t.muted)
      .child(standing.text);
    return standing.tooltip ? chip.id(`ds-standing-${item.id}`).tooltip(standing.tooltip) : chip;
  }

  /** Reads the focus list again, then redraws. */
  reload(cx) {
    this.stamp = shared(STAMP_KEY) ?? null;
    cx.spawn(async (cx) => {
      await this.store.load();
      this.launchSettings = await loadLaunch();
      cx.notify();
    });
  }

  /** Checks or unchecks an item, saves it, and tells Alpmeister to reload. */
  toggle(id, cx) {
    const done = !this.store.items().find((candidate) => candidate.id === id)?.done;
    this.store.update(id, { done });
    cx.notify();
    cx.spawn(async (cx) => {
      if (!(await this.store.save())) {
        this.store.update(id, { done });
        await this.store.save();
      }
      this.stamp = Date.now();
      setShared(STAMP_KEY, this.stamp);
      cx.notify();
    });
  }

  /** One item: its checkbox, its title, its repository and number, a PR's standing, its open Claude tab, and its Claude button. A click on the title opens it on GitHub. */
  row(t, item) {
    const text = item.kind === "todo" ? item.text : item.title;
    return h_flex()
      .id(`ls-${item.id}`)
      .w_full()
      .gap(8)
      .px(12)
      .py(5)
      .items_center()
      .text_size(12)
      .hover((style) => style.bg(t.hover))
      .child(
        div()
          .id(`ls-check-${item.id}`)
          .flex_none()
          .size(14)
          .rounded(4)
          .border_1()
          .cursor_pointer()
          .border_color(item.done ? t.accent : t.input)
          .bg(item.done ? t.accent : t.background)
          .on_click((_event, cx) => this.toggle(item.id, cx)),
      )
      .child(
        div()
          .id(`ls-title-${item.id}`)
          .flex_1()
          .min_w(0)
          .truncate()
          .text_color(item.done ? t.dim : t.foreground)
          .when(Boolean(item.url), (el) => el.cursor_pointer().on_click(() => openUrl(item.url)))
          .child(text ?? ""),
      )
      .when(item.number != null, (el) => el.child(div().flex_none().text_color(t.dim).child(label(item))))
      .children([this.prStanding(t, item), this.sessionButton(t, item), this.claudeButton(t, item)].filter(Boolean));
  }

  /**
   * The Today list: its heading, then each section's items, or what to do when it is empty.
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    const t = theme();
    if ((shared(STAMP_KEY) ?? null) !== this.stamp) this.reload(cx);
    const items = this.store.items();
    return v_flex()
      .id("daypack")
      .size_full()
      .bg(t.chrome)
      .overflow_y_scrollbar()
      .child(
        v_flex()
          .py(6)
          .child(div().px(12).pt(6).text_size(11.5).font_semibold().text_color(t.dim).child("Today"))
          .when(!items.length, (el) =>
            el.child(
              v_flex()
                .px(12)
                .py(6)
                .gap(2)
                .text_size(11.5)
                .child(div().text_color(t.muted).child("Nothing pinned for today."))
                .child(div().text_color(t.dim).child("Pin an issue or PR from Alp.")),
            ),
          )
          .children(
            SECTIONS.flatMap((section) => {
              const rows = items.filter((item) => item.kind === section.kind);
              return rows.length
                ? [this.heading(t, section.title, rows), ...rows.map((item) => this.row(t, item))]
                : [];
            }),
          ),
      );
  }

  /**
   * A section heading: the item type and how many of its items are still open.
   * @param {Record<string, string>} t The theme.
   * @param {string} title The section's title.
   * @param {object[]} rows The section's items.
   * @returns {object} The heading row.
   */
  heading(t, title, rows) {
    return h_flex()
      .px(12)
      .pt(8)
      .pb(2)
      .gap(6)
      .items_center()
      .text_size(11.5)
      .child(div().font_medium().text_color(t.muted).child(title))
      .child(
        div()
          .text_color(t.dim)
          .child(String(rows.filter((item) => !item.done).length)),
      );
  }
}
