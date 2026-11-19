// The Lineup items, read from and written to the focus file Alpmeister keeps at
// ~/.local/state/alp/focus.json: `{ items: [item, ...] }`. Mods cannot import across folders,
// so this is the Daypack's own small reader of that format.

import { home, readTextFile, writeTextFile } from "herdr";

const focusPath = () => `${home()}/.local/state/alp/focus.json`;

/**
 * The list from a file that kept one list per day, as Alpmeister reads it: the latest day's
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
      console.log(`daypack: focus.json unreadable: ${error}`);
      this.list = [];
    }
  }

  /** Writes the file. On a write from elsewhere since the last read, reloads and reports false. */
  async save() {
    const text = `${JSON.stringify({ items: this.list }, null, 2)}\n`;
    try {
      await writeTextFile(focusPath(), text, this.snapshot);
      this.snapshot = text;
      return true;
    } catch (error) {
      console.log(`daypack: focus.json changed elsewhere, reloading: ${error}`);
      await this.load();
      return false;
    }
  }

  /** The items on the list. */
  items() {
    return this.list;
  }

  /** Changes one item. */
  update(id, changes) {
    this.list = this.list.map((item) => (item.id === id ? { ...item, ...changes } : item));
  }
}
