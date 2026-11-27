// Made-up settings, GitHub data and a focus list for demos and screenshots, opened with
// `props.demo` on any Alpmeister tab:
//   herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","demo":true}}'
// Three workspaces show every Dashboard layout: one with a repository and a board, one with a
// repository only, one with a board only. Between them they hold bugs at every priority, a
// failing nightly, milestones in every state (overdue, next and behind schedule, later, without a
// due date), issues on hold, cards in every status and iteration, and PRs in every review state. Nothing here calls GitHub or reads your files, and
// the demo writes nothing back: not the settings, not the cache, not today's focus.

import { normalizeConfig } from "./config.js";
import { MODEL_VERSION, boardFilter, workspaceQueries } from "./data.js";
import { today } from "./focus.js";
import { matchesSearch } from "./search-terms.js";
import { matchesBoard } from "./board-terms.js";

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ORG = "alpine-co";
const WEB = `${ORG}/website`;
const CORE = `${ORG}/herdr-core`;
const HORN = `${ORG}/alphorn`;
const VIEWER = "demo-lead";

/** The demo settings, in the file's shape. */
const RAW_CONFIG = {
  account: {
    repos: [WEB, CORE, HORN, `${ORG}/design-tokens`, `${ORG}/infra`],
    folders: { [WEB]: "~/code/website", [CORE]: "~/code/herdr-core" },
  },
  workspaces: [
    {
      name: "Website",
      repo: WEB,
      board: { owner: ORG, number: 4, title: "Website roadmap", statusField: "Status", iterationField: "Iteration" },
      statuses: ["Backlog", "Todo", "In Progress", "In Review", "QA", "Done", "On Hold"],
      notStarted: ["Backlog", "Todo"],
      inFlight: { statuses: ["In Progress", "In Review", "QA"], excludeTypes: ["Epic"] },
      mineHidden: ["Backlog", "Done", "On Hold"],
      boardView: { query: "iteration:@current", statuses: ["Todo", "In Progress", "In Review", "QA", "Done"] },
      queries: { triage: "is:issue is:open type:Bug label:triage" },
      bugs: { query: "is:issue is:open type:Bug", priorityField: "Priority", priorities: ["Blocker", "Critical", "Major", "Minor"] },
      spotlight: { milestones: 2, labels: ["product-prioritized"], featureTypes: ["Epic", "Story", "Improvement"], holdStatus: "On Hold" },
      customer: { labelMatch: "customer" },
      nightly: {
        workflow: "nightly.yml",
        branch: "main",
        events: ["schedule", "workflow_dispatch"],
        checks: [
          { name: "Deploy", exceptJobs: ["API Tests", "E2E Tests"] },
          { name: "Unit tests", job: "Build", step: "Unit Tests" },
          { name: "API tests", job: "API Tests" },
          { name: "E2E tests", job: "E2E Tests" },
        ],
      },
    },
    { name: "Herdr core", repo: CORE },
    {
      name: "Alphorn",
      board: { owner: ORG, number: 7, title: "Alphorn app", statusField: "Status", iterationField: "Iteration" },
      statuses: ["Todo", "In Progress", "In Review", "Done"],
      inFlight: { statuses: ["In Progress", "In Review"], excludeTypes: [] },
      boardView: { query: "", statuses: ["Todo", "In Progress", "In Review", "Done"] },
    },
  ],
};

/**
 * The demo settings, normalized as `loadConfig()` returns them.
 * @returns {{ config: object, text: string }} The settings and the file text they stand for.
 */
export function demoConfig() {
  return { config: normalizeConfig(RAW_CONFIG), text: `${JSON.stringify(RAW_CONFIG, null, 2)}\n` };
}

/**
 * A date as GitHub's iteration fields write it: "2026-11-23".
 * @param {number} at Milliseconds since the epoch.
 * @returns {string} The local date.
 */
function isoDate(at) {
  const date = new Date(at);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The demo iterations around now: two finished, the current one, and the next.
 * @param {number} now Milliseconds since the epoch.
 * @returns {{ id: string, title: string, startDate: string, duration: number, completed: boolean }[]}
 */
function iterations(now) {
  const start = now - 4 * DAY;
  return [22, 23, 24, 25].map((number, index) => ({
    id: `demo-it-${number}`,
    title: `Sprint ${number}`,
    startDate: isoDate(start + (index - 2) * 14 * DAY),
    duration: 14,
    completed: index < 2,
  }));
}

/**
 * A pull request row, as the account searches shape them.
 * @param {string} repo `owner/name`.
 * @param {number} number The PR number.
 * @param {string} title The PR title.
 * @param {object} more `author`, `reviewDecision`, `checks`, `isDraft`, `ago` (ms since its update),
 *   and for the Daypack's filters `labels` and `reviewRequested` (logins).
 * @returns {object} The row.
 */
function pr(
  repo,
  number,
  title,
  { author = VIEWER, reviewDecision = null, checks = "SUCCESS", isDraft = false, ago = HOUR, labels = [], reviewRequested = [] } = {},
) {
  return {
    kind: "pr",
    repo,
    number,
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    updatedAt: Date.now() - ago,
    author,
    isDraft,
    reviewDecision,
    checks,
    labels,
    reviewRequested,
  };
}

/**
 * An issue as the Milestone card lists it.
 * @param {string} repo `owner/name`.
 * @param {number} number The issue number.
 * @param {string} title The issue title.
 * @param {object} more `status`, `assignees` (logins), `type`, `labels`, `priority`, `closed`, `subIssues`.
 * @returns {object} The issue.
 */
function issue(repo, number, title, { status = null, assignees = [], type = "Task", labels = [], priority = null, closed = false, subIssues = { total: 0, completed: 0 } } = {}) {
  return { repo, number, title, url: `https://github.com/${repo}/issues/${number}`, closed, status, assignees, type, parent: null, labels, priority, subIssues };
}

/**
 * A milestone as the Milestone card shows it, in `workspaceMilestones()`'s shape.
 * @param {string} repo `owner/name`.
 * @param {number} number The milestone's number, for its URL.
 * @param {string} title Its title.
 * @param {object} more `due` and `start` (ms or null), `startFrom` (the milestone whose due date
 *   started it, or null for its creation), `total`, `closed`, `byStatus`, `issues`, `unassigned`,
 *   `notStarted`, `onHold`, and `now` to tell an overdue one.
 * @returns {object} The milestone.
 */
function milestone(repo, number, title, { due = null, start = null, startFrom = null, total, closed, byStatus, issues = [], unassigned = [], notStarted = [], onHold = null, now }) {
  const overdue = due != null && new Date(due).toISOString().slice(0, 10) < new Date(now).toISOString().slice(0, 10);
  return { title, url: `https://github.com/${repo}/milestone/${number}`, due, overdue, start, startFrom, total, closed, openCount: total - closed, byStatus, issues, unassigned, notStarted, onHold };
}

/**
 * A board card for the Board tab.
 * @param {string} repo `owner/name`.
 * @param {number} number The issue or PR number.
 * @param {string} title Its title.
 * @param {object} more `kind`, `status`, `iteration` (a demo iteration or null), `type`, `assignees` (logins), `milestone`, `reviewDecision`, `prs`.
 * @returns {object} The card.
 */
function card(repo, number, title, { kind = "issue", status, iteration = null, type = "Task", assignees = [], milestone = null, reviewDecision = null, prs = [] }) {
  return {
    kind,
    itemId: `demo-item-${repo}-${number}`,
    contentId: `demo-content-${repo}-${number}`,
    repo,
    number,
    title,
    url: `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${number}`,
    state: status === "Done" ? "CLOSED" : "OPEN",
    type: kind === "pr" ? null : type,
    status,
    iteration: iteration?.title ?? null,
    iterationId: iteration?.id ?? null,
    milestone: milestone ? { id: `demo-ms-${milestone}`, title: milestone } : null,
    assignees: assignees.map((login) => ({ login, avatar: null })),
    reviewDecision,
    prs,
  };
}

/**
 * The ids a Board move needs, for a demo board: moves only change what the demo shows.
 * @param {string[]} statuses The board's statuses.
 * @param {object[]} its The board's iterations.
 * @returns {object} The board's meta, in `loadBoardView()`'s shape.
 */
function meta(statuses, its) {
  return {
    projectId: "demo-project",
    status: { fieldId: "demo-status", options: Object.fromEntries(statuses.map((status) => [status, `demo-opt-${status}`])) },
    iteration: { fieldId: "demo-iteration", iterations: its },
  };
}

/**
 * Each demo repository's open issues, as `[number, type, priority, labels]`, for its Open bugs,
 * Triage bugs and Customer issues tiles: each tile counts those its search matches, so a filter
 * edited on a tile changes it.
 */
const REPO_ISSUES = {
  [WEB]: [
    [412, "Bug", "Blocker", ["backend", "customer-reported"]],
    [409, "Bug", "Critical", ["backend"]],
    [401, "Bug", "Critical", ["frontend", "triage"]],
    [421, "Bug", "Critical", ["frontend", "customer: acme-shop"]],
    [426, "Bug", "Major", ["frontend", "triage"]],
    [427, "Bug", "Major", ["backend"]],
    [429, "Bug", "Major", ["frontend"]],
    [430, "Bug", "Major", ["frontend", "customer-reported"]],
    [432, "Bug", "Major", ["backend", "triage"]],
    [434, "Bug", "Major", ["frontend"]],
    [437, "Bug", "Minor", ["frontend"]],
    [438, "Bug", "Minor", ["backend", "triage"]],
    [439, "Bug", "Minor", ["frontend"]],
    [441, "Bug", null, ["frontend"]],
    [418, "Improvement", null, ["frontend", "triage"]],
    [446, "Story", null, ["frontend"]],
    [448, "Task", null, ["backend", "triage"]],
    [452, "Task", null, ["backend"]],
  ],
  [CORE]: [
    [201, "Bug", "Critical", ["terminal"]],
    [203, "Bug", "Major", ["layouts", "triage"]],
    [206, "Bug", "Major", ["terminal"]],
    [207, "Bug", "Minor", ["docs"]],
    [210, "Bug", "Minor", ["layouts"]],
    [220, "Task", null, ["docs"]],
    [222, "Task", null, ["terminal", "good first issue"]],
  ],
};

/** Each demo repository's labels, for Customer issues: Herdr core has no customer label. */
const REPO_LABELS = {
  [WEB]: ["backend", "frontend", "triage", "customer: acme-shop", "customer-reported"],
  [CORE]: ["docs", "good first issue", "layouts", "terminal", "triage"],
};

/**
 * A demo repository's Open bugs, Triage bugs and Customer issues, from the workspace's searches,
 * as `loadWorkspace()` would count them: nothing is fetched.
 * @param {object} ws The normalized workspace.
 * @returns {{ bugs: object, triage: number, customer: object }} Open bugs by priority, the
 *   triage count, and the customer labels with their count and search.
 */
function repoTiles(ws) {
  const pool = (REPO_ISSUES[ws.repo] ?? []).map(([number, type, priority, labels]) => ({ kind: "issue", number, type, priority, labels }));
  const bugs = pool.filter((item) => matchesSearch(item, ws.bugs.query, VIEWER));
  const counts = Object.fromEntries([...ws.bugs.priorities, "Unset"].map((priority) => [priority, 0]));
  for (const bug of bugs) counts[ws.bugs.priorities.includes(bug.priority) ? bug.priority : "Unset"] += 1;
  const match = ws.customer.labelMatch.toLowerCase();
  const labels = (REPO_LABELS[ws.repo] ?? []).filter((label) => label.toLowerCase().includes(match));
  const customers = pool.filter((item) => item.labels.some((label) => labels.includes(label)));
  const query = labels.length ? `repo:${ws.repo} is:issue is:open label:${labels.map((label) => `"${label}"`).join(",")}` : null;
  return {
    bugs: { total: bugs.length, read: bugs.length, counts },
    triage: pool.filter((item) => matchesSearch(item, ws.queries.triage, VIEWER)).length,
    customer: { labels, count: customers.length, query },
  };
}

/**
 * The Website workspace: a repository with a board, every Dashboard part filled.
 * @param {object} ws The normalized workspace.
 * @param {number} now Milliseconds since the epoch.
 * @returns {object} The workspace's model.
 */
function website(ws, now) {
  const its = iterations(now);
  const [, previous, current] = its;
  const m24 = "v2.4";
  const m25 = "v2.5";
  const items = [
    card(WEB, 412, "Cart total rounds the wrong way for CHF", { status: "Todo", iteration: current, type: "Bug", assignees: ["tobi-s"], milestone: m24 }),
    card(WEB, 418, "Empty state for saved carts", { status: "Todo", iteration: current, assignees: [], milestone: m24 }),
    card(WEB, 421, "Price badges overlap on narrow screens", { status: "Todo", iteration: current, type: "Bug", assignees: ["lena-k"] }),
    card(WEB, 397, "Retry failed payment webhooks", { status: "In Progress", iteration: current, assignees: [VIEWER], milestone: m24, prs: [{ number: 431, reviewDecision: null }] }),
    card(WEB, 405, "Checkout: remember the last address", { status: "In Progress", iteration: current, type: "Story", assignees: ["mara-v", "tobi-s"], milestone: m24 }),
    card(WEB, 409, "Gateway drops idle sockets after 60s", { status: "In Progress", iteration: previous, type: "Bug", assignees: ["lena-k"], milestone: m24 }),
    card(WEB, 433, "Pricing page v2", { kind: "pr", status: "In Review", iteration: current, assignees: ["mara-v"], reviewDecision: "CHANGES_REQUESTED" }),
    card(WEB, 401, "Flaky checkout e2e on Safari", { status: "In Review", iteration: current, type: "Bug", assignees: ["tobi-s"], milestone: m24, prs: [{ number: 428, reviewDecision: "APPROVED" }] }),
    card(WEB, 389, "Onboarding copy pass", { status: "QA", iteration: current, assignees: ["lena-k"], milestone: m24 }),
    card(WEB, 447, "Gift card balance API", { status: "In Progress", iteration: current, assignees: ["tobi-s"], milestone: m25 }),
    card(WEB, 371, "3-D Secure fallback for old cards", { status: "In Review", iteration: previous, type: "Bug", assignees: ["lena-k"], milestone: "v2.3" }),
    card(WEB, 377, "Move images to the CDN", { status: "Done", iteration: current, assignees: [VIEWER], milestone: m24 }),
    card(WEB, 380, "Lighthouse budget in CI", { status: "Done", iteration: current, type: "Improvement", assignees: ["mara-v"] }),
  ];
  const tiles = repoTiles(ws);
  const inFlight = items
    .filter((item) => ws.inFlight.statuses.includes(item.status) && item.kind === "issue")
    .map((item, index) => ({
      repo: item.repo,
      number: item.number,
      title: item.title,
      url: item.url,
      status: item.status,
      since: now - (index + 1) * 19 * HOUR,
      iteration: item.iteration,
      assignees: item.assignees.map((person) => person.login),
      milestone: item.milestone?.title ?? null,
      prs: item.prs,
    }));
  const v24 = [
    issue(WEB, 397, "Retry failed payment webhooks", { status: "In Progress", assignees: [VIEWER], priority: "Critical" }),
    issue(WEB, 412, "Cart total rounds the wrong way for CHF", { status: "Todo", assignees: ["tobi-s"], type: "Bug", priority: "Blocker" }),
    issue(WEB, 405, "Checkout: remember the last address", { status: "In Progress", assignees: ["mara-v"], type: "Story", subIssues: { total: 5, completed: 3 } }),
    issue(WEB, 390, "Saved carts", { status: "In Progress", assignees: ["mara-v"], type: "Epic", labels: ["product-prioritized"], subIssues: { total: 8, completed: 5 } }),
    issue(WEB, 418, "Empty state for saved carts", { status: "Todo", type: "Improvement" }),
  ];
  const v25 = [
    issue(WEB, 440, "Gift cards", { status: "Backlog", type: "Epic", labels: ["product-prioritized"], subIssues: { total: 6, completed: 0 } }),
    issue(WEB, 446, "Store locator map", { status: "Todo", assignees: ["lena-k"], type: "Story" }),
  ];
  return {
    fetchedAt: now,
    errors: {},
    queries: workspaceQueries(ws),
    nightly: {
      overall: "failure",
      checks: [
        { name: "Deploy", outcome: "success" },
        { name: "Unit tests", outcome: "success" },
        { name: "API tests", outcome: "failed" },
        { name: "E2E tests", outcome: "running" },
      ],
      url: `https://github.com/${WEB}/actions`,
      at: now - 6 * HOUR,
    },
    bugs: tiles.bugs,
    customer: tiles.customer,
    boardView: { filter: boardFilter(ws), total: items.length, items, meta: meta(ws.statuses, its) },
    milestones: {
      next: m24,
      noMilestone: { count: 6 },
      list: [
        milestone(WEB, 11, "v2.3", {
          now,
          due: now - 9 * DAY,
          start: now - 30 * DAY,
          startFrom: "v2.2",
          total: 14,
          closed: 12,
          byStatus: { Done: 12, "In Review": 1, Todo: 1 },
          issues: [issue(WEB, 371, "3-D Secure fallback for old cards", { status: "In Review", assignees: ["lena-k"], type: "Bug", priority: "Major" })],
          notStarted: [issue(WEB, 368, "Receipt e-mails in German", { status: "Todo", assignees: ["mara-v"] })],
          onHold: [],
        }),
        milestone(WEB, 12, m24, {
          now,
          due: now + 5 * DAY,
          start: now - 9 * DAY,
          startFrom: "v2.3",
          total: 26,
          closed: 15,
          byStatus: { Done: 15, QA: 1, "In Review": 2, "In Progress": 4, Todo: 3, Backlog: 1 },
          issues: v24,
          unassigned: [v24[4]],
          notStarted: [v24[1], v24[4], issue(WEB, 423, "Currency switcher in the footer", { status: "Backlog", assignees: ["lena-k"] })],
          onHold: [],
        }),
        milestone(WEB, 13, m25, {
          now,
          due: now + 19 * DAY,
          start: now + 5 * DAY,
          startFrom: m24,
          total: 11,
          closed: 3,
          byStatus: { Backlog: 3, Todo: 4, "In Progress": 1, Done: 3 },
          issues: v25,
          unassigned: [v25[0], issue(WEB, 449, "Gift card terms page", { status: "Backlog" })],
          notStarted: [v25[0], v25[1]],
          onHold: [issue(WEB, 414, "Apple Pay on the web", { status: "On Hold", type: "Story", assignees: ["tobi-s"] })],
        }),
        milestone(WEB, 14, "v2.6", {
          now,
          start: now - 4 * DAY,
          total: 4,
          closed: 0,
          byStatus: { Backlog: 4 },
          issues: [issue(WEB, 455, "Wish lists", { status: "Backlog", type: "Epic", labels: ["product-prioritized"], subIssues: { total: 4, completed: 0 } })],
          unassigned: [issue(WEB, 455, "Wish lists", { status: "Backlog", type: "Epic" })],
          notStarted: [issue(WEB, 455, "Wish lists", { status: "Backlog", type: "Epic" })],
          onHold: [],
        }),
      ],
    },
    counts: { triage: tiles.triage },
    boardUrl: `https://github.com/orgs/${ORG}/projects/4`,
    iteration: { title: current.title, start: Date.parse(`${current.startDate}T00:00:00`), end: Date.parse(`${current.startDate}T00:00:00`) + 14 * DAY },
    inFlightTotal: inFlight.length,
    inFlight,
  };
}

/**
 * The Herdr core workspace: a repository only, so the Dashboard lists its open PRs.
 * @param {object} ws The normalized workspace.
 * @param {number} now Milliseconds since the epoch.
 * @returns {object} The workspace's model.
 */
function herdrCore(ws, now) {
  const tiles = repoTiles(ws);
  const allPrs = [
    pr(CORE, 212, "Terminal: keep scrollback across reloads", { author: "lena-k", checks: "SUCCESS", reviewDecision: "APPROVED", ago: 2 * HOUR }),
    pr(CORE, 215, "hc: --json for every command", { author: VIEWER, checks: "PENDING", ago: 40 * MIN }),
    pr(CORE, 209, "Layouts: stacks remember their child", { author: "tobi-s", checks: "FAILURE", reviewDecision: "CHANGES_REQUESTED", ago: 26 * HOUR }),
    pr(CORE, 217, "WIP: remote machines over SSH", { author: "mara-v", isDraft: true, checks: null, ago: 3 * DAY }),
  ];
  // The Open PRs card lists those its search matches, so a filter edited on it changes it.
  const openPrs = allPrs.filter((row) => matchesSearch(row, ws.queries.prs, VIEWER));
  return {
    fetchedAt: now,
    errors: {},
    queries: workspaceQueries(ws),
    nightly: null,
    bugs: tiles.bugs,
    customer: tiles.customer,
    boardView: null,
    milestones: {
      next: "0.2",
      noMilestone: { count: 3 },
      list: [
        milestone(CORE, 3, "0.2", {
          now,
          due: now + 19 * DAY,
          start: now - 11 * DAY,
          startFrom: "0.1",
          total: 12,
          closed: 4,
          byStatus: { Open: 8, Closed: 4 },
          issues: [
            issue(CORE, 188, "Remote machines", { type: "Epic", assignees: ["mara-v"], subIssues: { total: 7, completed: 2 } }),
            issue(CORE, 201, "Crash when a pane closes mid-resize", { type: "Bug", priority: "Critical", assignees: ["tobi-s"] }),
          ],
        }),
        milestone(CORE, 4, "0.3", {
          now,
          start: now - 2 * DAY,
          total: 5,
          closed: 0,
          byStatus: { Open: 5 },
          issues: [issue(CORE, 230, "Plugins from a registry", { type: "Epic", subIssues: { total: 5, completed: 0 } })],
          unassigned: [issue(CORE, 230, "Plugins from a registry", { type: "Epic" })],
        }),
      ],
    },
    counts: { triage: tiles.triage },
    openPrsTotal: openPrs.length,
    openPrs,
  };
}

/**
 * The Alphorn workspace: a board only, so the Dashboard shows its items in flight.
 * @param {object} ws The normalized workspace.
 * @param {number} now Milliseconds since the epoch.
 * @returns {object} The workspace's model.
 */
function alphorn(ws, now) {
  const its = iterations(now);
  const current = its[2];
  const items = [
    card(HORN, 61, "Push notifications for Needs you", { status: "Todo", iteration: current, type: "Story", assignees: ["lena-k"] }),
    card(HORN, 58, "Pair a phone with a QR code", { status: "In Progress", iteration: current, type: "Story", assignees: [VIEWER], milestone: "1.0" }),
    card(HORN, 63, "Reconnect after the phone sleeps", { status: "In Review", iteration: current, type: "Bug", assignees: ["tobi-s"], prs: [{ number: 64, reviewDecision: null }], milestone: "1.0" }),
    card(HORN, 55, "Read a terminal's last 200 lines", { status: "Done", iteration: current, assignees: [VIEWER] }),
  ];
  const inFlight = items
    .filter((item) => ws.inFlight.statuses.includes(item.status))
    .map((item, index) => ({
      repo: item.repo,
      number: item.number,
      title: item.title,
      url: item.url,
      status: item.status,
      since: now - (index + 2) * 7 * HOUR,
      iteration: item.iteration,
      assignees: item.assignees.map((person) => person.login),
      milestone: item.milestone?.title ?? null,
      prs: item.prs,
    }));
  return {
    fetchedAt: now,
    errors: {},
    queries: workspaceQueries(ws),
    nightly: null,
    bugs: null,
    customer: null,
    boardView: { filter: boardFilter(ws), total: items.length, items, meta: meta(ws.statuses, its) },
    boardUrl: `https://github.com/orgs/${ORG}/projects/7`,
    iteration: { title: current.title, start: Date.parse(`${current.startDate}T00:00:00`), end: Date.parse(`${current.startDate}T00:00:00`) + 14 * DAY },
    inFlightTotal: inFlight.length,
    inFlight,
  };
}

/**
 * The account: repositories in scope, your review requests, your PRs and your issues.
 * @param {object} config The demo settings.
 * @param {number} now Milliseconds since the epoch.
 * @returns {object} The account's model.
 */
function account(config, now) {
  const sprint = iterations(now)[2].title;
  const me = [VIEWER];
  // Every made-up PR and issue the Daypack's searches pick from: each card shows those its
  // search matches, so an edited filter filters them too.
  const prs = [
    pr(WEB, 433, "Pricing page v2", { author: "mara-v", reviewDecision: "CHANGES_REQUESTED", checks: "SUCCESS", ago: 35 * MIN, labels: ["frontend"], reviewRequested: me }),
    pr(CORE, 212, "Terminal: keep scrollback across reloads", { author: "lena-k", reviewDecision: "REVIEW_REQUIRED", checks: "SUCCESS", ago: 2 * HOUR, labels: ["backend"], reviewRequested: me }),
    pr(HORN, 64, "Reconnect after the phone sleeps", { author: "tobi-s", checks: "PENDING", ago: 5 * HOUR, labels: ["backend"], reviewRequested: me }),
    pr(WEB, 436, "WIP: one-page checkout", { author: "tobi-s", isDraft: true, checks: null, ago: 7 * HOUR, labels: ["frontend"], reviewRequested: me }),
    pr(WEB, 431, "Retry failed payment webhooks", { reviewDecision: "APPROVED", checks: "SUCCESS", ago: 20 * MIN, labels: ["backend"] }),
    pr(CORE, 215, "hc: --json for every command", { checks: "PENDING", ago: 40 * MIN, labels: ["backend"] }),
    pr(WEB, 425, "Bump the image CDN client", { reviewDecision: "CHANGES_REQUESTED", checks: "FAILURE", ago: DAY, labels: ["frontend"] }),
    pr(HORN, 66, "WIP: dark mode", { isDraft: true, checks: null, ago: 2 * DAY, labels: ["frontend"] }),
  ];
  const issues = [
    { repo: WEB, number: 397, title: "Retry failed payment webhooks", workspace: "Website", status: "In Progress", iteration: sprint, milestone: "v2.4", type: "Task", labels: ["backend"] },
    { repo: HORN, number: 58, title: "Pair a phone with a QR code", workspace: "Alphorn", status: "In Progress", iteration: sprint, milestone: null, type: "Story", labels: ["frontend"] },
    { repo: WEB, number: 377, title: "Move images to the CDN", workspace: "Website", status: "Done", iteration: sprint, milestone: "v2.4", type: "Task", labels: ["frontend"] },
    { repo: WEB, number: 452, title: "Spike: server-side cart", workspace: "Website", status: "Todo", iteration: sprint, milestone: "v2.5", type: "Task", labels: ["backend"] },
    { repo: CORE, number: 220, title: "Document the mod API", workspace: null, status: null, iteration: null, milestone: "0.2", type: "Task", labels: ["docs"] },
    { repo: WEB, number: 412, title: "Cart rounds CHF wrong", workspace: "Website", status: "Todo", iteration: sprint, milestone: "v2.4", type: "Bug", labels: ["backend"], assignees: ["tobi-s"] },
  ].map((row, index) => ({
    kind: "issue",
    url: `https://github.com/${row.repo}/issues/${row.number}`,
    updatedAt: now - (index + 1) * 3 * HOUR,
    assignees: me,
    ...row,
  }));
  const { queries } = config.account;
  const pool = [...prs, ...issues];
  const reviews = demoSearch(pool, queries.review);
  const myPrs = demoSearch(pool, queries.myPrs);
  const mine = demoSearch(pool, queries.mine);
  const repos = [
    { repo: WEB, isPrivate: false, issues: 38, prs: 6, checks: "SUCCESS", pushedAt: now - 20 * MIN },
    { repo: CORE, isPrivate: false, issues: 21, prs: 4, checks: "FAILURE", pushedAt: now - 2 * HOUR },
    { repo: HORN, isPrivate: true, issues: 9, prs: 1, checks: "PENDING", pushedAt: now - 5 * HOUR },
    { repo: `${ORG}/design-tokens`, isPrivate: false, issues: 2, prs: 0, checks: "SUCCESS", pushedAt: now - 9 * DAY },
    { repo: `${ORG}/infra`, isPrivate: true, issues: 0, prs: 0, checks: null, pushedAt: now - 120 * DAY },
  ].map((row) => ({ url: `https://github.com/${row.repo}`, isArchived: false, branch: "main", ...row }));
  return {
    viewer: VIEWER,
    reposTotal: repos.length,
    repos,
    reviews,
    myPrs,
    mine,
    counts: { reviews: reviews.length, myPrs: myPrs.length, mine: mine.length },
    redRepos: repos.filter((repo) => repo.checks === "FAILURE").length,
    redPrs: myPrs.filter((row) => row.checks === "FAILURE").length,
    queries: { ...config.account.queries },
    pool,
  };
}

/**
 * The made-up PRs and issues a search matches, for one Daypack card.
 * @param {object[]} pool Every made-up PR and issue.
 * @param {string} query The card's search.
 * @returns {object[]} The matching ones.
 */
const demoSearch = (pool, query) => pool.filter((item) => matchesSearch(item, query, VIEWER));

/**
 * One Daypack card filtered again with another search, in the demo: `loadCardSearch()` on the
 * made-up data. Nothing is fetched.
 * @param {object} account The demo account's model.
 * @param {"review" | "myPrs" | "mine"} key The card's search.
 * @param {string} query The search.
 * @returns {object} The account's model with that card's rows, count and search.
 */
export function demoCardSearch(account, key, query) {
  const list = { review: "reviews", myPrs: "myPrs", mine: "mine" }[key];
  const rows = demoSearch(account.pool ?? [], query);
  const next = { ...account, [list]: rows, counts: { ...account.counts, [list]: rows.length }, queries: { ...account.queries, [key]: query } };
  if (key === "myPrs") next.redPrs = rows.filter((row) => row.checks === "FAILURE").length;
  return next;
}

/** Each demo workspace's model, by its name. */
const WORKSPACES = { Website: website, "Herdr core": herdrCore, Alphorn: alphorn };

/**
 * One of a demo workspace's Overview cards counted again with another search, in the demo:
 * `loadWorkspaceCard()` on the made-up data. Nothing is fetched.
 * @param {object} ws The normalized workspace, with the card's edited search in place.
 * @param {object} model The workspace's model.
 * @param {"bugs" | "triage" | "customer" | "prs"} key The card.
 * @returns {object} The workspace's model with that card's result and searches.
 */
export function demoWorkspaceCard(ws, model, key) {
  const fresh = WORKSPACES[ws.name]?.(ws, Date.now());
  if (!fresh) return model;
  const next = { ...model, queries: fresh.queries };
  if (key === "bugs") next.bugs = fresh.bugs;
  if (key === "triage") next.counts = { ...model.counts, triage: fresh.counts?.triage };
  if (key === "customer") next.customer = fresh.customer;
  if (key === "prs") Object.assign(next, { openPrs: fresh.openPrs, openPrsTotal: fresh.openPrsTotal });
  return next;
}

/**
 * A demo workspace's model with its board's cards filtered by the workspace's Board filter, as
 * GitHub would: `loadBoardView()` on the made-up cards.
 * @param {object} model The workspace's model, as built.
 * @param {object} ws The normalized workspace.
 * @returns {object} The model, its `boardView` holding only the matching cards.
 */
function filteredBoard(model, ws) {
  if (!model.boardView) return model;
  const filter = boardFilter(ws);
  const context = { viewer: VIEWER, iteration: model.iteration?.title ?? null };
  const items = model.boardView.items.filter((item) => matchesBoard(item, filter, context));
  return { ...model, boardView: { ...model.boardView, filter, total: items.length, items } };
}

/**
 * A demo workspace's board with another filter, for a filter applied on the Board: nothing is
 * fetched, the made-up cards are filtered again, and a move made earlier is not kept.
 * @param {object} ws The normalized workspace, with the filter in `boardView`.
 * @returns {object | null} The board, in `loadBoardView()`'s shape; null for a workspace without one.
 */
export function demoBoardView(ws) {
  const build = WORKSPACES[ws.name];
  return build ? (filteredBoard(build(ws, Date.now()), ws).boardView ?? null) : null;
}

/**
 * The whole demo model, in `loadAll()`'s shape.
 * @param {object} config The demo settings, from `demoConfig()`.
 * @returns {object} `{ version, fetchedAt, account, workspaces, errors }`.
 */
export function demoModel(config) {
  const now = Date.now();
  return {
    version: MODEL_VERSION,
    fetchedAt: now,
    errors: {},
    account: account(config, now),
    workspaces: Object.fromEntries(
      config.workspaces.map((ws) => [ws.name, WORKSPACES[ws.name] ? filteredBoard(WORKSPACES[ws.name](ws, now), ws) : { fetchedAt: now, errors: {} }]),
    ),
  };
}

/**
 * Today's focus in the demo: pinned issues and PRs in different states, and todos, one done and
 * one carried over from earlier days.
 * @returns {object[]} Focus items, in `focus.json`'s shape.
 */
export function demoFocus() {
  const earlier = isoDate(Date.now() - 3 * DAY);
  return [
    { id: `issue-${WEB}#397`, kind: "issue", repo: WEB, number: 397, title: "Retry failed payment webhooks", url: `https://github.com/${WEB}/issues/397`, status: "In Progress", done: false, added: today() },
    { id: `pr-${WEB}#433`, kind: "pr", repo: WEB, number: 433, title: "Pricing page v2", url: `https://github.com/${WEB}/pull/433`, review: "CHANGES_REQUESTED", done: false, added: today() },
    { id: `pr-${CORE}#212`, kind: "pr", repo: CORE, number: 212, title: "Terminal: keep scrollback across reloads", url: `https://github.com/${CORE}/pull/212`, review: "APPROVED", state: "MERGED", done: true, added: today() },
    { id: "todo-demo-1", kind: "todo", text: "Write the 2.4 release notes", done: false, added: earlier },
    { id: "todo-demo-2", kind: "todo", text: "1:1 with Lena about the gateway", done: true, added: today() },
  ];
}

/**
 * What the Settings form reads from GitHub and the disk, for the demo: your repositories and
 * boards, each repository's details, each board's fields, and your clones.
 * @param {object} config The demo settings.
 * @returns {{ discovery: object, details: object, fields: object, clones: object }}
 */
export function demoDiscovery(config) {
  const boards = [
    { owner: ORG, number: 4, title: "Website roadmap", closed: false, key: `${ORG}#4` },
    { owner: ORG, number: 7, title: "Alphorn app", closed: false, key: `${ORG}#7` },
    { owner: ORG, number: 2, title: "Ops (archived)", closed: true, key: `${ORG}#2` },
  ];
  const repos = config.account.repos.map((repo) => ({ repo, isArchived: false, isPrivate: repo.endsWith("infra"), isFork: false, branch: "main" }));
  const workflows = [
    { name: "CI", file: "ci.yml" },
    { name: "Nightly", file: "nightly.yml" },
  ];
  const fieldsOf = (ws) => ({
    title: ws.board.title,
    selects: [
      { name: "Status", options: ws.statuses },
      { name: "Priority", options: ["Blocker", "Critical", "Major", "Minor"] },
    ],
    iterations: ["Iteration"],
  });
  return {
    discovery: { login: VIEWER, repos, boards, warning: null },
    details: Object.fromEntries(
      config.workspaces.filter((ws) => ws.repo).map((ws) => [ws.repo, { boards: ws.board ? [boards.find((board) => board.number === ws.board.number)] : [], branch: "main", workflows }]),
    ),
    fields: Object.fromEntries(config.workspaces.filter((ws) => ws.board).map((ws) => [`${ws.board.owner}#${ws.board.number}`, fieldsOf(ws)])),
    clones: { [WEB]: "~/code/website", [CORE]: "~/code/herdr-core", [HORN]: "~/code/alphorn" },
  };
}

/**
 * A demo workspace's open issues without a milestone, for the Milestone card's "No milestone",
 * in `loadNoMilestone()`'s shape.
 * @param {object} ws The normalized workspace.
 * @returns {object} The card's parts, with `openCount`.
 */
export function demoNoMilestone(ws) {
  if (ws.repo === CORE) {
    return {
      openCount: 3,
      byStatus: { Open: 3 },
      unassigned: [issue(CORE, 240, "Typo in the hc help")],
      notStarted: [],
      open: [],
      issues: [issue(CORE, 236, "Wayland: drag a tab to another window", { type: "Bug", priority: "Minor", assignees: ["lena-k"] })],
      onHold: null,
    };
  }
  const issues = [
    issue(WEB, 421, "Price badges overlap on narrow screens", { status: "Todo", type: "Bug", priority: "Major", assignees: ["lena-k"] }),
    issue(WEB, 430, "Dark mode for the account pages", { status: "Backlog", type: "Story" }),
    issue(WEB, 452, "Spike: server-side cart", { status: "Todo", assignees: [VIEWER] }),
  ];
  return {
    openCount: 6,
    byStatus: { Backlog: 3, Todo: 2, "On Hold": 1 },
    unassigned: [issues[1], issue(WEB, 436, "Footer links audit", { status: "Backlog" })],
    notStarted: [issues[0], issues[1], issues[2]],
    open: [],
    issues: issues.slice(0, 2),
    onHold: [issue(WEB, 427, "Klarna payments", { status: "On Hold", type: "Story", assignees: ["mara-v"] })],
  };
}

/**
 * A repository's open milestones for the Board's card menu.
 * @param {string} repo `owner/name`.
 * @returns {{ id: string, title: string, dueOn: string | null }[]}
 */
export function demoMilestones(repo) {
  const now = Date.now();
  return repo === WEB
    ? [
        { id: "demo-ms-v2.3", title: "v2.3", dueOn: new Date(now - 9 * DAY).toISOString() },
        { id: "demo-ms-v2.4", title: "v2.4", dueOn: new Date(now + 5 * DAY).toISOString() },
        { id: "demo-ms-v2.5", title: "v2.5", dueOn: new Date(now + 19 * DAY).toISOString() },
        { id: "demo-ms-v2.6", title: "v2.6", dueOn: null },
      ]
    : repo === CORE
      ? [
          { id: "demo-ms-0.2", title: "0.2", dueOn: new Date(now + 19 * DAY).toISOString() },
          { id: "demo-ms-0.3", title: "0.3", dueOn: null },
        ]
      : [{ id: "demo-ms-1.0", title: "1.0", dueOn: null }];
}
