// Today's trail items, read from and written to the focus file the Alp tab keeps at
// ~/.local/state/alp/focus.json: `{ items: [item, ...] }`. Mods cannot import across folders,
// so this is the Daypack's own small reader and writer of that format: keep it in step with
// mods/alp/focus.js.

import { exec, home, readTextFile, writeTextFile } from "herdr";

const stateDir = () => `${home()}/.local/state/alp`;
const focusPath = () => `${stateDir()}/focus.json`;

/**
 * Today's date in local time, as items record it: "2026-11-16".
 * @returns {string}
 */
export function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * How many calendar dates lie between the day an item was added and today: 0 on that day.
 * @param {{ added?: string }} item A focus item.
 * @returns {number}
 */
export function daysSinceAdded(item) {
  const [year, month, day] = (item.added ?? today()).split("-").map(Number);
  const now = new Date();
  const start = new Date(year, month - 1, day);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((midnight - start) / 86400000);
}

/**
 * The list from a file that kept one list per day, as the Alp tab reads it: the latest day's
 * items, then the unchecked items of the day before it, each dated by the first day it appears on.
 */
function fromDays(days) {
  const dates = Object.keys(days).sort();
  if (!dates.length) return [];
  const latest = days[dates[dates.length - 1]];
  const kept = new Set(latest.map((item) => item.id));
  const before = dates.length > 1 ? days[dates[dates.length - 2]] : [];
  const items = [...latest, ...before.filter((item) => !item.done && !kept.has(item.id))];
  const firstSeen = (id) => dates.find((date) => days[date].some((item) => item.id === id));
  return items.map((item) => ({ ...item, added: item.added ?? firstSeen(item.id) }));
}

/** The focus file, written back only over the version it was read from. */
export class FocusFile {
  constructor() {
    this.list = [];
    this.snapshot = null;
  }

  /** Reads the file. A missing or unreadable file reads as empty. */
  async load() {
    const text = await readTextFile(focusPath());
    this.snapshot = text;
    try {
      const data = text ? JSON.parse(text) : {};
      this.list = data.items ?? fromDays(data.days ?? {});
    } catch (error) {
      console.log(`alp-daypack: focus.json unreadable: ${error}`);
      this.list = [];
    }
  }

  /**
   * Writes the file. On a write from elsewhere since the last read, reloads and reports false.
   * @returns {Promise<boolean>} Whether the write went through.
   */
  async save() {
    const text = `${JSON.stringify({ items: this.list }, null, 2)}\n`;
    await exec("mkdir", ["-p", stateDir()]);
    try {
      await writeTextFile(focusPath(), text, this.snapshot);
      this.snapshot = text;
      return true;
    } catch (error) {
      console.log(`alp-daypack: focus.json changed elsewhere, reloading: ${error}`);
      await this.load();
      return false;
    }
  }

  /** The items on the list. */
  items() {
    return this.list;
  }

  /**
   * Changes one item.
   * @param {string} id The item's id.
   * @param {object} changes The fields to change.
   * @returns {void}
   */
  update(id, changes) {
    this.list = this.list.map((item) => (item.id === id ? { ...item, ...changes } : item));
  }

  /**
   * Adds an item, unless one with its id is already on the list.
   * @param {object} item The whole item, with its `id`.
   * @returns {void}
   */
  add(item) {
    if (!this.list.some((candidate) => candidate.id === item.id)) this.list = [...this.list, item];
  }

  /**
   * Removes one item.
   * @param {string} id The item's id.
   * @returns {void}
   */
  remove(id) {
    this.list = this.list.filter((item) => item.id !== id);
  }
}
