// A GitHub search read as terms, for the card filters: the chips turn terms on and off, the
// summary says the search in words, and the demo filters its made-up items with it.
//
// It knows is:, author:, review-requested:, assignee:, label:, draft: and type:, each optionally
// negated with "-". Every other term (repo:, sort:, a bare word, a typo) is kept as typed: the
// chips never touch it, and it reaches GitHub unchanged.

/** The qualifiers the chips and the summary understand. */
const KNOWN = new Set(["is", "author", "review-requested", "assignee", "label", "draft", "type"]);

/**
 * A search split into its terms, a quoted part (`label:"good first issue"`) kept in one term.
 * @param {string} query The search.
 * @returns {string[]} The terms, as typed.
 */
export function tokenize(query) {
  return (query ?? "").match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [];
}

/**
 * One term, read. A term it doesn't know has no `qualifier`.
 * @param {string} token The term as typed, such as `-label:"needs design"`.
 * @returns {{ token: string, negated: boolean, qualifier: string | null, value: string }}
 */
export function parseTerm(token) {
  const match = /^(-?)([a-z-]+):(.+)$/i.exec(token);
  if (!match || !KNOWN.has(match[2].toLowerCase())) return { token, negated: false, qualifier: null, value: token };
  return { token, negated: match[1] === "-", qualifier: match[2].toLowerCase(), value: unquote(match[3]) };
}

/**
 * A value without its quotes.
 * @param {string} value A value, possibly quoted.
 * @returns {string}
 */
const unquote = (value) => value.replace(/^"(.*)"$/, "$1");

/**
 * A term in one comparable form: lower case, quotes dropped.
 * @param {string} token The term.
 * @returns {string}
 */
const keyOf = (token) => {
  const term = parseTerm(token);
  return term.qualifier ? `${term.negated ? "-" : ""}${term.qualifier}:${term.value}`.toLowerCase() : token;
};

/**
 * Whether a search holds a term (`is:open`, `label:backend`), however its value is quoted.
 * @param {string} query The search.
 * @param {string} term The term.
 * @returns {boolean}
 */
export function hasTerm(query, term) {
  const key = keyOf(term);
  return tokenize(query).some((token) => keyOf(token) === key);
}

/**
 * The search with a term added, before any `sort:` so the sort stays last. A term already there
 * is not added twice.
 * @param {string} query The search.
 * @param {string} term The term.
 * @returns {string}
 */
export function addTerm(query, term) {
  if (hasTerm(query, term)) return query.trim();
  const tokens = tokenize(query);
  const sort = tokens.findIndex((token) => /^sort:/i.test(token));
  tokens.splice(sort < 0 ? tokens.length : sort, 0, term);
  return tokens.join(" ");
}

/**
 * The search without a term; every other term stays as typed.
 * @param {string} query The search.
 * @param {string} term The term.
 * @returns {string}
 */
export function removeTerm(query, term) {
  const key = keyOf(term);
  return tokenize(query)
    .filter((token) => keyOf(token) !== key)
    .join(" ");
}

/**
 * The search with a term turned off when it is there, on when it is not.
 * @param {string} query The search.
 * @param {string} term The term.
 * @returns {string}
 */
export const toggleTerm = (query, term) => (hasTerm(query, term) ? removeTerm(query, term) : addTerm(query, term));

/**
 * The values of every plain (not negated) term with a qualifier, such as each `label:`.
 * @param {string} query The search.
 * @param {string} qualifier The qualifier, such as "label".
 * @returns {string[]} The values, quotes dropped.
 */
export function valuesOf(query, qualifier) {
  return tokenize(query)
    .map(parseTerm)
    .filter((term) => term.qualifier === qualifier && !term.negated)
    .map((term) => term.value);
}

/**
 * A term with a value, quoted when the value has a space.
 * @param {string} qualifier Such as "label".
 * @param {string} value Such as "needs design".
 * @returns {string} Such as `label:"needs design"`.
 */
export const termOf = (qualifier, value) => `${qualifier}:${/\s/.test(value) ? `"${value}"` : value}`;

/**
 * One known term in words.
 * @param {{ qualifier: string, value: string }} term The term, read.
 * @returns {string | null} Its words, or null for a term the summary leaves out.
 */
function termWords({ qualifier, value }) {
  const me = value.toLowerCase() === "@me";
  if (qualifier === "is") {
    const is = value.toLowerCase();
    if (is === "pr" || is === "issue" || is === "open") return null;
    return is === "draft" ? "drafts" : is;
  }
  if (qualifier === "author") return me ? "mine" : `by ${value}`;
  if (qualifier === "assignee") return me ? "mine" : `assigned to ${value}`;
  if (qualifier === "review-requested") return me ? "review requested" : `review requested from ${value}`;
  if (qualifier === "draft") return value.toLowerCase() === "false" ? "not draft" : "drafts";
  return `${qualifier} ${value}`;
}

/** The order the summary says terms in: whose items first, then their state, then the rest. */
const SUMMARY_ORDER = ["review-requested", "author", "assignee", "is", "draft", "type", "label"];

/**
 * A search in words, for a card's filter summary: "review requested · not draft", "mine · label
 * backend". It leaves out what every card has (is:pr, is:issue, is:open, sort:), says "open and
 * closed" when no term limits the state, and shows a term it doesn't know as typed, last.
 * @param {string} query The search.
 * @returns {string} The words; "everything" for an empty search.
 */
export function summaryWords(query) {
  const words = [];
  let state = false;
  for (const token of tokenize(query)) {
    const term = parseTerm(token);
    if (!term.qualifier) {
      if (/^sort:/i.test(token)) continue;
      if (/^-?state:/i.test(token)) state = true;
      words.push({ rank: SUMMARY_ORDER.length, said: token });
      continue;
    }
    if (term.qualifier === "is" && /^(open|closed|merged|unmerged)$/i.test(term.value)) state = true;
    const said = termWords(term);
    if (said) words.push({ rank: SUMMARY_ORDER.indexOf(term.qualifier), said: term.negated ? `not ${said}` : said });
  }
  // "open and closed" sits where an is:open would.
  if (!state) words.push({ rank: SUMMARY_ORDER.indexOf("is"), said: "open and closed" });
  const unique = [...new Set(words.sort((one, other) => one.rank - other.rank).map((word) => word.said))];
  return unique.length ? unique.join(" · ") : "everything";
}

/**
 * Whether a made-up item matches a search, for the demo. Known terms are checked against the
 * item's fields; a term it doesn't know matches everything.
 * @param {{ kind: string, author?: string, isDraft?: boolean, assignees?: string[],
 *   reviewRequested?: string[], labels?: string[], type?: string | null, state?: string }} item The item.
 * @param {string} query The search.
 * @param {string} viewer The login `@me` stands for.
 * @returns {boolean}
 */
export function matchesSearch(item, query, viewer) {
  const who = (value) => (value.toLowerCase() === "@me" ? viewer : value).toLowerCase();
  const has = (list, value) => (list ?? []).some((entry) => entry.toLowerCase() === who(value));
  const anyOf = (list, value) => value.split(",").some((part) => has(list, unquote(part)));
  return tokenize(query).every((token) => {
    const term = parseTerm(token);
    if (!term.qualifier) return true;
    const value = term.value;
    const state = (item.state ?? "OPEN").toLowerCase();
    let hit = true;
    if (term.qualifier === "is") {
      const is = value.toLowerCase();
      if (is === "pr" || is === "issue") hit = item.kind === is;
      else if (is === "open" || is === "closed" || is === "merged") hit = state === is;
      else if (is === "draft") hit = Boolean(item.isDraft);
    } else if (term.qualifier === "author") hit = who(value) === (item.author ?? "").toLowerCase();
    else if (term.qualifier === "assignee") hit = has(item.assignees, value);
    else if (term.qualifier === "review-requested") hit = has(item.reviewRequested, value);
    else if (term.qualifier === "label") hit = anyOf(item.labels, value);
    else if (term.qualifier === "type") hit = anyOf(item.type ? [item.type] : [], value);
    else if (term.qualifier === "draft") hit = Boolean(item.isDraft) === (value.toLowerCase() === "true");
    return term.negated ? !hit : hit;
  });
}
