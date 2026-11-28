// A made-up herd for demos and screenshots, opened with `props.demo`:
//   herdr-app do tab.new '{"mod":"alpmeister","props":{"tab":"herds","demo":true}}'
// A release lead that messaged two sessions and made a worktree for a third, a session leading
// only its own agents, sessions and agents in every status, four sessions grazing alone,
// spread over four spaces, and three with no tab (one in the background). Nothing here reads
// Claude Code's files or Herdr's real tabs.

const MIN = 60000;

/** The demo spaces, in sidebar order: id, name and avatar color (as `space.colors` stores it). */
const SPACES = [
  { id: "demo-alp", name: "Alp", color: "ansi5" },
  { id: "demo-core", name: "Herdr core", color: "ansi6" },
  { id: "demo-web", name: "Website", color: "ansi3" },
  { id: "demo-horn", name: "Alphorn", color: "ansi2" },
];

/** The demo Claude tabs: terminal address, space id, title, status. */
const TABS = [
  ["demo-release", "demo-alp", "release-lead", "working"],
  ["demo-flaky", "demo-alp", "flaky-tests", "working"],
  ["demo-auth", "demo-core", "api-auth", "working"],
  ["demo-db", "demo-core", "db-migrations", "blocked"],
  ["demo-checkout", "demo-web", "checkout-ui", "blocked"],
  ["demo-perf", "demo-web", "perf-budget", "idle"],
  ["demo-pricing", "demo-web", "pricing-page", "done"],
  ["demo-docs", "demo-horn", "docs-sweep", "working"],
  ["demo-gateway", "demo-horn", "phone-gateway", "working"],
];

/**
 * The demo tabs, in the shape of herdr's `agents()`.
 * @returns {object[]}
 */
function demoAgents() {
  return TABS.map(([address, space, title, status], index) => ({
    address,
    pane: `pane-${address}`,
    space,
    space_name: SPACES.find((candidate) => candidate.id === space).name,
    tab: `tab-${address}`,
    tab_index: index,
    tab_name: "Claude Code",
    status,
    app: "claude-code",
    program: { key: "claude", name: "Claude Code" },
    title,
    pane_name: null,
    seq: index,
    pinned: false,
    focused: false,
  }));
}

/**
 * One agent, in the shape loadHerds() reports.
 * @param {object} spec `{ id, description, type, fork?, background?, parent?, age, doneAgo?, quiet? }`:
 *   `age` is minutes since it started, `doneAgo` minutes since it finished (unset while it runs),
 *   `quiet` an unfinished agent that has not stepped lately.
 * @param {number} now The time to measure from.
 * @returns {object}
 */
function agent(
  { id, description, type, fork = false, background = false, parent = null, age, doneAgo = null, quiet = false },
  now,
) {
  const finished = doneAgo !== null;
  return {
    id,
    description,
    type: fork ? "fork" : type,
    fork,
    background,
    model: null,
    finished,
    depth: parent ? 2 : 1,
    parent,
    startedAt: now - age * MIN,
    lastAt: finished ? now - doneAgo * MIN : now - (quiet ? 5 : 0.2) * MIN,
    status: finished ? "done" : quiet ? "idle" : "working",
  };
}

/**
 * One session, in the shape loadHerds() reports.
 * @param {string} id
 * @param {string} name
 * @param {string | null} terminal The demo tab it runs in, or null for none.
 * @param {string | null} branch
 * @param {string} status
 * @param {object[]} [agents] The agents it started.
 * @returns {object}
 */
function session(id, name, terminal, branch, status, agents = []) {
  return {
    id,
    name,
    names: [name],
    kind: "interactive",
    entrypoint: "cli",
    cwd: `/demo/${name}`,
    branch,
    terminal,
    linked: false,
    shownIn: false,
    viewer: false,
    status,
    agents,
  };
}

/**
 * The demo herd, in loadHerds()'s shape, plus `demo`: the tabs, spaces and space colors the
 * Herds tab draws it with instead of Herdr's own.
 * @returns {Promise<object>}
 */
export async function loadDemoHerds() {
  const now = Date.now();
  const a = (spec) => agent(spec, now);
  const sessions = [
    session("demo-s-release", "release-lead", "demo-release", "release/2.4", "working", [
      a({ id: "r1", description: "Draft the 2.4 changelog", type: "general-purpose", background: true, age: 9 }),
    ]),
    session("demo-s-auth", "api-auth", "demo-auth", "feat/oauth-refresh", "working", [
      a({ id: "u1", description: "Find token refresh call sites", type: "Explore", age: 6 }),
      a({ id: "u2", description: "Design the retry with backoff", type: "Plan", age: 18, doneAgo: 7 }),
    ]),
    session("demo-s-checkout", "checkout-ui", "demo-checkout", "fix/cart-totals", "blocked", [
      a({ id: "c1", description: "Try the CSS grid variant", type: "fork", fork: true, age: 4 }),
    ]),
    session("demo-s-flaky", "flaky-tests", "demo-flaky", "fix/flaky-e2e", "working", [
      a({ id: "f1", description: "Bisect the failing e2e run", type: "general-purpose", background: true, age: 11 }),
      a({ id: "f2", description: "Read the Playwright traces", type: "Explore", parent: "f1", age: 5 }),
    ]),
    session("demo-s-docs", "docs-sweep", "demo-docs", "docs/onboarding", "working", [
      a({ id: "d1", description: "Audit broken links", type: "Explore", age: 3 }),
      a({ id: "d2", description: "Collect CLI flag changes", type: "Explore", age: 3 }),
    ]),
    session("demo-s-perf", "perf-budget", "demo-perf", "perf/bundle-split", "idle"),
    session("demo-s-pricing", "pricing-page", "demo-pricing", "feat/pricing-v2", "done"),
    session("demo-s-gateway", "phone-gateway", "demo-gateway", "feat/gateway-ws", "working"),
    session("demo-s-db", "db-migrations", "demo-db", "chore/postgres-17", "blocked"),
    // Sessions with no tab: Cards folds them into "Background, no tab".
    { ...session("demo-s-triage", "nightly-triage", null, "main", "working"), kind: "bg" },
    session("demo-s-scratch", "projects-19", null, null, "idle"),
    { ...session("demo-s-desktop", "release-notes", null, null, "idle"), entrypoint: "claude-desktop" },
  ];
  const links = [
    { from: "demo-s-release", to: "demo-s-auth", kind: "message", at: now - 4 * MIN },
    { from: "demo-s-release", to: "demo-s-checkout", kind: "message", at: now - 2 * MIN },
    { from: "demo-s-release", to: "demo-s-flaky", kind: "worktree", at: now - 12 * MIN },
  ];
  return {
    sessions,
    links,
    agentFolders: [],
    loadedAt: now,
    demo: {
      agents: demoAgents(),
      spaces: SPACES.map(({ id, name }, index) => ({ id, index, name })),
      colors: Object.fromEntries(SPACES.map((space) => [space.id, space.color])),
    },
  };
}
