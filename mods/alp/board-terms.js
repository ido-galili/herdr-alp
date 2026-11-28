// A board filter read as terms, for the Board's filter: GitHub's board syntax, not its search.
// A term names a field and one or more values split by commas (`type:Bug,Task`,
// `status:"In Progress",Todo`), optionally negated with "-". The Type chips turn values of the
// `type:` term on and off; every other term stays as typed. The summary says the filter in
// words, and the demo filters its made-up cards with it.

import { tokenize } from "./search-terms.js";

/**
 * A value without its quotes.
 * @param {string} value A value, possibly quoted.
 * @returns {string}
 */
const unquote = (value) => value.replace(/^"(.*)"$/, "$1");

/**
 * A value as the filter writes it: quoted when it has a space or a comma.
 * @param {string} value Such as "In Progress".
 * @returns {string} Such as `"In Progress"`.
 */
const quoted = (value) => (/[\s,]/.test(value) ? `"${value}"` : value);

/**
 * One term of a board filter, read.
 * @param {string} token The term as typed, such as `-type:Epic` or `status:"In Progress",Todo`.
 * @returns {{ token: string, negated: boolean, field: string | null, values: string[] }} `field`
 *   is null for a bare word.
 */
export function boardTerm(token) {
  const match = /^(-?)([a-z][a-z-]*):(.+)$/i.exec(token);
  if (!match) return { token, negated: false, field: null, values: [token] };
  const values = (match[3].match(/(?:[^,"]+|"[^"]*"?)+/g) ?? []).map((value) => unquote(value.trim())).filter(Boolean);
  return { token, negated: match[1] === "-", field: match[2].toLowerCase(), values };
}

/**
 * The types a filter asks for: the values of its plain (not negated) `type:` terms.
 * @param {string} query The board filter.
 * @returns {string[]}
 */
export function boardTypes(query) {
  return tokenize(query)
    .map(boardTerm)
    .filter((term) => term.field === "type" && !term.negated)
    .flatMap((term) => term.values);
}

/**
 * The filter asking for these types: its plain `type:` terms become one, where the first one
 * was (or at the end), and every other term stays as typed. No types drops the term.
 * @param {string} query The board filter.
 * @param {string[]} types The types, in order.
 * @returns {string}
 */
export function withBoardTypes(query, types) {
  const tokens = tokenize(query);
  const at = tokens.findIndex((token) => {
    const term = boardTerm(token);
    return term.field === "type" && !term.negated;
  });
  const kept = tokens.filter((token) => {
    const term = boardTerm(token);
    return !(term.field === "type" && !term.negated);
  });
  if (types.length) kept.splice(at < 0 ? kept.length : at, 0, `type:${types.map(quoted).join(",")}`);
  return kept.join(" ");
}

/**
 * One term in words, for the summary.
 * @param {{ token: string, negated: boolean, field: string | null, values: string[] }} term The term.
 * @returns {string}
 */
function termWords(term) {
  const not = term.negated ? "not " : "";
  const values = term.values.join(" + ");
  if (term.field === "type") return `${not}${values}`;
  if (term.field === "iteration") {
    const value = term.values.length === 1 ? term.values[0].toLowerCase() : null;
    if (value === "@current") return `${not}current iteration`;
    if (value === "@previous") return `${not}previous iteration`;
    if (value === "@next") return `${not}next iteration`;
    return `${not}${values}`;
  }
  if (term.field === "assignee") {
    const me = term.values.length === 1 && term.values[0].toLowerCase() === "@me";
    return me ? `${not}mine` : `${not}assigned to ${values}`;
  }
  if (term.field === "no") return `no ${values}`;
  return term.token;
}

/**
 * The Board's filter in words, for its summary: "Bug + Task · current iteration · 4 columns ·
 * mara-v, tobi-s". Types and other terms come first, then how many columns, then whose cards.
 * @param {string} query The board filter, without the columns.
 * @param {string[]} columns The ticked columns; none or every one is "all columns".
 * @param {number} statusCount How many statuses the board has.
 * @param {string[]} people The picked logins; "" is Unassigned.
 * @returns {string}
 */
export function boardSummary(query, columns, statusCount, people) {
  const words = tokenize(query).map((token) => termWords(boardTerm(token)));
  words.push(
    !columns.length || columns.length >= statusCount
      ? "all columns"
      : `${columns.length} column${columns.length === 1 ? "" : "s"}`,
  );
  const names = people.map((login) => login || "unassigned");
  if (names.length > 2) words.push(`${names.length} people`);
  else if (names.length) words.push(names.join(", "));
  return words.join(" · ");
}

/**
 * Whether a made-up board card matches a board filter, for the demo. Known fields are checked
 * against the card; a field it doesn't know matches everything; a bare word matches the title.
 * @param {{ kind: string, type: string | null, status: string | null, iteration: string | null,
 *   assignees: { login: string }[], milestone: { title: string } | null, state: string | null,
 *   title: string }} item The card.
 * @param {string} query The whole board filter, columns included.
 * @param {{ viewer: string, iteration: string | null }} context The login `@me` stands for, and
 *   the current iteration's title.
 * @returns {boolean}
 */
export function matchesBoard(item, query, { viewer, iteration }) {
  const lower = (value) => (value ?? "").toLowerCase();
  const logins = item.assignees.map((person) => lower(person.login));
  return tokenize(query).every((token) => {
    const term = boardTerm(token);
    const any = (test) => term.values.some((value) => test(lower(value)));
    let hit = true;
    if (!term.field) hit = lower(item.title).includes(lower(term.values[0]));
    else if (term.field === "type") hit = any((value) => value === lower(item.type));
    else if (term.field === "status") hit = any((value) => value === lower(item.status));
    else if (term.field === "iteration")
      hit = any((value) => (value === "@current" ? item.iteration === iteration : value === lower(item.iteration)));
    else if (term.field === "assignee") hit = any((value) => logins.includes(value === "@me" ? lower(viewer) : value));
    else if (term.field === "milestone") hit = any((value) => value === lower(item.milestone?.title));
    else if (term.field === "no") {
      const empty = {
        assignee: !logins.length,
        type: !item.type,
        status: !item.status,
        iteration: !item.iteration,
        milestone: !item.milestone,
      };
      hit = any((value) => empty[value] ?? true);
    } else if (term.field === "is") {
      hit = any((value) =>
        value === "issue" || value === "pr"
          ? item.kind === value
          : value === "open" || value === "closed"
            ? lower(item.state ?? "open") === value
            : true,
      );
    }
    return term.negated ? !hit : hit;
  });
}
