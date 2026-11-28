// The sidebar's brand row and footer: Herdr's workspace-chrome, with Alp's rail. The
// footer is Settings alone: Add machine is in the Spaces "+" menu (alp-spaces).
//
// Folded, the sidebar is a RAIL px wide rail. On macOS the traffic lights fill the brand
// row, so the rail puts the unfold button under them and grows the brand block to fit,
// with a line under it. Props: { footer } draws the footer instead; { block } the brand
// block's layout node id (default "brand"); { height } its unfolded px (default 46).

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

const RAIL = 60;
// The traffic lights' row, then the unfold button's 28px cell and its bottom padding.
const RAIL_BRAND = 40 + 28 + 8;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const lights = () => window()?.platform === "macos" && !window()?.fullscreen;

// To the rail, or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : RAIL });
}

export default class WorkspaceChrome extends View {
  // A resize run from the first render can be lost while the mod loads: render once more.
  init(_props, cx) {
    cx.timer.after(500, (cx) => cx.notify());
  }

  button(id, label, action) {
    const t = theme();
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) =>
        h_flex()
          .id(id)
          .h(28)
          .px(8)
          .gap(9)
          .items_center()
          .rounded(8)
          .when(collapsed, (el) => el.relative().w(32).px(0).justify_center().tooltip(label))
          .text_color(dim ? t.dim : t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .cursor_pointer()
          .on_click(action)
          .child(svg(`mods/alp-chrome/${icon}.svg`).size(14))
          .when(!collapsed, (el) => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex()
        .size_full()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .px(8)
        .pt(4)
        .pb(8)
        .text_size(13)
        .when(collapsed, (el) => el.px(0).items_center())
        .child(
          row("settings", "settings", "Settings", false, () => run("app.settings")).when(
            Boolean(updates().app.ready),
            (el) => el.child(collapsed ? ready.absolute().top(5).right(6) : ready),
          ),
        );
    }
    const block = props()?.block ?? "brand";
    const height = collapsed && lights() ? RAIL_BRAND : (props()?.height ?? 46);
    // Render re-runs when the layout changes (folding the sidebar): resize when the block
    // isn't the height it should be, so a resize lost to a reload is made again.
    if (find(layout(), block)?.size?.px !== height) run("layout.resize", { id: block, px: height });
    const toggle = this.button("sidebar-toggle", svg("mods/alp-chrome/sidebar.svg").size(15), toggleSidebar)
      .w(32)
      .h(28)
      .rounded(8)
      .tooltip(collapsed ? "Expand sidebar" : "Collapse sidebar");
    if (collapsed) {
      return v_flex()
        .size_full()
        .bg(t.chrome)
        .items_center()
        .justify_end()
        .pb(8)
        .when(lights(), (el) => el.border_b(1).border_color(t.border))
        .when(!lights(), (el) => el.justify_center().pb(0))
        .child(toggle);
    }
    return h_flex()
      .size_full()
      .bg(t.chrome)
      .pl(14)
      .pr(10)
      .gap(4)
      .items_center()
      .text_size(13.5)
      .when(lights(), (el) => el.pl(76))
      .child(
        h_flex()
          .flex_1()
          .gap(8)
          .items_center()
          .child(image("frame/welcome/herdr.png").size(20).rounded(5))
          .child(div().font_semibold().text_color(t.foreground).child("Herdr")),
      )
      .child(
        this.button("search", svg("mods/alp-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" })),
      )
      .child(toggle);
  }
}
