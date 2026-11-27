// The Board tab's own state: its filter (Type, Columns and People chips and the raw board
// filter, edited in the filter dialog), a card being dragged to another status, the card menu
// that moves it or sets its iteration or milestone, and the toast with Undo after a move.
//
// The board always shows the saved filter. The filter dialog counts an edit without touching
// the board; its Save writes the board filter and the columns to the settings file
// (`boardView.query`, `boardView.statuses`), and the people picked stay on this computer, in
// localStorage. A filter GitHub refuses keeps the last good board and shows GitHub's error in the
// dialog. A move shows at once, goes back with an error when GitHub refuses it, and can be undone
// from the toast.

import { readTextFile } from "herdr";
import { openMilestones, setIteration, setMilestone, setPosition, setStatus } from "./board-actions.js";
import { boardSummary, boardTypes, withBoardTypes } from "./board-terms.js";
import { CARD_GAP, COLUMN_PADDING, NO_STATUS, UNASSIGNED, peopleOf, pickedItem } from "./board-view.js";
import { CardMenu } from "./board-menu.js";
import { configPath, normalizeConfig } from "./config.js";
import { boardStatuses, loadBoardView } from "./data.js";
import { saveSettings } from "./settings-data.js";
import { demoBoardView, demoMilestones } from "./demo-data.js";
import { valuesOf } from "./search-terms.js";
import { openFilterDialog } from "./filter-dialog.js";
import { FilterButton } from "./ui.js";

const PICKED_KEY = "alpmeister.boardPeople";
/** A press that moves less than this is a click (open the card), not a drag. */
const DRAG_SLOP = 5;
/** A card's height before it has been measured. */
const CARD_HEIGHT = 90;
/** The Board filter a workspace has when the settings name none. */
const DEFAULT_QUERY = "iteration:@current";
/** How long the toast after a move stays, with its Undo. */
const UNDO_TOAST_MS = 10000;
/** How long the toast after an Undo stays. */
const DONE_TOAST_MS = 4000;

/**
 * Whether two lists hold the same entries in the same order.
 * @param {string[]} one
 * @param {string[]} other
 * @returns {boolean}
 */
const sameList = (one, other) => one.length === other.length && one.every((entry, index) => entry === other[index]);

/**
 * Whether two Board filters are the same: the filter text and the columns.
 * @param {{ query: string, statuses: string[] }} one
 * @param {{ query: string, statuses: string[] }} other
 * @returns {boolean}
 */
const sameView = (one, other) => one.query.trim() === other.query.trim() && sameList(one.statuses, other.statuses);

/**
 * A workspace with another Board filter and columns in place of its saved ones, to fetch with.
 * @param {object} ws The workspace.
 * @param {{ query: string, statuses?: string[] }} view The filter, and the columns.
 * @returns {object} A copy; `ws` is not changed.
 */
const withView = (ws, view) => ({ ...ws, boardView: { ...ws.boardView, query: view.query.trim(), statuses: view.statuses ?? ws.boardView.statuses } });

/**
 * How a toast names a card: its number, or a draft's title.
 * @param {{ number: number | null, title: string }} item The board item.
 * @returns {string}
 */
const cardName = (item) => (item.number != null ? `#${item.number}` : `"${item.title}"`);

/**
 * The settings file's contents with one workspace's Board filter and columns saved. Everything
 * else stays as the file had it. A file in the one-repo shape keeps its one workspace's keys at
 * its top level, so they go there.
 * @param {object} raw The parsed file.
 * @param {string} name The workspace's name, as the settings show it.
 * @param {{ query: string, statuses: string[] }} view The filter and the columns.
 * @returns {object} A new object to write; `raw` is not changed.
 * @throws {Error} When the file has no such workspace with a board.
 */
function withBoardView(raw, name, view) {
  const next = JSON.parse(JSON.stringify(raw ?? {}));
  const index = normalizeConfig(next).workspaces.findIndex((ws) => ws.name === name && ws.board);
  if (index < 0) throw new Error(`The workspace ${name} has no board in the settings file.`);
  const holder = next.repo || next.project ? next : next.workspaces[index];
  holder.boardView = { ...holder.boardView, query: view.query, statuses: view.statuses };
  return next;
}

export class BoardState {
  /**
   * @param {object} view The Alpmeister view: its config, model, cache and settings.
   */
  constructor(view) {
    this.view = view;
    /** Each workspace's types seen on its cards in this copy, so a Type chip stays offered once its cards are filtered out. */
    this.seenTypes = {};
    this.pickedByWorkspace = {};
    /**
     * The card being dragged, or null: `{ item, start, moved, over, grab, size, pointer }`. `grab` is
     * where the card was pressed inside it, `size` its width and height, and `pointer` where the
     * pointer is over the columns.
     */
    this.drag = null;
    /** The card whose menu is open, by board item id, or null; and the last one opened. */
    this.menuFor = null;
    this.lastMenuFor = null;
    /** The open submenu of the card menu: "status", "iteration", "milestone" or null. */
    this.submenu = null;
    /** A press outside the main menu waits a frame to learn whether it was in the submenu. */
    this.closePending = false;
    /** The focus handles of the menu's first row, its submenu's first row and the ⋯ it opened from; made on first use. */
    this.focus = null;
    /**
     * Where the pointer last was on a card, `{ itemId, x, y }` inside it, so a ⋯ press opens the
     * menu there; and where the open menu sits on its card, `{ x, y }`, or null for its top-left.
     */
    this.pointer = null;
    this.menuAt = null;
    /** The toast after a move: `{ seq, text, status, tail, undo }`, or null. */
    this.toast = null;
    this.toastSeq = 0;
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
   * The Board options this state answers: the filter, the picked people, the drag, the card
   * menu and the writes under way. Alp's view draws the toast (`toastOverlay` in main.js).
   * @param {object} ws The workspace the Board shows.
   * @returns {object} Options for `Board`.
   */
  options(ws) {
    return {
      filter: this.filterButton(ws),
      onChooseColumns: () => this.openFilter(ws),
      onClearFilters: (cx) => this.clearFilters(ws, cx),
      picked: this.picked(ws),
      onTogglePerson: (login, cx) => this.togglePerson(ws, login, cx),
      onClearPeople: (cx) => this.setPicked(ws, new Set(), cx),
      draggedId: this.drag?.moved ? this.drag.item.itemId : null,
      dragOver: this.drag?.over ?? null,
      writing: this.writing,
      writeError: this.writeError,
      menuFor: this.menuFor,
      menuAt: this.menuAt,
      focus: this.focus,
      dotsFor: this.menuFor ?? this.lastMenuFor,
      onCardPointer: (itemId, point) => (this.pointer = { itemId, ...point }),
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
      onCardMenu: (item, cx, keyboard, at) => this.toggleMenu(item, cx, keyboard, at),
      cardMenu: (item, flip, columns) =>
        CardMenu(item, {
          flip,
          columns,
          meta: this.meta(ws),
          milestones: this.milestones[item.repo],
          submenu: this.submenu,
          focus: this.focus,
          onSubmenu: (name, cx, keyboard) => this.openSubmenu(name, cx, keyboard),
          onMove: (status, cx) => this.moveTo(ws, item, status, cx),
          onIteration: (iteration, cx) => this.pickIteration(ws, item, iteration, cx),
          onMilestone: (milestone, cx) => this.pickMilestone(item, milestone, cx),
          onClose: (cx, keyboard) => this.closeMenu(cx, keyboard),
          onOutside: (cx) => this.pressOutsideMenu(cx),
          onInside: () => this.pressInsideMenu(),
          claude: this.claudeAction(item),
        }),
    };
  }

  /**
   * The card menu's Claude row, the Board card's only way to Claude: "Start with Claude" for an
   * issue, "Review with Claude" for a PR, running the prompt set in Settings; with no prompt set,
   * "Set the Claude prompt" opens Settings. None for a draft.
   * @param {object} item The board item.
   * @returns {{ label: string, note?: string, onPress(cx: object): void } | null}
   */
  claudeAction(item) {
    if (item.kind === "draft" || item.number == null) return null;
    const actions = this.view.launchActions();
    if (!actions.prompt(item.kind)) {
      return {
        label: "Set the Claude prompt",
        note: "Settings",
        onPress: (cx) => {
          this.closeMenu(cx);
          actions.openSettings(cx);
        },
      };
    }
    return {
      label: item.kind === "pr" ? "Review with Claude" : "Start with Claude",
      onPress: (cx) => {
        this.closeMenu(cx);
        actions.launch(item);
      },
    };
  }

  //#region Filter

  /**
   * A workspace's saved Board filter and columns.
   * @param {object} ws The workspace.
   * @returns {{ query: string, statuses: string[] }}
   */
  saved(ws) {
    return { query: ws.boardView.query, statuses: ws.boardView.statuses };
  }

  /**
   * Whether the settings hold a Board filter or columns other than the default: the filter's
   * button is then in the accent.
   * @param {object} ws The workspace.
   * @returns {boolean}
   */
  isSaved(ws) {
    const saved = this.saved(ws);
    return saved.query.trim() !== DEFAULT_QUERY || saved.statuses.length > 0;
  }

  /**
   * The workspace as the settings have it now, by name: a dialog outlives the draw that opened it.
   * @param {object} ws The workspace as it was.
   * @returns {object} The workspace now, or `ws` when the settings lost it.
   */
  current(ws) {
    return this.view.config?.workspaces.find((entry) => entry.name === ws.name && entry.board) ?? ws;
  }

  /**
   * The Board filter's button for the header: the filter in words, which opens the filter dialog.
   * @param {object} ws The workspace.
   * @returns {object}
   */
  filterButton(ws) {
    const saved = this.saved(ws);
    return FilterButton("bv-filter", {
      summary: boardSummary(saved.query, boardStatuses(ws), ws.statuses.length, [...this.picked(ws)]),
      saved: this.isSaved(ws),
      onOpen: () => this.openFilter(ws),
      tooltip: "Change what the board shows",
    });
  }

  /**
   * Opens the filter dialog on the Board: the saved filter and columns and the people picked, or
   * `start` in their place. The board shows the saved filter until Save.
   * @param {object} ws The workspace.
   * @param {{ query?: string }} [start] What the dialog starts on instead.
   * @returns {void}
   */
  openFilter(ws, start = {}) {
    const saved = this.saved(ws);
    openFilterDialog({
      start: { query: saved.query, statuses: saved.statuses, people: [...this.picked(ws)], ...start },
      fallback: { query: DEFAULT_QUERY, statuses: [], people: [] },
      spec: (draft) => this.dialogSpec(this.current(ws), draft),
      count: (draft) => this.countDraft(this.current(ws), draft),
      save: (draft) => this.saveDraft(this.current(ws), draft),
    });
  }

  /**
   * What the filter dialog draws for the Board: the Type, Columns and People chips, the board
   * filter, and how many cards it shows now.
   * @param {object} ws The workspace.
   * @param {{ query: string, statuses: string[], people: string[] }} draft The dialog's edit.
   * @returns {import("./filter-dialog.js").DialogSpec}
   */
  dialogSpec(ws, draft) {
    const items = this.view.model?.workspaces?.[ws.name]?.boardView?.items ?? [];
    for (const item of items) if (item.type) (this.seenTypes[ws.name] ??= new Set()).add(item.type);
    const ticked = boardStatuses(withView(ws, draft));
    const types = boardTypes(draft.query);
    const picked = new Set(draft.people);
    const people = peopleOf(items);
    // Someone picked whose cards the filter hides stays offered, so they can be unpicked.
    for (const login of picked) if (!people.some((person) => person.login === login)) people.push({ login, count: 0 });
    const groups = [
      {
        label: "Type",
        chips: this.typeOptions(ws, items, draft.query).map((type) => ({
          id: `bv-f-type-${type}`,
          label: type,
          on: types.includes(type),
          press: (edit) => {
            const now = boardTypes(edit.query);
            const next = now.includes(type) ? now.filter((entry) => entry !== type) : [...now, type];
            return { ...edit, query: withBoardTypes(edit.query, next) };
          },
        })),
      },
      {
        label: "Columns",
        chips: ws.statuses.map((status) => ({
          id: `bv-f-col-${status}`,
          label: status,
          on: !ticked.length || ticked.includes(status),
          press: (edit) => this.toggleColumn(ws, edit, status),
        })),
      },
      {
        label: "People",
        note: "kept on this computer",
        chips: people.map((person) => ({
          id: `bv-f-who-${person.login || "unassigned"}`,
          label: person.login === UNASSIGNED ? "Unassigned" : person.login,
          on: picked.has(person.login),
          tooltip: `${person.count} card${person.count === 1 ? "" : "s"}`,
          press: (edit) => {
            const next = new Set(edit.people);
            if (next.has(person.login)) next.delete(person.login);
            else next.add(person.login);
            return { ...edit, people: [...next] };
          },
        })),
      },
    ].filter((group) => group.chips.length);
    return {
      title: `Filter: ${ws.board.title || ws.name}`,
      groups,
      inputLabel: "Board filter",
      placeholder: "The board's filter, such as type:Bug iteration:@current",
      hint: "The chips write this. Enter updates the preview.",
      noun: ["card", "cards"],
      now: this.view.model?.workspaces?.[ws.name]?.boardView ? items.filter((item) => pickedItem(item, this.picked(ws))).length : null,
      saveLabel: "Save for this board",
      demo: this.view.demo,
    };
  }

  /**
   * Counts the cards a draft shows: the board fetched with its filter and columns (in the demo,
   * the made-up cards filtered), then its people. The board itself stays as it is.
   * @param {object} ws The workspace.
   * @param {{ query: string, statuses: string[], people: string[] }} draft The dialog's edit.
   * @returns {Promise<number>}
   * @throws {Error} With GitHub's message when it refuses the filter.
   */
  async countDraft(ws, draft) {
    const target = withView(ws, draft);
    const boardView = this.view.demo ? demoBoardView(target) : await loadBoardView(target);
    const picked = new Set(draft.people ?? []);
    return (boardView?.items ?? []).filter((item) => pickedItem(item, picked)).length;
  }

  /**
   * The filter dialog's Save: keeps the people on this computer, and writes the board filter and
   * the columns to the settings file (`boardView.query`, `boardView.statuses`) through
   * `saveSettings`, which keeps the old file as alpmeister.json.bak; unchanged, nothing is
   * written. A filter GitHub refuses is not saved. In the demo the settings change for this copy
   * only, and nothing is written.
   * @param {object} ws The workspace.
   * @param {{ query: string, statuses: string[], people: string[] }} draft The dialog's edit.
   * @returns {Promise<void>}
   * @throws {Error} When GitHub refuses the filter, or the file can't be written.
   */
  async saveDraft(ws, draft) {
    const view = { query: draft.query.trim(), statuses: draft.statuses };
    this.pickedByWorkspace = { ...this.pickedByWorkspace, [ws.name]: draft.people ?? [] };
    // localStorage belongs to the copy that calls it: keep the people from the Board's own copy.
    this.view.queued.push(() => this.rememberPicked());
    if (!sameView(view, this.saved(ws))) {
      const target = withView(ws, view);
      if (this.view.demo) {
        const config = this.view.config;
        this.view.config = { ...config, workspaces: config.workspaces.map((entry) => (entry.name === ws.name ? target : entry)) };
        this.putBoard(ws, demoBoardView(target));
      } else {
        const text = await readTextFile(configPath());
        let raw = {};
        try {
          raw = text ? JSON.parse(text) : {};
        } catch (error) {
          throw new Error(`${configPath()} is not valid JSON: ${error}`);
        }
        const next = withBoardView(raw ?? {}, ws.name, view);
        const config = normalizeConfig(next);
        const boardView = await loadBoardView(config.workspaces.find((entry) => entry.name === ws.name));
        const written = await saveSettings(next, text);
        this.view.settingsSaved(config, written);
        this.putBoard(ws, boardView);
        if (this.view.model) await this.view.saveCache(this.view.model);
      }
    }
    this.view.filterDone();
  }

  /**
   * Puts a fetched board in the model in place of the workspace's last one, and notes its types.
   * @param {object} ws The workspace.
   * @param {object | null} boardView The board, in `loadBoardView()`'s shape.
   * @returns {void}
   */
  putBoard(ws, boardView) {
    const seen = (this.seenTypes[ws.name] ??= new Set());
    for (const item of boardView?.items ?? []) if (item.type) seen.add(item.type);
    const model = this.view.model;
    if (!model?.workspaces?.[ws.name]) return;
    const { boardView: _failed, ...errors } = model.workspaces[ws.name].errors ?? {};
    model.workspaces[ws.name] = { ...model.workspaces[ws.name], boardView, errors };
  }

  /**
   * One column on or off in a draft, from a chip. With no columns ticked every status is a
   * column, so the first click leaves out the one clicked; every column ticked is the same as
   * none (or as the saved columns, when those are every one). The last column stays.
   * @param {object} ws The workspace.
   * @param {{ query: string, statuses: string[] }} draft The dialog's edit.
   * @param {string} status The status.
   * @returns {object | string} The draft after the click, or why it can't be.
   */
  toggleColumn(ws, draft, status) {
    const ticked = boardStatuses(withView(ws, draft));
    const current = ticked.length ? ticked : ws.statuses;
    const next = current.includes(status) ? current.filter((entry) => entry !== status) : ws.statuses.filter((entry) => entry === status || current.includes(entry));
    if (!next.length) return "Keep at least one column.";
    const saved = this.saved(ws).statuses;
    const all = next.length === ws.statuses.length;
    const statuses = !all ? next : boardStatuses(ws).length === ws.statuses.length ? saved : [];
    return { ...draft, statuses };
  }

  /**
   * "Clear filters", from an empty board: everyone, and when the board itself came back empty,
   * the filter dialog with no board filter, to save if it should stay.
   * @param {object} ws The workspace.
   * @param {object} cx The context.
   * @returns {void}
   */
  clearFilters(ws, cx) {
    this.pickedByWorkspace = { ...this.pickedByWorkspace, [ws.name]: [] };
    this.rememberPicked();
    const items = this.view.model?.workspaces?.[ws.name]?.boardView?.items ?? [];
    if (!items.length) this.openFilter(ws, { query: "" });
    cx.notify();
  }

  /**
   * The types the Type chips offer: those on the board's cards (now or earlier in this copy),
   * those the filter names, and those the workspace's settings name.
   * @param {object} ws The workspace.
   * @param {object[]} items The board's cards.
   * @param {string} query The board filter as the dialog has it.
   * @returns {string[]} The types, in alphabetical order.
   */
  typeOptions(ws, items, query) {
    const types = new Set([
      ...items.map((item) => item.type).filter(Boolean),
      ...(this.seenTypes[ws.name] ?? []),
      ...boardTypes(query),
      ...valuesOf(ws.bugs?.query ?? "", "type"),
      ...(ws.spotlight?.featureTypes ?? []),
      ...(ws.inFlight?.excludeTypes ?? []),
    ]);
    return [...types].sort((one, other) => one.localeCompare(other));
  }

  /**
   * The people picked in a workspace.
   * @param {object} ws The workspace.
   * @returns {Set<string>}
   */
  picked(ws) {
    return new Set(this.pickedByWorkspace[ws.name] ?? []);
  }

  /**
   * Picks or unpicks one person from the avatar row above the board.
   * @param {object} ws The workspace.
   * @param {string} login The person, or UNASSIGNED.
   * @param {object} cx The context.
   * @returns {void}
   */
  togglePerson(ws, login, cx) {
    const picked = this.picked(ws);
    if (picked.has(login)) picked.delete(login);
    else picked.add(login);
    this.setPicked(ws, picked, cx);
  }

  /**
   * Sets a workspace's picked people, the same ones the filter dialog's People chips show, keeps
   * them on this computer and redraws.
   * @param {object} ws The workspace.
   * @param {Set<string>} picked The people.
   * @param {object} cx The context.
   * @returns {void}
   */
  setPicked(ws, picked, cx) {
    this.pickedByWorkspace = { ...this.pickedByWorkspace, [ws.name]: [...picked] };
    this.rememberPicked();
    cx.notify();
  }

  /**
   * Keeps the picked people on this computer, for this copy; the demo keeps them in memory only.
   * @returns {void}
   */
  rememberPicked() {
    if (this.view.demo) return;
    try {
      localStorage.setItem(PICKED_KEY, JSON.stringify(this.pickedByWorkspace));
    } catch (error) {
      console.log(`alpmeister: picked people not remembered: ${error}`);
    }
  }

  //#endregion

  //#region Moves

  /**
   * The board load's ids for a workspace, or null before a load that read them.
   * @param {object} ws The workspace.
   * @returns {object | null}
   */
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
   * @param {(cx: object) => void} [done] Called once GitHub took it (in the demo, at once).
   * @returns {void}
   */
  write(item, change, write, cx, done) {
    change.apply();
    this.writeError = null;
    // The demo board is made up: the change shows, and nothing is written.
    if (this.view.demo) {
      done?.(cx);
      return cx.notify();
    }
    this.writing.add(item.itemId);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await write();
        await this.view.saveCache(this.view.model);
        done?.(cx);
      } catch (error) {
        change.revert();
        this.writeError = `${item.title}: ${error?.message ?? error}`;
      }
      this.writing.delete(item.itemId);
      cx.notify();
    });
  }

  /**
   * Shows a toast over the board for a while; a newer one replaces it.
   * @param {{ text: string, status: string, tail: string, undo?: (cx: object) => void }} toast
   *   The words around the status, which is drawn bold, and what Undo does.
   * @param {number} ms How long it stays.
   * @param {object} cx The context.
   * @returns {void}
   */
  showToast(toast, ms, cx) {
    const seq = ++this.toastSeq;
    this.toast = { ...toast, seq };
    cx.timer.after(ms, (later) => {
      if (this.toast?.seq !== seq) return;
      this.toast = null;
      (later ?? cx).notify();
    });
  }

  /**
   * The toast after a card moved to another status, with an Undo that writes the old status
   * back, and the old place when the move changed it.
   * @param {object} ws The workspace.
   * @param {object} item The board item.
   * @param {{ from: string | null, to: string | null, order: object[] | null }} move The status
   *   before and after (null is No status), and the board order before a drag (null when the
   *   move kept the order).
   * @param {object} cx The context.
   * @returns {void}
   */
  movedToast(ws, item, move, cx) {
    this.showToast(
      {
        text: `Moved ${cardName(item)} to`,
        status: move.to ?? NO_STATUS,
        tail: this.view.demo ? "(demo: nothing written to GitHub)" : "on GitHub",
        undo: (cx) => this.undoMove(ws, item, move, cx),
      },
      UNDO_TOAST_MS,
      cx,
    );
  }

  /**
   * Undo, from the toast: puts the card back in its old status, and its old place after a drag.
   * @param {object} ws The workspace.
   * @param {object} item The board item.
   * @param {{ from: string | null, to: string | null, order: object[] | null }} move The move to undo.
   * @param {object} cx The context.
   * @returns {void}
   */
  undoMove(ws, item, move, cx) {
    this.toast = null;
    const items = this.view.model?.workspaces?.[ws.name]?.boardView?.items;
    const meta = this.meta(ws);
    if (!items || !meta) return cx.notify();
    const now = items.slice();
    const before = move.order ? move.order[move.order.indexOf(item) - 1] ?? null : null;
    const status = this.fieldChange(item, { status: move.from });
    const change = {
      apply: () => {
        status.apply();
        if (move.order) items.splice(0, items.length, ...move.order.filter((entry) => items.includes(entry)));
      },
      revert: () => {
        status.revert();
        items.splice(0, items.length, ...now);
      },
    };
    this.write(
      item,
      change,
      async () => {
        await setStatus(meta, item, move.from);
        if (move.order) await setPosition(meta, item, before);
      },
      cx,
      (cx) =>
        this.showToast(
          { text: `Moved ${cardName(item)} back to`, status: move.from ?? NO_STATUS, tail: this.view.demo ? "(demo)" : "on GitHub" },
          DONE_TOAST_MS,
          cx,
        ),
    );
  }

  /**
   * "Move to…", from the card menu: moves the card to another status, keeping its place in the
   * board order, then shows the toast with Undo.
   * @param {object} ws The workspace.
   * @param {object} item The board item.
   * @param {string} column The column; No status takes the status off.
   * @param {object} cx The context.
   * @returns {void}
   */
  moveTo(ws, item, column, cx) {
    this.menuFor = null;
    const to = column === NO_STATUS ? null : column;
    const meta = this.meta(ws);
    if (!meta || to === item.status) return cx.notify();
    const from = item.status;
    this.write(item, this.fieldChange(item, { status: to }), () => setStatus(meta, item, to), cx, (cx) =>
      this.movedToast(ws, item, { from, to, order: null }, cx),
    );
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

  /**
   * Keeps a card's drawn height, for finding the drop spot.
   * @param {string} itemId The card's board item id.
   * @param {number} height Its height, in measured units.
   * @returns {void}
   */
  measureCard(itemId, height) {
    this.cardHeights.set(itemId, height);
  }

  /**
   * Keeps a column header's drawn height, for finding the drop spot.
   * @param {number} height Its height, in measured units.
   * @returns {void}
   */
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

  /**
   * Drops a dragged card on the column under the pointer: it moves to that status and place, and
   * a move to another status shows the toast with Undo.
   * @param {object} ws The workspace.
   * @param {object} cx The context.
   * @returns {void}
   */
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
    const sameStatus = (item.status ?? NO_STATUS) === column;
    const at = items.indexOf(item);
    if (sameStatus && (after ? items.indexOf(after) === at - 1 : before ? items.indexOf(before) === at + 1 : true)) return;
    const meta = this.meta(ws);
    if (!meta) {
      this.writeError = "Refresh to load the board's ids before moving a card.";
      return;
    }
    const order = items.slice();
    const from = item.status;
    const to = column === NO_STATUS ? null : column;
    const status = this.fieldChange(item, { status: to });
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
        if (!sameStatus) await setStatus(meta, item, to);
        await setPosition(meta, item, after);
      },
      cx,
      (cx) => {
        if (!sameStatus) this.movedToast(ws, item, { from, to, order }, cx);
      },
    );
  }

  /** Ends a drag that was not dropped on a column. */
  dragEnd(cx) {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) cx.notify();
  }

  /**
   * The ⋯ on a card, or a right click: opens its menu at the point pressed, or closes it when
   * it is the open one. A press with no point (the keyboard) opens it at the card's top-left.
   * @param {object} item The board item.
   * @param {object} cx The context.
   * @param {boolean} [keyboard] Opened from the keyboard: the keyboard moves into the menu.
   * @param {{ x: number, y: number } | null} [at] Where on the card it was pressed; for the ⋯,
   *   left out, the pointer's last place on that card.
   * @returns {void}
   */
  toggleMenu(item, cx, keyboard = false, at) {
    if (this.menuFor !== null && this.menuFor === item.itemId) return this.closeMenu(cx, keyboard);
    const point = at ?? (!keyboard && this.pointer?.itemId === item.itemId ? this.pointer : null);
    this.menuAt = point ? { x: point.x, y: point.y } : null;
    this.openMenu(item, cx, keyboard);
  }

  /**
   * Opens a card's menu, and reads its repository's milestones the first time.
   * @param {object} item The board item.
   * @param {object} cx The context.
   * @param {boolean} [keyboard] Opened from the keyboard: the keyboard moves to its first row.
   * @returns {void}
   */
  openMenu(item, cx, keyboard = false) {
    if (!item.itemId) {
      this.writeError = "Refresh to load the board's ids before changing a card.";
      cx.notify();
      return;
    }
    this.focus ??= { main: cx.focus_handle(), sub: cx.focus_handle(), dots: cx.focus_handle() };
    this.closePending = false;
    this.menuFor = item.itemId;
    this.lastMenuFor = item.itemId;
    this.submenu = null;
    if (keyboard) cx.timer.after(50, () => this.focus.main.focus());
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

  /**
   * A press in the submenu: the menu stays open.
   * @returns {void}
   */
  pressInsideMenu() {
    this.closePending = false;
  }

  /**
   * Opens one of the card menu's submenus, or shuts it (null). From the keyboard, the keyboard
   * moves to its first row, or back to the main menu.
   * @param {"status" | "iteration" | "milestone" | null} name The submenu.
   * @param {object} cx The context.
   * @param {boolean} [keyboard] Whether a key opened it.
   * @returns {void}
   */
  openSubmenu(name, cx, keyboard = false) {
    if (keyboard && this.focus) cx.timer.after(50, () => (name ? this.focus.sub : this.focus.main).focus());
    if (this.submenu === name) return;
    this.submenu = name;
    cx.notify();
  }

  /**
   * Closes the card menu. Closed from the keyboard, the keyboard goes back to the card's ⋯.
   * @param {object} cx The context.
   * @param {boolean} [keyboard] Whether a key closed it.
   * @returns {void}
   */
  closeMenu(cx, keyboard = false) {
    if (this.menuFor === null) return;
    this.menuFor = null;
    this.closePending = false;
    if (keyboard && this.focus) cx.timer.after(50, () => this.focus.dots.focus());
    cx.notify();
  }

  /**
   * Puts a card in an iteration, or in none, from its menu.
   * @param {object} ws The workspace.
   * @param {object} item The board item.
   * @param {object | null} iteration The iteration, or null for none.
   * @param {object} cx The context.
   * @returns {void}
   */
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

  /**
   * Sets a card's milestone, or none, from its menu.
   * @param {object} item The board item.
   * @param {object | null} milestone The milestone, or null for none.
   * @param {object} cx The context.
   * @returns {void}
   */
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
