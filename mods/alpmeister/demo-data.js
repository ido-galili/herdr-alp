// Made-up settings, GitHub data and a focus list for demos and screenshots, opened with
// `props.demo` on any Alpmeister tab:
//   herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"dashboard","demo":true}}'
// Three workspaces show every Dashboard layout: one with a repository and a board, one with a
// repository only, one with a board only. Between them they hold bugs at every priority, a
// failing nightly, a milestone that is late to start, issues on hold, cards in every status and
// iteration, and PRs in every review state. Nothing here calls GitHub or reads your files, and
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
 * An issue as a milestone or the spotlight lists it.
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
    card(WEB, 377, "Move images to the CDN", { status: "Done", iteration: current, assignees: [VIEWER], milestone: m24 }),
    card(WEB, 380, "Lighthouse budget in CI", { status: "Done", iteration: current, type: "Improvement", assignees: ["mara-v"] }),
  ];
  const bugs = { total: 14, read: 14, counts: { Blocker: 1, Critical: 3, Major: 6, Minor: 3, Unset: 1 } };
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
    bugs,
    customer: { labels: ["customer: acme-shop", "customer-reported"], count: 3, query: `repo:${WEB} is:issue is:open label:"customer-reported"` },
    boardView: { filter: boardFilter(ws), total: items.length, items, meta: meta(ws.statuses, its) },
    milestone: {
      title: m24,
      url: `https://github.com/${WEB}/milestone/12`,
      due: now + 5 * DAY,
      previousDue: now - 23 * DAY,
      total: 26,
      closed: 15,
      byStatus: { Done: 15, QA: 1, "In Review": 2, "In Progress": 4, Todo: 3, Backlog: 1 },
      unassigned: [v24[4]],
      notStarted: [v24[1], v24[4], issue(WEB, 423, "Currency switcher in the footer", { status: "Backlog" })],
    },
    spotlight: {
      milestones: [
        { title: m24, url: `https://github.com/${WEB}/milestone/12`, issues: v24 },
        { title: m25, url: `https://github.com/${WEB}/milestone/13`, issues: v25 },
      ],
      onHold: [{ ...issue(WEB, 414, "Apple Pay on the web", { status: "On Hold", type: "Story", assignees: ["tobi-s"] }), milestone: m25 }],
    },
    counts: { triage: 4 },
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
  const openPrs = [
    pr(CORE, 212, "Terminal: keep scrollback across reloads", { author: "lena-k", checks: "SUCCESS", reviewDecision: "APPROVED", ago: 2 * HOUR }),
    pr(CORE, 215, "hc: --json for every command", { author: VIEWER, checks: "PENDING", ago: 40 * MIN }),
    pr(CORE, 209, "Layouts: stacks remember their child", { author: "tobi-s", checks: "FAILURE", reviewDecision: "CHANGES_REQUESTED", ago: 26 * HOUR }),
    pr(CORE, 217, "WIP: remote machines over SSH", { author: "mara-v", isDraft: true, checks: null, ago: 3 * DAY }),
  ];
  return {
    fetchedAt: now,
    errors: {},
    queries: workspaceQueries(ws),
    nightly: null,
    bugs: { total: 5, read: 5, counts: { Blocker: 0, Critical: 1, Major: 2, Minor: 2, Unset: 0 } },
    customer: { labels: [], count: 0, query: null },
    boardView: null,
    milestone: {
      title: "0.2",
      url: `https://github.com/${CORE}/milestone/3`,
      due: now + 19 * DAY,
      previousDue: now - 11 * DAY,
      total: 12,
      closed: 4,
      byStatus: { Open: 8, Closed: 4 },
      unassigned: [],
      notStarted: [],
    },
    spotlight: {
      milestones: [
        {
          title: "0.2",
          url: `https://github.com/${CORE}/milestone/3`,
          issues: [
            issue(CORE, 188, "Remote machines", { type: "Epic", assignees: ["mara-v"], subIssues: { total: 7, completed: 2 } }),
            issue(CORE, 201, "Crash when a pane closes mid-resize", { type: "Bug", priority: "Critical", assignees: ["tobi-s"] }),
          ],
        },
      ],
      onHold: null,
    },
    counts: { triage: 1 },
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
    card(HORN, 58, "Pair a phone with a QR code", { status: "In Progress", iteration: current, type: "Story", assignees: [VIEWER] }),
    card(HORN, 63, "Reconnect after the phone sleeps", { status: "In Review", iteration: current, type: "Bug", assignees: ["tobi-s"], prs: [{ number: 64, reviewDecision: null }] }),
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
      milestone: null,
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
 * A repository's open milestones for the Board's card menu.
 * @param {string} repo `owner/name`.
 * @returns {{ id: string, title: string, dueOn: string | null }[]}
 */
export function demoMilestones(repo) {
  const now = Date.now();
  return repo === WEB
    ? [
        { id: "demo-ms-v2.4", title: "v2.4", dueOn: new Date(now + 5 * DAY).toISOString() },
        { id: "demo-ms-v2.5", title: "v2.5", dueOn: new Date(now + 33 * DAY).toISOString() },
      ]
    : [{ id: "demo-ms-0.2", title: "0.2", dueOn: new Date(now + 19 * DAY).toISOString() }];
}
