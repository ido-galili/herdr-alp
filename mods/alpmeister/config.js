// Alpmeister's settings: which of your repositories it looks at, and its workspaces. They live
// outside this repo, in ~/.config/alp/alpmeister.json, so no team's names ship with the mod.
// The Settings tab writes them; `alpmeister.example.json` beside this file shows every key.
//
//   account     your GitHub as a whole: the repos in scope, the Claude prompts, your local
//               clones, and the @me searches the Daypack lists
//   workspaces  a repository, a project board, or both, each with its own settings, such as
//               the searches behind its Open bugs and Triage bugs.
//               The Overview shows one at a time, or all your repos.
//   files       the Files editor's auto save (`autoSave`: "off", "afterDelay" or
//               "onFocusChange", as VS Code names them; `autoSaveDelay` in ms). alp-files reads it.
//
// A file in the earlier one-repo shape (top-level `repo` and `project`) reads as one workspace.

import { home, readTextFile } from "herdr";

export const DEFAULT_ISSUE_PROMPT = "Work on GitHub issue {repo}#{number}: read it, plan, then implement.";
export const DEFAULT_PR_PROMPT = "Review GitHub PR {repo}#{number} and summarize what needs attention.";

/** The Daypack cards' default searches, by the key `account.queries` keeps each under. */
export const DEFAULT_QUERIES = {
  review: "is:pr draft:false is:open review-requested:@me sort:updated-desc",
  mine: "is:issue is:open assignee:@me sort:updated-desc",
  myPrs: "is:pr is:open author:@me draft:false sort:updated-desc",
};

/**
 * A workspace's default searches: its open bugs and its triage bugs. The repository is added to
 * each when it runs. (A `queries.prs` an older file holds is kept as it is and not used.)
 */
export const WORKSPACE_QUERY_DEFAULTS = {
  bugs: "is:issue is:open type:Bug",
  triage: "is:issue is:open label:triage",
};

const ACCOUNT_DEFAULTS = {
  repos: "all",
  exclude: [],
  archived: false,
  launch: { issue: DEFAULT_ISSUE_PROMPT, pr: DEFAULT_PR_PROMPT },
  folders: {},
  queries: DEFAULT_QUERIES,
};

const WORKSPACE_DEFAULTS = {
  name: "",
  repo: null,
  board: null,
  statuses: ["New", "Todo", "In Progress", "In Review", "Done"],
  inFlight: { statuses: ["In Progress", "In Review"], excludeTypes: [] },
  mineHidden: ["New", "Done"],
  queries: { triage: WORKSPACE_QUERY_DEFAULTS.triage },
  bugs: {
    query: WORKSPACE_QUERY_DEFAULTS.bugs,
    priorityField: "Priority",
    priorities: ["Blocker", "Critical", "Major", "Minor"],
  },
  spotlight: {
    milestones: 2,
    labels: [],
    featureTypes: ["Epic", "Story", "Improvement"],
    holdStatus: "On Hold",
  },
  customer: { labelMatch: "customer" },
  boardView: { query: "iteration:@current", statuses: [] },
  nightly: null,
};

/** The Files editor's auto save choices, by the names VS Code's `files.autoSave` uses. */
export const AUTO_SAVE_MODES = ["off", "afterDelay", "onFocusChange"];

/** The shortest and longest auto save delay, in milliseconds. */
export const AUTO_SAVE_DELAY_RANGE = { min: 200, max: 60000 };

const FILES_DEFAULTS = { autoSave: "off", autoSaveDelay: 1000 };

const BOARD_DEFAULTS = { statusField: "Status", iterationField: "Iteration" };

/**
 * Where the settings file lives.
 * @returns {string} The absolute path of alpmeister.json.
 */
export const configPath = () => `${home()}/.config/alp/alpmeister.json`;

/**
 * Where Alpmeister keeps its own state: the last result and today's focus.
 * @returns {string} The absolute state folder.
 */
export const stateDir = () => `${home()}/.local/state/alp`;

/**
 * A path with a leading `~` made absolute.
 * @param {string | null | undefined} path A path, possibly starting with `~`.
 * @returns {string | null | undefined} The path with `~` replaced by the home folder.
 */
export const expandHome = (path) => (path?.startsWith("~") ? home() + path.slice(1) : path);

/**
 * A path under the home folder written with `~`, as the settings file keeps it.
 * @param {string} path An absolute path.
 * @returns {string} The same path, starting with `~` when it is under the home folder.
 */
export function tildePath(path) {
  const base = home();
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === base || trimmed.startsWith(`${base}/`) ? `~${trimmed.slice(base.length)}` : trimmed;
}

/** A deep copy of plain JSON data. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/** A list setting: the value when it is an array, else the fallback. */
const list = (value, fallback) => (Array.isArray(value) ? value : fallback);

/**
 * One workspace with every key filled in from the defaults.
 * @param {object} raw A workspace as the file holds it.
 * @returns {object} The workspace with defaults, `repo` checked and `board` filled.
 */
export function normalizeWorkspace(raw) {
  const base = copy(WORKSPACE_DEFAULTS);
  const repo = typeof raw.repo === "string" && /^[^/\s]+\/[^/\s]+$/.test(raw.repo) ? raw.repo : null;
  const board =
    raw.board?.owner && Number.isInteger(raw.board?.number) ? { ...BOARD_DEFAULTS, ...raw.board } : null;
  return {
    ...base,
    ...raw,
    name: String(raw.name ?? "").trim() || board?.title || repo?.split("/")[1] || "Workspace",
    repo,
    board,
    statuses: list(raw.statuses, base.statuses),
    inFlight: { ...base.inFlight, ...raw.inFlight },
    mineHidden: list(raw.mineHidden, base.mineHidden),
    queries: { ...base.queries, ...raw.queries },
    bugs: { ...base.bugs, ...raw.bugs },
    spotlight: { ...base.spotlight, ...raw.spotlight },
    customer: { ...base.customer, ...raw.customer },
    boardView: { ...base.boardView, ...raw.boardView, statuses: list(raw.boardView?.statuses, base.boardView.statuses) },
    nightly: raw.nightly?.workflow ? { branch: "main", events: ["schedule"], checks: [], ...raw.nightly } : null,
  };
}

/**
 * The account section with every key filled in from the defaults.
 * @param {object} raw The account section as the file holds it.
 * @returns {object} The account settings.
 */
export function normalizeAccount(raw) {
  const base = copy(ACCOUNT_DEFAULTS);
  return {
    ...base,
    ...raw,
    repos: Array.isArray(raw.repos) ? raw.repos : "all",
    exclude: list(raw.exclude, base.exclude),
    archived: Boolean(raw.archived),
    launch: { ...base.launch, ...raw.launch },
    folders: { ...base.folders, ...raw.folders },
    queries: { ...base.queries, ...raw.queries },
  };
}

/**
 * The Files section with every key filled in from the defaults: an unknown auto save choice
 * reads as off, and the delay is a whole number of milliseconds within AUTO_SAVE_DELAY_RANGE.
 * @param {object} raw The files section as the file holds it.
 * @returns {{ autoSave: string, autoSaveDelay: number }} The Files settings.
 */
export function normalizeFiles(raw) {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const autoSave = AUTO_SAVE_MODES.includes(given.autoSave) ? given.autoSave : FILES_DEFAULTS.autoSave;
  const delay = Math.round(Number(given.autoSaveDelay));
  const { min, max } = AUTO_SAVE_DELAY_RANGE;
  return {
    ...given,
    autoSave,
    autoSaveDelay: Number.isFinite(delay) && delay > 0 ? Math.min(max, Math.max(min, delay)) : FILES_DEFAULTS.autoSaveDelay,
  };
}

/**
 * Reads a file in the one-repo shape as the new one: its repository and board become one
 * workspace, `launch.folder` becomes that repository's folder, the @me searches move to the
 * account, and the triage search (and an old open PRs search, no longer used) stays with the workspace.
 * @param {object} raw The parsed file.
 * @returns {object} `{ account, workspaces }` as the file would hold them.
 */
function upgradeOneRepo(raw) {
  const { repo, project, launch = {}, queries = {}, files, ...rest } = raw;
  const { folder, ...prompts } = launch;
  const { triage, prs, review, mine, myPrs } = queries;
  const workspace = { ...rest, repo, queries: Object.fromEntries(Object.entries({ triage, prs }).filter(([, value]) => value)) };
  if (project?.owner && Number.isInteger(project?.number)) workspace.board = project;
  return {
    account: {
      repos: "all",
      launch: prompts,
      folders: folder && repo ? { [repo]: folder } : {},
      queries: Object.fromEntries(Object.entries({ review, mine, myPrs }).filter(([, value]) => value)),
    },
    workspaces: repo || workspace.board ? [workspace] : [],
  };
}

/**
 * The settings from parsed file contents, in the current shape with every default filled in.
 * @param {object} raw The parsed file, in either shape.
 * @returns {{ account: object, workspaces: object[], files: object }} The settings.
 */
export function normalizeConfig(raw) {
  const shaped = raw.repo || raw.project ? upgradeOneRepo(raw) : raw;
  const workspaces = list(shaped.workspaces, []).map(normalizeWorkspace);
  // Names key the Dashboard switch and the cache, so they stay unique.
  const seen = new Set();
  for (const workspace of workspaces) {
    let name = workspace.name;
    for (let n = 2; seen.has(name); n += 1) name = `${workspace.name} ${n}`;
    workspace.name = name;
    seen.add(name);
  }
  return { account: normalizeAccount(shaped.account ?? {}), workspaces, files: normalizeFiles(raw.files) };
}

/**
 * The settings file's contents with one Daypack card's search saved, or removed so the card
 * goes back to its default. Everything else stays as the file had it. A file in the one-repo
 * shape keeps the searches at its top level, so the search goes there.
 * @param {object} raw The parsed file.
 * @param {"review" | "myPrs" | "mine"} key The card's key in `account.queries`.
 * @param {string | null} query The search to save, or null to remove it.
 * @returns {object} A new object to write; `raw` is not changed.
 */
export function withCardFilter(raw, key, query) {
  const next = copy(raw ?? {});
  const oneRepo = Boolean(next.repo || next.project);
  const holder = oneRepo ? next : (next.account ??= {});
  const queries = { ...holder.queries };
  if (query === null) delete queries[key];
  else queries[key] = query;
  if (Object.keys(queries).length) holder.queries = queries;
  else delete holder.queries;
  return next;
}

/**
 * Team in flight's default filter, in the Board's syntax: the next milestone (the open one due
 * soonest), whichever that is today.
 */
export const IN_FLIGHT_DEFAULT = "milestone:@next";

/**
 * The searches a workspace's Overview cards filter by, with their defaults: Open bugs and Triage
 * bugs, the part of a label's name Customer issues counts, and Team in flight's filter.
 */
export const WORKSPACE_FILTER_DEFAULTS = { ...WORKSPACE_QUERY_DEFAULTS, customer: "customer", inFlight: IN_FLIGHT_DEFAULT };

/**
 * Where a workspace keeps each card's search: `bugs.query`, `queries.triage`,
 * `customer.labelMatch`, `inFlight.filter`.
 */
const WORKSPACE_FILTER_PATHS = {
  bugs: ["bugs", "query"],
  triage: ["queries", "triage"],
  customer: ["customer", "labelMatch"],
  inFlight: ["inFlight", "filter"],
};

/**
 * A workspace card's search, as the settings hold it.
 * @param {object} ws The normalized workspace.
 * @param {"bugs" | "triage" | "customer" | "inFlight"} key The card.
 * @returns {string} The search, or the default when none is set.
 */
export function workspaceFilter(ws, key) {
  const [section, field] = WORKSPACE_FILTER_PATHS[key];
  return ws[section]?.[field] ?? WORKSPACE_FILTER_DEFAULTS[key];
}

/**
 * A copy of a normalized workspace with one card's search changed, to fetch that card with.
 * @param {object} ws The normalized workspace.
 * @param {"bugs" | "triage" | "customer" | "inFlight"} key The card.
 * @param {string} value The search.
 * @returns {object} The copy; `ws` is not changed.
 */
export function withWorkspaceSearch(ws, key, value) {
  const [section, field] = WORKSPACE_FILTER_PATHS[key];
  return { ...ws, [section]: { ...ws[section], [field]: value } };
}

/**
 * The settings file's contents with one workspace card's search saved, or removed so the card
 * goes back to its default: the same keys Settings writes (`bugs.query`, `queries.triage`,
 * `customer.labelMatch`, `inFlight.filter`). Everything else stays as the file had it. A file in the
 * one-repo shape keeps its one workspace's keys at its top level.
 * @param {object} raw The parsed file.
 * @param {number} index The workspace's place in the file's `workspaces`.
 * @param {"bugs" | "triage" | "customer" | "inFlight"} key The card.
 * @param {string | null} value The search to save, or null to remove it.
 * @returns {object} A new object to write; `raw` is not changed.
 * @throws {Error} When the file has no workspace at that place.
 */
export function withWorkspaceFilter(raw, index, key, value) {
  const next = copy(raw ?? {});
  const holder = next.repo || next.project ? next : next.workspaces?.[index];
  if (!holder || typeof holder !== "object") throw new Error("That workspace is no longer in the settings file.");
  const [section, field] = WORKSPACE_FILTER_PATHS[key];
  const part = { ...holder[section] };
  if (value === null) delete part[field];
  else part[field] = value;
  if (Object.keys(part).length) holder[section] = part;
  else delete holder[section];
  return next;
}

/**
 * Reads the settings file. A missing file gives the defaults: every repository you can reach,
 * no workspaces. Resolves with `{ config, text }`, or `{ error, text }` when the file cannot be
 * read, so the view can say how to fix it. `text` is the file as read, for writing it back.
 * @returns {Promise<{ config?: object, error?: string, text: string | null }>}
 */
export async function loadConfig() {
  const text = await readTextFile(configPath());
  if (!text) return { config: normalizeConfig({}), text };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { error: `${configPath()} is not valid JSON: ${error}`, text };
  }
  return { config: normalizeConfig(raw ?? {}), text };
}

/**
 * The local clone of a repository, from the account's folders.
 * @param {object} config The settings.
 * @param {string | null} repo `owner/name`.
 * @returns {string} The absolute folder, or "" when none is set.
 */
export function folderOf(config, repo) {
  return (expandHome(config.account.folders[repo ?? ""]) ?? "").replace(/\/+$/, "");
}

/**
 * Whether a repository is in the account's scope.
 * @param {object} account The account settings.
 * @param {{ nameWithOwner: string, isArchived?: boolean }} repo The repository.
 * @returns {boolean} True when the Dashboard and Daypack include it.
 */
export function inScope(account, repo) {
  if (account.exclude.includes(repo.nameWithOwner)) return false;
  if (Array.isArray(account.repos)) return account.repos.includes(repo.nameWithOwner);
  return account.archived || !repo.isArchived;
}

/**
 * The workspace a project board belongs to, if any.
 * @param {object} config The settings.
 * @param {string} owner The board owner's login.
 * @param {number} number The board number.
 * @returns {object | null} The first workspace on that board.
 */
export function workspaceOfBoard(config, owner, number) {
  return config.workspaces.find((ws) => ws.board?.owner === owner && ws.board?.number === number) ?? null;
}
