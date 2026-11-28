// Today's focus: GitHub picks and typed todos in ~/.local/state/alp/focus.json, as
// `{ items: [item, ...] }`. Items stay until removed, and each one records the day it was added.
// A file, not the mod's localStorage, so the list survives its tab closing and other Alp
// mods can read it.

import { exec, readTextFile, writeTextFile } from "herdr";
import { stateDir } from "./config.js";
import { repoOfItem } from "./data.js";

const DAY_MS = 86400000;

const focusPath = () => `${stateDir()}/focus.json`;

/** Today's date in local time, as items record it: "2026-11-16". */
export function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** How many calendar dates lie between the day an item was added and today: 0 on that day. */
export function daysSinceAdded(item) {
  const [year, month, day] = (item.added ?? today()).split("-").map(Number);
  const now = new Date();
  const start = new Date(year, month - 1, day);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((midnight - start) / DAY_MS);
}

/**
 * The list from a file that kept one list per day: the latest day's items, then the unchecked
 * items of the day before it. Each item's `added` is the first day it appears on.
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

/**
 * The id of a pinned GitHub item.
 * @param {string} kind "issue" or "pr".
 * @param {string | null} repo `owner/name`.
 * @param {number} number The issue or PR number.
 * @returns {string} The item's id, unique across repositories.
 */
export const pickId = (kind, repo, number) => `${kind}-${repo}#${number}`;

/**
 * An item as the current version keeps it: a GitHub item pinned before workspaces gets its
 * repository from its URL, and an id that names it.
 * @param {object} item A focus item.
 * @returns {object} The item, upgraded when needed.
 */
function withRepo(item) {
  if (item.kind === "todo" || item.repo) return item;
  const repo = repoOfItem(item);
  return repo ? { ...item, repo, id: pickId(item.kind, repo, item.number) } : item;
}

/** A focus list stored on disk, written back only over the version it was read from. */
export class FocusStore {
  /**
   * @param {object[] | null} demo A made-up list for the demo: it is never read from or written
   *   to the file.
   */
  constructor(demo = null) {
    this.list = [];
    this.snapshot = null;
    this.demo = Boolean(demo);
    if (demo) this.list = demo;
  }

  /** Reads the file. A missing or unreadable file starts an empty list. */
  async load() {
    if (this.demo) return;
    const text = await readTextFile(focusPath());
    this.snapshot = text;
    try {
      const data = text ? JSON.parse(text) : {};
      this.list = (data.items ?? fromDays(data.days ?? {})).map(withRepo);
    } catch (error) {
      console.log(`alp: focus.json unreadable, starting empty: ${error}`);
      this.list = [];
    }
  }

  /** Writes the file. On a write from elsewhere since the last read, reloads and reports false. */
  async save() {
    if (this.demo) return true;
    const text = `${JSON.stringify({ items: this.list }, null, 2)}\n`;
    await exec("mkdir", ["-p", stateDir()]);
    try {
      await writeTextFile(focusPath(), text, this.snapshot);
      this.snapshot = text;
      return true;
    } catch (error) {
      console.log(`alp: focus.json changed elsewhere, reloading: ${error}`);
      await this.load();
      return false;
    }
  }

  /** The items on the list. */
  items() {
    return this.list;
  }

  /**
   * Whether the list already holds this GitHub item.
   * @param {string} kind "issue" or "pr".
   * @param {string} repo `owner/name`.
   * @param {number} number The issue or PR number.
   * @returns {boolean}
   */
  has(kind, repo, number) {
    return this.list.some((item) => item.kind === kind && item.repo === repo && item.number === number);
  }

  /**
   * Adds an item, dated today.
   * @param {object} item A todo (`{ kind: "todo", text }`) or a GitHub item with `repo` and `number`.
   */
  add(item) {
    const id = item.kind === "todo" ? `todo-${Date.now()}` : pickId(item.kind, item.repo, item.number);
    this.list = [...this.list, { id, done: false, added: today(), ...item }];
  }

  /** Changes one item. */
  update(id, changes) {
    this.list = this.list.map((item) => (item.id === id ? { ...item, ...changes } : item));
  }

  /** Removes one item. */
  remove(id) {
    this.list = this.list.filter((item) => item.id !== id);
  }
}
