// The Board tab's own state: the filter field, applied and saved from the tab, the people
// picked in each workspace, remembered in localStorage for this copy, a card being dragged to
// another status, and the card menu that sets the iteration or the milestone. A move shows at
// once, and goes back with an error when GitHub refuses it.

import { InputState } from "gpui-base";
import { openMilestones, setIteration, setMilestone, setPosition, setStatus } from "./board-actions.js";
import { CARD_GAP, COLUMN_PADDING } from "./board-view.js";
import { CardMenu } from "./board-menu.js";
import { loadConfig } from "./config.js";
import { loadBoardView } from "./data.js";
import { saveSettings } from "./settings-data.js";
import { demoMilestones } from "./demo-data.js";

const PICKED_KEY = "alpmeister.boardPeople";
/** A press that moves less than this is a click (open the card), not a drag. */
const DRAG_SLOP = 5;
/** A card's height before it has been measured. */
const CARD_HEIGHT = 90;

export class BoardState {
  /**
   * @param {object} view The Alpmeister view: its config, model, cache and settings.
   */
  constructor(view) {
    this.view = view;
    this.input = InputState.new({ placeholder: "The board's filter, such as type:Bug iteration:@current" });
    this.input.on("submit", (_event, cx) => this.apply(cx));
    /** The workspace and saved filter the field last showed, so typing is never overwritten. */
    this.shownKey = null;
    this.busy = false;
    this.error = null;
    this.pickedByWorkspace = {};
    /**
     * The card being dragged, or null: `{ item, start, moved, over, grab, size, pointer }`. `grab` is
     * where the card was pressed inside it, `size` its width and height, and `pointer` where the
     * pointer is over the columns.
     */
    this.drag = null;
    /** The card whose menu is open, by board item id, or null. */
    this.menuFor = null;
    /** The open submenu of the card menu: "iteration", "milestone" or null. */
    this.submenu = null;
    /** A press outside the main menu waits a frame to learn whether it was in the submenu. */
    this.closePending = false;
    /** Each repository's open milestones: `{ list }`, `{ loading: true }` or `{ error }`. */
    this.milestones = {};
    /** Each card's drawn height, by board item id, and a column header's, for finding the drop spot. */
    this.cardHeights = new Map();
    this.headerHeight = 22;
    /**
     * How many measured units make one layout unit. Positions and sizes that events and size
     * changes report are in measured units; widths and offsets given to elements are in layout
     * units. A probe of a known width keeps this current.
     */
    this.unit = 1;
    /** The board item ids with a write under way. */
    this.writing = new Set();
    this.writeError = null;
    try {
      this.pickedByWorkspace = JSON.parse(localStorage.getItem(PICKED_KEY) ?? "{}") ?? {};
    } catch (error) {
      console.log(`alpmeister: picked people not read: ${error}`);
    }
  }

  /**
   * The workspace the Board shows: the shown one when it has a board, else the first with one.
   * @returns {{ boards: object[], ws: object | null }}
   */
  workspace() {
    const boards = (this.view.config?.workspaces ?? []).filter((ws) => ws.board);
    const shown = this.view.shownWorkspace();
    return { boards, ws: shown?.board ? shown : (boards[0] ?? null) };
  }

  /**
   * The Board options this state answers: the filter field, the picked people, the drag, the
   * card menu and the writes under way.
   * @param {object} ws The workspace the Board shows.
   * @returns {object} Options for `Board`.
   */
  options(ws) {
    return {
      filterInput: this.input,
      filterBusy: this.busy,
      filterError: this.error,
      onFilterRevert: (cx) => this.revert(cx),
      picked: this.picked(ws),
      onTogglePerson: (login, cx) => this.togglePerson(ws, login, cx),
      onClearPeople: (cx) => this.clearPeople(ws, cx),
      draggedId: this.drag?.moved ? this.drag.item.itemId : null,
      dragOver: this.drag?.over ?? null,
      writing: this.writing,
      writeError: this.writeError,
      menuFor: this.menuFor,
      isClick: () => this.isClick(),
      onCardDown: (item, event) => this.dragStart(item, event),
      onDragMove: (event, column, cardWidth, columnItems, cx) => this.dragMove(event, column, cardWidth, columnItems, cx),
      dropIndex: this.drag?.moved ? (this.drag.index ?? null) : null,
      onCardSize: (itemId, height) => this.measureCard(itemId, height),
      onHeaderSize: (height) => this.measureHeader(height),
      onUnitProbe: (measured, width) => this.measureUnit(measured, width),
      ghost: this.ghost(),
      onDrop: (cx) => this.drop(ws, cx),
      onDragEnd: (cx) => this.dragEnd(cx),
      onCardMenu: (item, cx) => this.openMenu(item, cx),
      cardMenu: (item, flip) =>
        CardMenu(item, {
          flip,
          meta: this.meta(ws),
          milestones: this.milestones[item.repo],
          submenu: this.submenu,
          onSubmenu: (name, cx) => {
            if (this.submenu === name) return;
            this.submenu = name;
            cx.notify();
          },
          onIteration: (iteration, cx) => this.pickIteration(ws, item, iteration, cx),
          onMilestone: (milestone, cx) => this.pickMilestone(item, milestone, cx),
          onClose: (cx) => this.closeMenu(cx),
          onOutside: (cx) => this.pressOutsideMenu(cx),
          onInside: () => this.pressInsideMenu(),
        }),
    };
  }

  /** Shows the workspace's saved filter in the field when the workspace or its filter changed. */
  sync(ws) {
    const key = `${ws.name}\n${ws.boardView.query}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.input.set_value(ws.boardView.query);
  }

  /** Puts the saved filter back in the field. */
  revert(cx) {
    const { ws } = this.workspace();
    if (ws) this.input.set_value(ws.boardView.query);
    this.error = null;
    cx.notify();
  }

  /**
   * Fetches the board with the typed filter, then saves the filter to the settings file. A filter
   * GitHub refuses stays in the field with the error, and the file keeps the old one.
   */
  apply(cx) {
    const { ws } = this.workspace();
    if (!ws || this.busy) return;
    const query = this.input.value().trim();
    if (this.view.demo) {
      // The demo has no board on GitHub to filter: the field keeps what was typed.
      this.error = "The demo board does not filter.";
      cx.notify();
      return;
    }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { config, error, text } = await loadConfig();
        if (!config) throw new Error(error ?? "The settings file could not be read.");
        const target = config.workspaces.find((candidate) => candidate.name === ws.name);
        if (!target?.board) throw new Error(`The workspace ${ws.name} has no board in the settings file.`);
        target.boardView.query = query;
        const boardView = await loadBoardView(target);
        const written = query === ws.boardView.query ? text : await saveSettings(config, text);
        this.view.settingsSaved(config, written);
        this.shownKey = `${ws.name}\n${query}`;
        const model = this.view.model;
        if (model?.workspaces?.[ws.name]) {
          const { boardView: _failed, ...errors } = model.workspaces[ws.name].errors ?? {};
          model.workspaces[ws.name] = { ...model.workspaces[ws.name], boardView, errors };
          await this.view.saveCache(model);
        }
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      this.busy = false;
      cx.notify();
    });
  }

  /** The people picked in a workspace. */
  picked(ws) {
    return new Set(this.pickedByWorkspace[ws.name] ?? []);
  }

  /** Picks or unpicks one person in a workspace. */
  togglePerson(ws, login, cx) {
    const picked = this.picked(ws);
    if (picked.has(login)) picked.delete(login);
    else picked.add(login);
    this.savePicked(ws, picked, cx);
  }

  /** Unpicks everyone in a workspace. */
  clearPeople(ws, cx) {
    this.savePicked(ws, new Set(), cx);
  }

  /** Keeps a workspace's picked people for this copy, then redraws. */
  savePicked(ws, picked, cx) {
    this.pickedByWorkspace = { ...this.pickedByWorkspace, [ws.name]: [...picked] };
    if (this.view.demo) return cx.notify();
    try {
      localStorage.setItem(PICKED_KEY, JSON.stringify(this.pickedByWorkspace));
    } catch (error) {
      console.log(`alpmeister: picked people not remembered: ${error}`);
    }
    cx.notify();
  }

  //#region Moves

  /** The board load's ids for a workspace, or null before a load that read them. */
  meta(ws) {
    return this.view.model?.workspaces?.[ws.name]?.boardView?.meta ?? null;
  }

  /**
   * Applies a change on the board at once, then writes it to GitHub. A refused write takes the
   * change back and shows the error.
   * @param {object} item The board item the write is about.
   * @param {{ apply(): void, revert(): void }} change What the board shows before GitHub answers.
   * @param {() => Promise<void>} write The GitHub write.
   * @param {object} cx The view's context.
   */
  write(item, change, write, cx) {
    change.apply();
    // The demo board is made up: the change shows, and nothing is written.
    if (this.view.demo) return cx.notify();
    this.writing.add(item.itemId);
    this.writeError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await write();
        await this.view.saveCache(this.view.model);
      } catch (error) {
        change.revert();
        this.writeError = `${item.title}: ${error?.message ?? error}`;
      }
      this.writing.delete(item.itemId);
      cx.notify();
    });
  }

  /**
   * A change to some of an item's fields, and its way back.
   * @param {object} item The board item, as the model holds it.
   * @param {object} fields The fields and their new values.
   * @returns {{ apply(): void, revert(): void }}
   */
  fieldChange(item, fields) {
    const before = Object.fromEntries(Object.keys(fields).map((key) => [key, item[key]]));
    return { apply: () => Object.assign(item, fields), revert: () => Object.assign(item, before) };
  }

  /** Keeps a card's drawn height, for finding the drop spot. */
  measureCard(itemId, height) {
    this.cardHeights.set(itemId, height);
  }

  /** Keeps a column header's drawn height, for finding the drop spot. */
  measureHeader(height) {
    this.headerHeight = height;
  }

  /**
   * Where in a column a card dropped at a height lands: before the first card whose middle is
   * below the pointer, else last.
   * @param {number} y The pointer's height in the columns.
   * @param {object[]} items The column's cards, without the dragged one.
   * @returns {number} The index it lands at.
   */
  indexAt(y, items) {
    let top = COLUMN_PADDING + this.headerHeight + CARD_GAP;
    for (const [index, item] of items.entries()) {
      const height = this.cardHeights.get(item.itemId) ?? CARD_HEIGHT;
      if (y < top + height / 2) return index;
      top += height + CARD_GAP;
    }
    return items.length;
  }

  /** Starts a possible drag on a press on a card. It becomes a drag once the pointer moves. */
  dragStart(item, event) {
    if (!item.itemId) {
      this.drag = null;
      return;
    }
    this.drag = {
      item,
      start: event.position,
      moved: false,
      over: null,
      grab: event.local_position ?? { x: 0, y: 0 },
      size: event.bounds ? { width: event.bounds.width, height: event.bounds.height } : { width: 220, height: 80 },
      pointer: null,
    };
  }

  /**
   * Follows the pointer over the columns: past the slop, the press is a drag, the dragged card is
   * drawn under the pointer, and the column the pointer is over is the one it would land in.
   * @param {{ position: object, local_position: object }} event The move, with the pointer in the columns.
   * @param {string} column The column under the pointer.
   * @param {number} cardWidth A card's width over the columns, in measured units.
   * @param {object[]} columnItems The column's shown cards, without the dragged one.
   */
  dragMove(event, column, cardWidth, columnItems, cx) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.position.x - drag.start.x, event.position.y - drag.start.y) < DRAG_SLOP) return;
    drag.moved = true;
    drag.pointer = event.local_position;
    drag.over = column;
    drag.overItems = columnItems;
    drag.index = this.indexAt(event.local_position.y, columnItems);
    drag.cardWidth = cardWidth;
    cx.notify();
  }

  /**
   * Where the dragged card is drawn over the columns, and its size there, in layout units, or
   * null when nothing is dragged. The pointer keeps the spot on the card where it was pressed.
   * The width is a column's card width and the height the card's drawn height, so the floating
   * card and the slot it would land in match the card.
   */
  ghost() {
    const drag = this.drag;
    if (!drag?.moved || !drag.pointer) return null;
    const unit = this.unit;
    return {
      item: drag.item,
      x: (drag.pointer.x - drag.grab.x) / unit,
      y: (drag.pointer.y - drag.grab.y) / unit,
      width: (drag.cardWidth ?? drag.size.width) / unit,
      height: (this.cardHeights.get(drag.item.itemId) ?? drag.size.height) / unit,
    };
  }

  /** Keeps the measured width of the layout probe, which is `width` layout units wide. */
  measureUnit(measured, width) {
    if (measured > 0) this.unit = measured / width;
  }

  /** Whether a release on a card is a click, not the end of a drag. */
  isClick() {
    return !this.drag?.moved;
  }

  /** Drops a dragged card on the column under the pointer: it moves to that status. */
  drop(ws, cx) {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.moved || !drag.over) return;
    cx.notify();
    const { item, over: column, overItems, index } = drag;
    const after = index > 0 ? overItems[index - 1] : null;
    const before = overItems[index] ?? null;
    const items = this.view.model?.workspaces?.[ws.name]?.boardView?.items;
    if (!items) return;
    const sameStatus = item.status === column;
    const at = items.indexOf(item);
    if (sameStatus && (after ? items.indexOf(after) === at - 1 : before ? items.indexOf(before) === at + 1 : true)) return;
    const meta = this.meta(ws);
    if (!meta) {
      this.writeError = "Refresh to load the board's ids before moving a card.";
      return;
    }
    const order = items.slice();
    const status = this.fieldChange(item, { status: column });
    const change = {
      apply: () => {
        status.apply();
        items.splice(items.indexOf(item), 1);
        const place = after ? items.indexOf(after) + 1 : before ? items.indexOf(before) : 0;
        items.splice(place, 0, item);
      },
      revert: () => {
        status.revert();
        items.splice(0, items.length, ...order);
      },
    };
    this.write(
      item,
      change,
      async () => {
        if (!sameStatus) await setStatus(meta, item, column);
        await setPosition(meta, item, after);
      },
      cx,
    );
  }

  /** Ends a drag that was not dropped on a column. */
  dragEnd(cx) {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) cx.notify();
  }

  /** Opens a card's menu, and reads its repository's milestones the first time. */
  openMenu(item, cx) {
    if (!item.itemId) {
      this.writeError = "Refresh to load the board's ids before changing a card.";
      cx.notify();
      return;
    }
    this.menuFor = item.itemId;
    this.submenu = null;
    const repo = item.repo;
    if (this.view.demo && repo) this.milestones[repo] = { list: demoMilestones(repo) };
    if (item.kind !== "draft" && repo && !this.milestones[repo]) {
      this.milestones[repo] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          this.milestones[repo] = { list: await openMilestones(repo) };
        } catch (error) {
          this.milestones[repo] = { error: String(error?.message ?? error) };
        }
        cx.notify();
      });
    }
    cx.notify();
  }

  /**
   * A press outside the main menu: it closes the menu, unless the same press lands in the
   * submenu beside it. The submenu's own press comes after this one, so the close waits a frame.
   */
  pressOutsideMenu(cx) {
    this.closePending = true;
    cx.timer.after(16, () => {
      if (!this.closePending) return;
      this.closePending = false;
      this.closeMenu(cx);
    });
  }

  /** A press in the submenu: the menu stays open. */
  pressInsideMenu() {
    this.closePending = false;
  }

  /** Closes the card menu. */
  closeMenu(cx) {
    if (this.menuFor === null) return;
    this.menuFor = null;
    cx.notify();
  }

  /** Puts a card in an iteration, or in none, from its menu. */
  pickIteration(ws, item, iteration, cx) {
    this.menuFor = null;
    const meta = this.meta(ws);
    if (!meta || (iteration?.id ?? null) === item.iterationId) return cx.notify();
    this.write(
      item,
      this.fieldChange(item, { iteration: iteration?.title ?? null, iterationId: iteration?.id ?? null }),
      () => setIteration(meta, item, iteration),
      cx,
    );
  }

  /** Sets a card's milestone, or none, from its menu. */
  pickMilestone(item, milestone, cx) {
    this.menuFor = null;
    if ((milestone?.id ?? null) === (item.milestone?.id ?? null)) return cx.notify();
    this.write(
      item,
      this.fieldChange(item, { milestone: milestone ? { id: milestone.id, title: milestone.title } : null }),
      () => setMilestone(item, milestone),
      cx,
    );
  }

  //#endregion
}
