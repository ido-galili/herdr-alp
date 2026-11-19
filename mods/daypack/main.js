// Daypack: what you carry through the day, in a column on the window's right edge beside the
// terminals, and the tab bar button that shows or hides it. It holds the Lineup items, each
// issue and PR with the Claude button Alpmeister shows. The layout places one copy of each:
// `props.button` draws the button. Both read the focus list Alpmeister keeps, and reload when
// either side changes it.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, layout, panes, props, readTextFile, run, setShared, shared, spaces, theme } from "herdr";
import { FocusFile } from "./focus-file.js";

const SIDEBAR_ID = "daypack";
const STAMP_KEY = "alp.focusStamp";
const DAYPACK_ICON = "mods/daypack/backpack.svg";
const CLAUDE_ICON = "icons/claude.svg";
const CLOSE_ICON = "mods/workspace-chrome/x.svg";
const SECTIONS = [
  { kind: "todo", title: "Todos" },
  { kind: "pr", title: "PRs" },
  { kind: "issue", title: "Issues" },
];

/** Opens a URL in the default browser. */
const openUrl = (url) => exec("open", [url]).catch((error) => console.log(`daypack: open failed: ${error}`));

/**
 * The `launch` settings Alpmeister reads from ~/.config/alp/alpmeister.json: the folder and the
 * Claude command for an issue and for a PR. Empty when the file or the section is missing.
 */
async function loadLaunch() {
  const text = await readTextFile(`${home()}/.config/alp/alpmeister.json`);
  try {
    const launch = text ? (JSON.parse(text).launch ?? {}) : {};
    const folder = launch.folder?.startsWith("~") ? home() + launch.folder.slice(1) : launch.folder;
    return { folder: folder?.replace(/\/+$/, "") ?? "", issue: launch.issue ?? "", pr: launch.pr ?? "" };
  } catch (error) {
    console.log(`daypack: settings unreadable, no Claude buttons: ${error}`);
    return { folder: "", issue: "", pr: "" };
  }
}

/** The layout node with this id, or null. */
function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export default class Daypack extends View {
  init(_props, cx) {
    this.store = new FocusFile();
    this.stamp = null;
    this.launchSettings = { folder: "", issue: "", pr: "" };
    this.reload(cx);
  }

  /**
   * Opens a Claude tab on an issue or PR in the space you are in. It starts in the live folder of
   * that space's first tab when it is the configured folder or inside it, such as a worktree, else
   * in the configured folder.
   */
  launch(kind, number) {
    const { folder: repo, issue, pr } = this.launchSettings;
    const space = spaces().find((candidate) => candidate.active);
    const firstTab = space?.tabs?.[0]?.id;
    const liveFolder = panes().find((pane) => pane.tab === firstTab && pane.cwd)?.cwd ?? space?.folder;
    const spaceFolder = liveFolder?.replace(/\/+$/, "");
    const inRepo = Boolean(repo && spaceFolder && (spaceFolder === repo || spaceFolder.startsWith(`${repo}/`)));
    const folder = inRepo ? spaceFolder : repo;
    run("tab.new", {
      name: kind === "pr" ? `PR #${number}` : `#${number}`,
      ...(space ? { space: space.id } : {}),
      ...(folder ? { folder } : {}),
      argv: ["claude"],
      task: (kind === "pr" ? pr : issue).replace("{number}", number),
    });
  }

  /** The Claude button for an issue or PR, when its command is set; null otherwise. */
  claudeButton(t, item) {
    const command =
      item.kind === "pr" ? this.launchSettings.pr : item.kind === "issue" ? this.launchSettings.issue : "";
    if (!command || item.number == null) return null;
    return h_flex()
      .id(`ds-go-${item.id}`)
      .flex_none()
      .size(22)
      .items_center()
      .justify_center()
      .rounded(5)
      .cursor_pointer()
      .hover((style) => style.bg(t.selected))
      .tooltip(`Open a Claude tab running ${command.replace("{number}", item.number)}`)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.launch(item.kind, item.number);
      })
      .child(image(CLAUDE_ICON).w(13).h(13));
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

  /**
   * The tab bar button: the backpack icon alone, in a 26px square like the bar's + button. The
   * icon takes the accent color while any item is open.
   */
  button(t, count) {
    const color = count > 0 ? t.accent : null;
    const open = !(findNode(layout(), SIDEBAR_ID)?.hidden ?? true);
    return h_flex()
      .size_full()
      .items_center()
      .pr(10)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("daypack-button")
          .size(26)
          .flex_none()
          .items_center()
          .justify_center()
          .rounded(6)
          .cursor_pointer()
          .text_color(color ?? (open ? t.foreground : t.muted))
          .bg(open ? t.selected : t.chrome)
          .hover((style) => style.bg(t.hover).text_color(color ?? t.foreground))
          .tooltip(open ? "Hide the Daypack" : "Show the Daypack")
          .on_click((_event, cx) => {
            cx.stop_propagation();
            run("layout.toggle", { id: SIDEBAR_ID });
          })
          .child(svg(DAYPACK_ICON).size(14).flex_none()),
      );
  }

  /** One item: its checkbox, its title, its number, and its Claude button. A click on the title opens it on GitHub. */
  row(t, item) {
    const label = item.kind === "todo" ? item.text : item.title;
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
          .child(label ?? ""),
      )
      .when(item.number != null, (el) => el.child(div().flex_none().text_color(t.dim).child(`#${item.number}`)))
      .children([this.claudeButton(t, item)].filter(Boolean));
  }

  render(cx) {
    const t = theme();
    if ((shared(STAMP_KEY) ?? null) !== this.stamp) this.reload(cx);
    const items = this.store.items();
    const count = items.filter((item) => !item.done).length;
    if (props()?.button) return this.button(t, count);
    return v_flex()
      .id("daypack")
      .size_full()
      .bg(t.chrome)
      .overflow_y_scrollbar()
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .px(12)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(svg(DAYPACK_ICON).size(13).flex_none().text_color(t.muted))
          .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child("Daypack"))
          .child(div().text_size(11).text_color(t.dim).child(`${count} open`))
          .child(
            h_flex()
              .id("daypack-close")
              .flex_none()
              .size(22)
              .items_center()
              .justify_center()
              .rounded(5)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((style) => style.bg(t.hover).text_color(t.foreground))
              .tooltip("Hide the Daypack")
              .on_click((_event, cx) => {
                cx.stop_propagation();
                run("layout.hide", { id: SIDEBAR_ID });
              })
              .child(svg(CLOSE_ICON).size(13)),
          ),
      )
      .child(
        v_flex()
          .py(6)
          .child(div().px(12).pt(6).text_size(10.5).font_semibold().text_color(t.dim).child("LINEUP"))
          .when(!items.length, (el) =>
            el.child(div().px(12).py(6).text_size(11.5).text_color(t.dim).child("Nothing in the Lineup.")),
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

  /** A section heading: the item type and how many of its items are still open. */
  heading(t, title, rows) {
    return h_flex()
      .px(12)
      .pt(8)
      .pb(2)
      .gap(6)
      .items_center()
      .text_size(11)
      .child(div().font_medium().text_color(t.muted).child(title))
      .child(
        div()
          .text_color(t.dim)
          .child(String(rows.filter((item) => !item.done).length)),
      );
  }
}
