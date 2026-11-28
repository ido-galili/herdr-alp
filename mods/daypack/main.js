// Daypack: the Today list, in Basecamp's Today tab on the window's right edge, and the only place
// it shows. It holds the issues and PRs you Pin to Today in Alp, each with the Claude button Alp
// shows (dashed while its prompt is not set), and the todos you type here. A key says what the
// icons do; the list can be narrowed to one repository or grouped by repository, both
// remembered. It reads and writes the focus list Alpmeister keeps
// (~/.local/state/alp/focus.json), and reloads when Alpmeister changes it. Basecamp's header (the
// `basecamp` mod) shows how many items are open.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Popup } from "gpui-base";
import { exec, home, notify, panes, readTextFile, run, setShared, shared, spaces, theme } from "herdr";
import { FocusFile, daysSinceAdded, today } from "./focus-file.js";

const STAMP_KEY = "alp.focusStamp";
/** Asks the pinned Alp to show Settings in place: keep in step with Alpmeister's main.js. */
const OPEN_SETTINGS_KEY = "alp.openSettings";
/** The Alp layout's work stack and the block Alp is pinned in. */
const WORK_STACK = "work-stack";
const ALPMEISTER_VIEW = "alpmeister-view";
const CLAUDE_ICON = "icons/claude.svg";
const TERMINAL_ICON = "mods/workspace-chrome/terminal.svg";
const PIN_ICON = "mods/workspace-chrome/pin.svg";
const CLOSE_ICON = "mods/workspace-chrome/x.svg";
const EDIT_ICON = "mods/alpmeister/pencil.svg";
const SETTINGS_ICON = "mods/workspace-chrome/settings.svg";
/** What this tab remembers, in its own storage: the key hidden, grouping, and the repo filter. */
const KEY_HIDDEN_KEY = "daypack.keyHidden";
const GROUP_KEY = "daypack.groupByRepo";
const FILTER_KEY = "daypack.repoFilter";
/** The repo filter's value for every item; "" is the todos without a repository. */
const ALL = null;
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
      folders: Object.fromEntries(
        Object.entries(account.folders ?? {}).map(([repo, path]) => [repo, expandHome(path)]),
      ),
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

/**
 * A repository's short name, as the list shows it: "website" for "alpine-co/website".
 * @param {string} repo `owner/name`.
 * @returns {string}
 */
const shortRepo = (repo) => repo.split("/")[1] ?? repo;

/**
 * A value this tab remembered, or the fallback.
 * @param {string} key The storage key.
 * @param {any} fallback What to use when nothing is remembered.
 * @returns {any} The value, parsed from JSON.
 */
function remembered(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text == null ? fallback : JSON.parse(text);
  } catch (error) {
    console.log(`daypack: no remembered ${key}: ${error}`);
    return fallback;
  }
}

/**
 * Remembers a value for this tab.
 * @param {string} key The storage key.
 * @param {any} value The value, stored as JSON.
 * @returns {void}
 */
function remember(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.log(`daypack: ${key} not remembered: ${error}`);
  }
}

/**
 * The mark a Claude button shows while its prompt is not set: a dashed outline in the Claude
 * mark's place, as Alp draws it.
 * @param {Record<string, string>} t The theme.
 * @returns {object}
 */
const dashedMark = (t) => div().flex_none().w(13).h(11).rounded(3).border_1().border_dashed().border_color(t.dim);

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
  /**
   * Starts empty, reads the focus file and the Claude prompts, and sets up the todo fields and
   * what this tab remembers.
   * @param {object} _props Unused.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  init(_props, cx) {
    this.store = new FocusFile();
    this.stamp = null;
    this.launchSettings = { issue: "", pr: "", folders: {} };
    this.keyHidden = remembered(KEY_HIDDEN_KEY, false) === true;
    this.grouped = remembered(GROUP_KEY, false) === true;
    const filter = remembered(FILTER_KEY, ALL);
    this.filter = typeof filter === "string" ? filter : ALL;
    this.menuOpen = false;
    this.input = InputState.new({ placeholder: "Add a todo and press Enter" });
    this.input.on("submit", (_event, cx) => this.addTodo(cx));
    this.editing = null;
    this.editInput = InputState.new({ placeholder: "The todo" });
    this.editInput.on("submit", (_event, cx) => this.saveEdit(cx));
    this.editInput.on("blur", (_event, cx) => this.saveEdit(cx));
    this.reload(cx);
  }

  /**
   * Opens a Claude tab on an issue or PR in the space you are in. It starts in the live folder of
   * that space's first tab when it is the repository's local clone or inside it, such as a
   * worktree, else in the clone, else in the space's own folder. A background tab opens without
   * taking focus, and a notification says so.
   * @param {object} item The issue or PR.
   * @param {{ background?: boolean, cx?: object }} [options] `cx`: the click's context, needed in the background.
   * @returns {void}
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
   * A 22px icon button, as Alp draws one: an icon only, its words in the tooltip, a Tab stop
   * (Enter or Space presses it).
   * @param {Record<string, string>} t The theme.
   * @param {string} id A unique element id.
   * @param {object} glyph The icon element.
   * @param {string} tooltip The tooltip.
   * @param {(cx: object) => void} onPress Called with the window context.
   * @param {{ color?: string, faded?: boolean, onMiddleClick?: (cx: object) => void }} [options]
   *   `color` tints the icon; `faded` draws a full-color icon a little faded until hovered.
   * @returns {object} The button.
   */
  iconButton(t, id, glyph, tooltip, onPress, { color, faded = false, onMiddleClick } = {}) {
    const press = (cx) => {
      cx.stop_propagation();
      onPress(cx);
    };
    const lit = (style) =>
      style
        .bg(t.hover)
        .text_color(color ?? t.foreground)
        .opacity(1);
    return h_flex()
      .id(id)
      .flex_none()
      .size(22)
      .items_center()
      .justify_center()
      .rounded(5)
      .text_color(color ?? t.dim)
      .cursor_pointer()
      .when(faded, (el) => el.opacity(0.65))
      .tab_index(0)
      .hover(lit)
      .focus(lit)
      .tooltip(tooltip)
      .on_click((_event, cx) => press(cx))
      .on_key_down((event, cx) => {
        if (event.key === "enter" || event.key === "space") press(cx);
      })
      .when(Boolean(onMiddleClick), (el) =>
        el.on_mouse_up("middle", (_event, cx) => {
          cx.stop_propagation();
          onMiddleClick(cx);
        }),
      )
      .child(glyph);
  }

  /**
   * The Claude button for an issue or PR, as Alp draws it: the Claude mark, a little faded at
   * rest; its tooltip says "Review" (a PR) or "Start" (an issue) and the prompt. With no prompt
   * set, the mark is dashed and a click shows Alp's Settings in place.
   * @param {Record<string, string>} t The theme.
   * @param {object} item The focus-list item.
   * @returns {object | null} The button, or null for a todo.
   */
  claudeButton(t, item) {
    if (item.kind === "todo" || item.number == null) return null;
    const command = item.kind === "pr" ? this.launchSettings.pr : this.launchSettings.issue;
    if (!command) {
      return this.iconButton(
        t,
        `ds-go-${item.id}`,
        dashedMark(t),
        `Set prompt: no Claude prompt for ${item.kind === "pr" ? "PRs" : "issues"} yet. Click to set it in Alp's Settings, under Claude buttons.`,
        () => openAlpSettings(),
      );
    }
    return this.iconButton(
      t,
      `ds-go-${item.id}`,
      image(CLAUDE_ICON).w(13).h(13),
      `${item.kind === "pr" ? "Review" : "Start"}: open a Claude tab running ${fillPrompt(command, item)}. Middle-click opens it in the background.`,
      () => this.launch(item),
      { faded: true, onMiddleClick: (cx) => this.launch(item, { background: true, cx }) },
    );
  }

  /**
   * A terminal icon in the color of the item's Claude tab status, when that tab is open. A click
   * shows the tab.
   * @param {Record<string, string>} t The theme.
   * @param {object} item The focus-list item.
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

  /**
   * Reads the focus list again, then redraws.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  reload(cx) {
    this.stamp = shared(STAMP_KEY) ?? null;
    cx.spawn(async (cx) => {
      await this.store.load();
      this.launchSettings = await loadLaunch();
      cx.notify();
    });
  }

  /**
   * Changes the list, saves it, and tells Alpmeister and Basecamp's count to reload. When the
   * file changed elsewhere since it was read, the change is made again on the new list.
   * @param {() => void} change Changes `this.store`; run again after a reload.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  change(change, cx) {
    change();
    cx.notify();
    cx.spawn(async (cx) => {
      if (!(await this.store.save())) {
        change();
        await this.store.save();
      }
      this.stamp = Date.now();
      setShared(STAMP_KEY, this.stamp);
      cx.notify();
    });
  }

  /**
   * Checks or unchecks an item.
   * @param {string} id The item's id.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  toggle(id, cx) {
    const done = !this.store.items().find((candidate) => candidate.id === id)?.done;
    this.change(() => this.store.update(id, { done }), cx);
  }

  /**
   * Adds the typed todo, dated today. While the list shows one repository, the todo belongs to
   * it, so it stays in view.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  addTodo(cx) {
    const text = this.input.value().trim();
    if (!text) return;
    const item = { id: `todo-${Date.now()}`, done: false, added: today(), kind: "todo", text };
    if (this.filter) item.repo = this.filter;
    this.input.set_value("");
    this.change(() => this.store.add(item), cx);
  }

  /**
   * Removes an item: unpins an issue or PR, or deletes a todo.
   * @param {string} id The item's id.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  remove(id, cx) {
    this.change(() => this.store.remove(id), cx);
  }

  /**
   * Opens a todo's text for editing, all of it selected.
   * @param {object} item The todo.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  startEdit(item, cx) {
    this.editing = item.id;
    this.editInput.set_value(item.text ?? "");
    this.editInput.set_selected_range({ start: 0, end: (item.text ?? "").length });
    this.editInput.focus();
    // The field mounts on the next frame; focus it again once it is there.
    this.focusTask = cx.timer.after(100, () => this.editInput.focus());
    cx.notify();
  }

  /**
   * Saves the edited todo's text. An empty text keeps the old one.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  saveEdit(cx) {
    const id = this.editing;
    if (!id) return;
    this.editing = null;
    const text = this.editInput.value().trim();
    const item = this.store.items().find((candidate) => candidate.id === id);
    if (!item || !text || text === item.text) {
      cx.notify();
      return;
    }
    this.change(() => this.store.update(id, { text }), cx);
  }

  /**
   * Closes the todo editor without saving.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  cancelEdit(cx) {
    this.editing = null;
    cx.notify();
  }

  /**
   * Hides or shows the key, and remembers it.
   * @param {boolean} hidden Whether to hide it.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  setKeyHidden(hidden, cx) {
    this.keyHidden = hidden;
    remember(KEY_HIDDEN_KEY, hidden);
    cx.notify();
  }

  /**
   * Turns grouping by repository on or off, and remembers it.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  toggleGrouped(cx) {
    this.grouped = !this.grouped;
    remember(GROUP_KEY, this.grouped);
    cx.notify();
  }

  /**
   * Shows one repository's items, the todos without one (""), or everything (null), and
   * remembers it.
   * @param {string | null} filter The repository, "" or null.
   * @param {object} cx The view's context.
   * @returns {void}
   */
  pickFilter(filter, cx) {
    this.filter = filter;
    this.menuOpen = false;
    remember(FILTER_KEY, filter);
    cx.notify();
  }

  /**
   * A small text button, as Alp's "Hide key".
   * @param {Record<string, string>} t The theme.
   * @param {string} id A unique element id.
   * @param {string} label The words.
   * @param {(cx: object) => void} onPress Called with the window context.
   * @param {string} [tooltip] A tooltip.
   * @returns {object} The button.
   */
  textButton(t, id, label, onPress, tooltip) {
    return h_flex()
      .id(id)
      .flex_none()
      .h(20)
      .px(6)
      .items_center()
      .rounded(5)
      .text_size(11.5)
      .text_color(t.accent)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onPress(cx);
      })
      .child(label);
  }

  /**
   * The key over the list: what the Claude mark and the pin do and, while a prompt is missing,
   * what the dashed mark means, with "set it in Settings", which shows Alp's Settings. "Hide key"
   * at its end.
   * @param {Record<string, string>} t The theme.
   * @returns {object} The key.
   */
  key(t) {
    const missing = !this.launchSettings.pr || !this.launchSettings.issue;
    const entry = (mark, ...words) => h_flex().flex_none().gap(6).items_center().child(mark).children(words);
    return h_flex()
      .id("daypack-key")
      .mx(12)
      .flex_wrap()
      .items_center()
      .gap_x(12)
      .gap_y(4)
      .px(10)
      .py(6)
      .rounded(8)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.muted)
      .child(div().font_semibold().text_color(t.dim).child("Key"))
      .child(entry(image(CLAUDE_ICON).w(13).h(13).flex_none(), "Review a PR or Start an issue in Claude"))
      .child(entry(svg(PIN_ICON).size(13).flex_none().text_color(t.accent), "Pinned from Alp: click to unpin"))
      .when(missing, (el) =>
        el.child(
          entry(
            dashedMark(t),
            "no prompt yet ·",
            h_flex()
              .id("daypack-key-settings")
              .gap(4)
              .items_center()
              .text_color(t.accent)
              .cursor_pointer()
              .hover((style) => style.text_color(t.foreground))
              .on_click((_event, cx) => {
                cx.stop_propagation();
                openAlpSettings();
              })
              .child(svg(SETTINGS_ICON).size(12).flex_none())
              .child("set it in Settings"),
          ),
        ),
      )
      .child(div().flex_1())
      .child(this.textButton(t, "daypack-key-hide", "Hide key", (cx) => this.setKeyHidden(true, cx)));
  }

  /**
   * The repositories the list holds, by short name: each with how many of its items are open.
   * @param {object[]} items Every item.
   * @returns {{ repo: string, open: number }[]}
   */
  repos(items) {
    const repos = [...new Set(items.map(repoOf).filter(Boolean))];
    if (this.filter && !repos.includes(this.filter)) repos.push(this.filter);
    return repos
      .sort((a, b) => shortRepo(a).localeCompare(shortRepo(b)))
      .map((repo) => ({ repo, open: items.filter((item) => repoOf(item) === repo && !item.done).length }));
  }

  /**
   * The repo filter: a button naming what shows ("All repos ▾"), and while open a list of All
   * repos, each repository on the list and Todos (the ones without a repository), each with its
   * open count.
   * @param {Record<string, string>} t The theme.
   * @param {object[]} items Every item.
   * @returns {object} The button, with its list while open.
   */
  filterMenu(t, items) {
    const open = (list) => list.filter((item) => !item.done).length;
    const rows = [
      { key: ALL, title: "All repos", count: open(items) },
      ...this.repos(items).map(({ repo, open }) => ({ key: repo, title: shortRepo(repo), sub: repo, count: open })),
      { key: "", title: "Todos", sub: "without a repo", count: open(items.filter((item) => !repoOf(item))) },
    ];
    const picked = rows.find((row) => row.key === this.filter)?.title ?? "All repos";
    const trigger = h_flex()
      .id("daypack-filter")
      .flex_none()
      .h(24)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(this.menuOpen ? t.accent : t.border)
      .bg(t.background)
      .cursor_pointer()
      .hover((style) => style.border_color(t.input))
      .when(!this.menuOpen, (el) => el.tooltip("Show one repo's items, or every item"))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.menuOpen = !this.menuOpen;
        cx.notify();
      })
      .text_size(12)
      .text_color(t.foreground)
      .child(div().font_medium().child(picked))
      .child(div().text_size(11.5).text_color(t.dim).child("▾"));
    if (!this.menuOpen) return trigger;
    const list = v_flex()
      .id("daypack-filter-list")
      .mt(28)
      .w(240)
      .p(4)
      .gap(1)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .shadow_lg()
      .on_mouse_down_out((_event, cx) => {
        this.menuOpen = false;
        cx.notify();
      })
      .children(
        rows.map((row, index) =>
          h_flex()
            .id(`daypack-filter-row-${index}`)
            .px(8)
            .py(4)
            .gap(8)
            .items_center()
            .rounded(5)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover))
            .when(row.key === this.filter, (el) => el.bg(t.selected))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              this.pickFilter(row.key, cx);
            })
            .child(
              v_flex()
                .flex_1()
                .min_w(0)
                .child(
                  div()
                    .text_size(12)
                    .font_medium()
                    .text_color(row.key === this.filter ? t.accent : t.foreground)
                    .child(row.title),
                )
                .when(Boolean(row.sub), (el) =>
                  el.child(div().truncate().text_size(11.5).text_color(t.dim).child(row.sub)),
                ),
            )
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${row.count} open`)),
        ),
      );
    return Popup.new("daypack-filter-popup", trigger).anchor("top_left").content(list);
  }

  /**
   * The controls over the list: the todo field, then the repo filter and "Group by repo".
   * @param {Record<string, string>} t The theme.
   * @param {object[]} items Every item.
   * @returns {object} The controls.
   */
  controls(t, items) {
    return v_flex()
      .px(12)
      .gap(6)
      .child(
        Input.new(this.input)
          .h(28)
          .px(8)
          .rounded(6)
          .border_1()
          .border_color(t.input)
          .bg(t.background)
          .text_size(12)
          .text_color(t.foreground),
      )
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(this.filterMenu(t, items))
          .child(
            h_flex()
              .id("daypack-group")
              .flex_none()
              .gap(5)
              .px(6)
              .h(24)
              .items_center()
              .rounded(5)
              .text_size(11.5)
              .text_color(this.grouped ? t.foreground : t.dim)
              .cursor_pointer()
              .hover((style) => style.bg(t.hover))
              .tooltip(
                this.grouped ? "Showing a group per repo; click for PRs, issues and todos" : "Show a group per repo",
              )
              .on_click((_event, cx) => {
                cx.stop_propagation();
                this.toggleGrouped(cx);
              })
              .child(
                div()
                  .size(8)
                  .rounded(4)
                  .border_1()
                  .border_color(this.grouped ? t.accent : t.input)
                  .bg(this.grouped ? t.accent : t.background),
              )
              .child("Group by repo"),
          ),
      );
  }

  /**
   * A todo's text being edited: Enter or a click away saves, Esc cancels.
   * @param {Record<string, string>} t The theme.
   * @returns {object} The field.
   */
  editor(t) {
    return div()
      .flex_1()
      .min_w(0)
      .on_key_down((event, cx) => {
        if (event.key !== "escape") return;
        cx.stop_propagation();
        this.cancelEdit(cx);
      })
      .child(
        Input.new(this.editInput)
          .h(22)
          .px(6)
          .rounded(5)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .text_size(12)
          .text_color(t.foreground),
      );
  }

  /**
   * One item: its checkbox, its title (a todo's opens for editing on a double-click), its number
   * ("website#12", or "#12" under its repository's heading), a PR's standing, how many days ago
   * it was added, its open Claude tab; then an issue's or PR's lit pin (unpins) and Claude button,
   * or a todo's edit and remove buttons. A click on an issue's or PR's title opens it on GitHub.
   * @param {Record<string, string>} t The theme.
   * @param {object} item The focus item.
   * @returns {object} The row.
   */
  row(t, item) {
    const isTodo = item.kind === "todo";
    const text = isTodo ? item.text : item.title;
    const editing = isTodo && this.editing === item.id;
    const days = daysSinceAdded(item);
    return h_flex()
      .id(`ls-${item.id}`)
      .w_full()
      .gap(6)
      .px(12)
      .py(3)
      .items_center()
      .text_size(12)
      .hover((style) => style.bg(t.hover))
      .child(
        h_flex()
          .id(`ls-check-${item.id}`)
          .flex_none()
          .size(14)
          .mr(2)
          .items_center()
          .justify_center()
          .rounded(4)
          .border_1()
          .cursor_pointer()
          .border_color(item.done ? t.accent : t.input)
          .bg(item.done ? t.accent : t.background)
          .tooltip(item.done ? "Done: click to open it again" : "Mark done")
          .on_click((_event, cx) => this.toggle(item.id, cx))
          .when(Boolean(item.done), (el) => el.child(div().text_size(10).text_color(t.background).child("✓"))),
      )
      .when(editing, (el) => el.child(this.editor(t)))
      .when(!editing, (el) =>
        el.child(
          div()
            .id(`ls-title-${item.id}`)
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(item.done ? t.dim : t.foreground)
            .when(Boolean(item.done), (el) => el.line_through())
            .when(Boolean(item.url), (el) => el.cursor_pointer().on_click(() => openUrl(item.url)))
            .when(isTodo, (el) =>
              el.on_mouse_down("left", (event, cx) => {
                if (event.click_count === 2) this.startEdit(item, cx);
              }),
            )
            .child(text ?? ""),
        ),
      )
      .when(item.number != null, (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .child(this.grouped || this.filter ? `#${item.number}` : label(item)),
        ),
      )
      .children([this.prStanding(t, item)].filter(Boolean))
      .when(days > 0, (el) =>
        el.child(
          div()
            .id(`ls-days-${item.id}`)
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .tooltip(`Added ${days === 1 ? "yesterday" : `${days} days ago`}, on ${item.added}`)
            .child(`${days}d`),
        ),
      )
      .children([this.sessionButton(t, item)].filter(Boolean))
      .when(!isTodo, (el) =>
        el
          .child(
            this.iconButton(
              t,
              `ls-unpin-${item.id}`,
              svg(PIN_ICON).size(13),
              "Unpin from Today",
              (cx) => this.remove(item.id, cx),
              {
                color: t.accent,
              },
            ),
          )
          .children([this.claudeButton(t, item)].filter(Boolean)),
      )
      .when(isTodo && !editing, (el) =>
        el.child(
          this.iconButton(t, `ls-edit-${item.id}`, svg(EDIT_ICON).size(13), "Edit", (cx) => this.startEdit(item, cx)),
        ),
      )
      .when(isTodo, (el) =>
        el.child(
          this.iconButton(t, `ls-remove-${item.id}`, svg(CLOSE_ICON).size(13), "Remove", (cx) =>
            this.remove(item.id, cx),
          ),
        ),
      );
  }

  /**
   * The items under their headings: by type (Todos, PRs, Issues), or with "Group by repo", the
   * todos without a repository under "Todos", then a group per repository.
   * @param {Record<string, string>} t The theme.
   * @param {object[]} items The items shown.
   * @returns {object[]} The headings and rows.
   */
  sections(t, items) {
    const byKind = (list) => SECTIONS.flatMap((section) => list.filter((item) => item.kind === section.kind));
    if (!this.grouped || this.filter) {
      return SECTIONS.flatMap((section) => {
        const rows = items.filter((item) => item.kind === section.kind);
        return rows.length ? [this.heading(t, section.title, rows), ...rows.map((item) => this.row(t, item))] : [];
      });
    }
    const loose = items.filter((item) => !repoOf(item));
    const groups = [
      ...(loose.length ? [{ title: "Todos", rows: loose }] : []),
      ...this.repos(items)
        .map(({ repo }) => ({
          title: shortRepo(repo),
          tooltip: repo,
          rows: byKind(items.filter((item) => repoOf(item) === repo)),
        }))
        .filter((group) => group.rows.length),
    ];
    return groups.flatMap((group) => [
      this.heading(t, group.title, group.rows, group.tooltip),
      ...group.rows.map((item) => this.row(t, item)),
    ]);
  }

  /**
   * The Today list: its heading and count, the key (until hidden), the todo field and the repo
   * controls, then the items, or what to do when there are none.
   * @param {object} cx The view's context.
   * @returns {object}
   */
  render(cx) {
    const t = theme();
    if ((shared(STAMP_KEY) ?? null) !== this.stamp) this.reload(cx);
    const items = this.store.items();
    const shown = this.filter === ALL ? items : items.filter((item) => repoOf(item) === this.filter);
    const open = items.filter((item) => !item.done).length;
    return v_flex()
      .id("daypack")
      .size_full()
      .bg(t.chrome)
      .overflow_y_scrollbar()
      .child(
        v_flex()
          .py(6)
          .gap(6)
          .child(
            h_flex()
              .px(12)
              .pt(4)
              .gap(6)
              .items_center()
              .text_size(11.5)
              .child(div().font_semibold().text_color(t.dim).child("Today"))
              .child(
                div()
                  .text_color(t.dim)
                  .child(`${open} open · ${items.length - open} done`),
              )
              .child(div().flex_1())
              .when(this.keyHidden, (el) =>
                el.child(
                  this.textButton(t, "daypack-key-show", "Key", (cx) => this.setKeyHidden(false, cx), "Show the key"),
                ),
              ),
          )
          .when(!this.keyHidden, (el) => el.child(this.key(t)))
          .child(this.controls(t, items))
          .child(
            v_flex()
              .when(!items.length, (el) =>
                el.child(
                  v_flex()
                    .px(12)
                    .py(6)
                    .gap(2)
                    .text_size(11.5)
                    .child(div().text_color(t.muted).child("Nothing for today yet."))
                    .child(div().text_color(t.dim).child("Type a todo above, or pin an issue or PR in Alp.")),
                ),
              )
              .when(Boolean(items.length) && !shown.length, (el) =>
                el.child(
                  div()
                    .px(12)
                    .py(6)
                    .text_size(11.5)
                    .text_color(t.muted)
                    .child(this.filter ? `Nothing for ${shortRepo(this.filter)} yet.` : "No todos without a repo."),
                ),
              )
              .children(this.sections(t, shown)),
          ),
      );
  }

  /**
   * A section heading: the item type or the repository, and how many of its items are still open.
   * @param {Record<string, string>} t The theme.
   * @param {string} title The section's title.
   * @param {object[]} rows The section's items.
   * @param {string} [tooltip] The repository's full name, for a repository's heading.
   * @returns {object} The heading row.
   */
  heading(t, title, rows, tooltip) {
    return h_flex()
      .id(`ls-heading-${title}`)
      .px(12)
      .pt(8)
      .pb(2)
      .gap(6)
      .items_center()
      .text_size(11.5)
      .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
      .child(div().font_medium().text_color(t.muted).child(title))
      .child(
        div()
          .text_color(t.dim)
          .child(String(rows.filter((item) => !item.done).length)),
      );
  }
}
