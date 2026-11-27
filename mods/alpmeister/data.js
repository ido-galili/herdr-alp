// Fetches Alpmeister's data through the `gh` CLI and shapes it for the widgets.
// Read-only: nothing here writes to GitHub.
//
// Two kinds of load: the account (every repository in scope and the @me searches, for the
// "All repos" Dashboard and the Daypack) and one workspace (its repository, its board, or both).

import { exec } from "herdr";
import { inScope, workspaceOfBoard } from "./config.js";
import {
  ACCOUNT,
  ACCOUNT_SEARCHES,
  BOARD_VIEW_PAGE,
  BUGS_PAGE,
  CUSTOMER_LABELS,
  ISSUE_COUNT,
  OPEN_PRS,
  WORKSPACE_BOARD,
  WORKSPACE_REPO,
  pickStates,
} from "./queries.js";

const DAY = 86400000;
const BUG_PAGES = 10;
const BOARD_VIEW_PAGES = 5;
const FAILED_CONCLUSIONS = ["failure", "timed_out", "startup_failure"];

/** The cache format: a cache written by another version is ignored. */
export const MODEL_VERSION = 2;

/**
 * Runs `gh` with the given arguments and parses its JSON output.
 * @param {string[]} args The arguments after `gh`.
 * @returns {Promise<any>} The parsed output.
 * @throws {Error} With gh's message when it exits non-zero.
 */
export async function gh(args) {
  const result = await exec("gh", args, { timeout: 60000 });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || `gh exited ${result.code}`).trim());
  return JSON.parse(result.stdout);
}

/**
 * Runs a GraphQL document with string and integer variables.
 * @param {string} query The document.
 * @param {Record<string, string | number>} [variables] Its variables.
 * @param {{ partial?: boolean }} [options] `partial`: return what came back despite errors.
 * @returns {Promise<any>} The `data` of the response.
 * @throws {Error} With GitHub's messages, unless `partial` and some data came back.
 */
export async function graphql(query, variables = {}, { partial = false } = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  // gh exits non-zero when the response has errors, but still prints the body on stdout.
  const result = await exec("gh", args, { timeout: 60000 });
  let body = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    // Not JSON: gh failed before GitHub answered.
  }
  if (!body) throw new Error((result.stderr || result.stdout || `gh exited ${result.code}`).trim());
  if (body.errors?.length && !(partial && body.data)) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body.data;
}

/** A board filter or search value list: `name:"A","B"`. */
const valueList = (qualifier, values) => `${qualifier}:${values.map((value) => `"${value}"`).join(",")}`;

/**
 * The GitHub page listing a search's results.
 * @param {string | null} repo `owner/name` for that repository's issues page, or null for all of GitHub.
 * @param {string} query The search.
 * @returns {string} The URL.
 */
export const searchUrl = (repo, query) =>
  repo
    ? `https://github.com/${repo}/issues?q=${encodeURIComponent(query)}`
    : `https://github.com/search?type=issues&q=${encodeURIComponent(query)}`;

/**
 * Every search a workspace runs, scoped to its repository. Open PRs (`queries.prs`) is sorted by
 * the last update unless it names a sort of its own.
 * @param {object} ws The workspace.
 * @returns {Record<string, string>} The searches by name; repository searches are absent without a repository.
 */
export function workspaceQueries(ws) {
  const repo = ws.repo ? `repo:${ws.repo}` : "";
  const inFlightParts = [repo, "is:issue", "is:open", valueList("status", ws.inFlight.statuses)].filter(Boolean);
  if (ws.inFlight.excludeTypes.length) inFlightParts.push(valueList("-type", ws.inFlight.excludeTypes));
  if (!ws.repo) return { inFlightFilter: inFlightParts.join(" ") };
  return {
    inFlightFilter: inFlightParts.join(" "),
    triageQuery: `${repo} ${ws.queries.triage}`,
    bugsQuery: `${repo} ${ws.bugs.query}`,
    prsQuery: `${repo} ${ws.queries.prs}${/(^|\s)sort:/.test(ws.queries.prs) ? "" : " sort:updated-desc"}`,
  };
}

/**
 * Open bugs counted by the priority issue field, in the configured order, then "Unset" for a
 * missing or unknown value. Reads at most BUG_PAGES pages of 100.
 * @param {object} ws The workspace.
 * @param {string} bugsQuery The bugs search.
 * @returns {Promise<{ total: number, read: number, counts: Record<string, number> }>}
 */
async function bugsByPriority(ws, bugsQuery) {
  const counts = Object.fromEntries([...ws.bugs.priorities, "Unset"].map((priority) => [priority, 0]));
  let after = null;
  let total = 0;
  let read = 0;
  for (let page = 0; page < BUG_PAGES; page += 1) {
    const search = (await graphql(BUGS_PAGE, after ? { bugsQuery, after } : { bugsQuery })).search;
    total = search.issueCount;
    for (const issue of search.nodes) {
      const value = priorityOf(ws, issue);
      counts[value in counts && value !== "Unset" ? value : "Unset"] += 1;
      read += 1;
    }
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return { total, read, counts };
}

/** The board item of an issue on the workspace's board, or null. */
function boardItem(ws, issue) {
  if (!ws.board) return null;
  return (
    issue.projectItems?.nodes?.find(
      (item) => item.project?.number === ws.board.number && item.project?.owner?.login === ws.board.owner,
    ) ?? null
  );
}

/**
 * An issue's status and iteration, from the first of its boards that a workspace is set up for.
 * Reads the generic field values the account queries return.
 * @param {object} config The settings.
 * @param {object} issue An issue with `projectItems.nodes[].fieldValues`.
 * @returns {{ ws: object | null, status: string | null, iteration: string | null }}
 */
export function standingOnBoards(config, issue) {
  for (const item of issue.projectItems?.nodes ?? []) {
    const ws = workspaceOfBoard(config, item.project?.owner?.login, item.project?.number);
    if (!ws) continue;
    const values = item.fieldValues?.nodes ?? [];
    const status = values.find((value) => value.field?.name === ws.board.statusField && "name" in value);
    const iteration = values.find((value) => value.field?.name === ws.board.iterationField && "title" in value);
    return { ws, status: status?.name ?? null, iteration: iteration?.title ?? null };
  }
  return { ws: null, status: null, iteration: null };
}

/** The iteration whose dates contain `now`, or null. */
function currentIteration(iterations, now) {
  for (const iteration of iterations ?? []) {
    const start = Date.parse(`${iteration.startDate}T00:00:00`);
    const end = start + iteration.duration * DAY;
    if (now >= start && now < end) return { title: iteration.title, start, end };
  }
  return null;
}

/** An issue's value for the configured priority field, or null. */
function priorityOf(ws, issue) {
  return issue.issueFieldValues?.nodes?.find((field) => field.field?.name === ws.bugs.priorityField)?.name ?? null;
}

/** A milestone's issue, shaped for the milestone card and the spotlight card. */
function milestoneIssue(ws, issue) {
  return {
    repo: ws.repo,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    closed: issue.state === "CLOSED",
    status: boardItem(ws, issue)?.status?.name ?? null,
    assignees: issue.assignees.nodes.map((assignee) => assignee.login),
    type: issue.issueType?.name ?? null,
    parent: issue.parent ?? null,
    labels: issue.labels?.nodes?.map((label) => label.name) ?? [],
    priority: priorityOf(ws, issue),
    subIssues: issue.subIssuesSummary ?? { total: 0, completed: 0 },
  };
}

/** The open milestones whose due date has not passed, soonest first. */
function upcomingMilestones(repository, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  return repository.open.nodes.filter((milestone) => milestone.dueOn && milestone.dueOn.slice(0, 10) >= today);
}

/**
 * One milestone's spotlight: its open issues that have a priority value or a configured label,
 * or a feature type. Most urgent first, then by feature type. Issues on hold are left out.
 */
function milestoneSpotlight(ws, milestone, issues) {
  const settings = ws.spotlight;
  const levels = ws.bugs.priorities;
  const types = settings.featureTypes;
  const rank = (issue) => (levels.includes(issue.priority) ? levels.indexOf(issue.priority) : levels.length);
  const typeRank = (issue) => (types.includes(issue.type) ? types.indexOf(issue.type) : types.length);
  const isPrioritized = (issue) =>
    Boolean(issue.priority) || issue.labels.some((label) => settings.labels.includes(label));
  const shown = issues
    .filter((issue) => !issue.closed && issue.status !== settings.holdStatus)
    .filter((issue) => isPrioritized(issue) || types.includes(issue.type))
    .sort(
      (first, second) =>
        rank(first) - rank(second) || typeRank(first) - typeRank(second) || first.number - second.number,
    );
  return { title: milestone.title, url: milestone.url, issues: shown };
}

/** The spotlight card: the next milestones' issues in focus, and their issues on hold. */
function spotlight(ws, upcoming) {
  const milestones = upcoming.slice(0, ws.spotlight.milestones).map((milestone) => ({
    milestone,
    issues: milestone.issues.nodes.map((issue) => milestoneIssue(ws, issue)),
  }));
  return {
    milestones: milestones.map(({ milestone, issues }) => milestoneSpotlight(ws, milestone, issues)),
    onHold: ws.board
      ? milestones.flatMap(({ milestone, issues }) =>
          issues
            .filter((issue) => !issue.closed && issue.status === ws.spotlight.holdStatus)
            .map((issue) => ({ ...issue, milestone: milestone.title })),
        )
      : null,
  };
}

/**
 * The next milestone, with its breakdown: by board status with a board, else open and closed.
 */
function nextMilestone(ws, repository, next) {
  if (!next) return null;
  const earlierDues = [...repository.open.nodes, ...repository.closed.nodes]
    .map((milestone) => milestone.dueOn)
    .filter((due) => due && due < next.dueOn)
    .sort();
  const issues = next.issues.nodes.map((issue) => milestoneIssue(ws, issue));
  const byStatus = {};
  const bucket = (issue) => (ws.board ? (issue.status ?? "No status") : issue.closed ? "Closed" : "Open");
  for (const issue of issues) byStatus[bucket(issue)] = (byStatus[bucket(issue)] ?? 0) + 1;
  return {
    title: next.title,
    url: next.url,
    due: Date.parse(next.dueOn),
    previousDue: earlierDues.length ? Date.parse(earlierDues[earlierDues.length - 1]) : null,
    total: next.issues.totalCount,
    closed: issues.filter((issue) => issue.closed).length,
    byStatus,
    unassigned: issues.filter((issue) => !issue.closed && issue.assignees.length === 0),
    notStarted: issues.filter((issue) => !issue.closed && ws.notStarted.includes(issue.status)),
  };
}

/**
 * One outcome for a check's jobs or steps: failed, running, cancelled, skipped or success.
 * `pending` says the check's job runs but has not reported the step yet.
 */
function outcomeOf(items, pending) {
  if (items.some((item) => FAILED_CONCLUSIONS.includes(item.conclusion))) return "failed";
  if (pending || items.some((item) => item.status !== "completed")) return "running";
  if (items.some((item) => item.conclusion === "cancelled")) return "cancelled";
  if (!items.length || items.every((item) => item.conclusion === "skipped")) return "skipped";
  return "success";
}

/**
 * The outcome of one configured check. `job` matches jobs by name, and `step` narrows to their
 * steps. `exceptJobs` takes every job whose name matches none of its markers.
 */
function checkOutcome(check, jobs) {
  if (check.exceptJobs) {
    return outcomeOf(jobs.filter((job) => !check.exceptJobs.some((marker) => job.name.includes(marker))));
  }
  const matching = jobs.filter((job) => job.name.includes(check.job));
  if (!check.step) return outcomeOf(matching);
  const steps = matching.flatMap((job) => (job.steps ?? []).filter((step) => step.name.includes(check.step)));
  return outcomeOf(steps, !steps.length && matching.some((job) => job.status !== "completed"));
}

/** The last qualifying nightly run: one outcome per configured check, and one for the run. */
async function nightly(ws) {
  const settings = ws.nightly;
  if (!settings?.workflow || !ws.repo) return null;
  const base = `repos/${ws.repo}/actions`;
  const runs = await gh([
    "api",
    `${base}/workflows/${settings.workflow}/runs?branch=${encodeURIComponent(settings.branch)}&per_page=20`,
  ]);
  const events = settings.events ?? ["schedule"];
  const run = runs.workflow_runs.find((candidate) => events.includes(candidate.event));
  if (!run) return null;
  const jobs = (await gh(["api", `${base}/runs/${run.id}/jobs?per_page=100`])).jobs;
  const checks = (settings.checks ?? []).map((check) => ({ name: check.name, outcome: checkOutcome(check, jobs) }));
  const failed = FAILED_CONCLUSIONS.includes(run.conclusion) || checks.some((check) => check.outcome === "failed");
  const running = run.status !== "completed" || checks.some((check) => check.outcome === "running");
  return {
    overall: failed ? "failure" : running ? "running" : "success",
    checks,
    url: run.html_url,
    at: Date.parse(run.created_at),
  };
}

/**
 * Open issues with any label whose name contains `customer.labelMatch`, ignoring case: the
 * matching labels, their count, and the search that lists them.
 */
async function customerIssues(ws) {
  const match = ws.customer.labelMatch.toLowerCase();
  const [owner, name] = ws.repo.split("/");
  const data = await graphql(CUSTOMER_LABELS, { owner, name, labelQuery: match });
  const labels = data.repository.labels.nodes
    .map((label) => label.name)
    .filter((labelName) => labelName.toLowerCase().includes(match));
  if (!labels.length) return { labels, count: 0, query: null };
  const query = `repo:${ws.repo} is:issue is:open ${valueList("label", labels)}`;
  return { labels, count: (await graphql(ISSUE_COUNT, { searchQuery: query })).search.issueCount, query };
}

/**
 * One board item for the Board tab: an issue, a PR or a draft, with its status, iteration and
 * assignees with their avatar URLs. A PR keeps its own review decision; an issue keeps the PRs that would close it.
 */
function boardViewItem(ws, node) {
  const content = node.content ?? {};
  const kind = content.__typename === "PullRequest" ? "pr" : content.__typename === "Issue" ? "issue" : "draft";
  return {
    kind,
    itemId: node.id ?? null,
    contentId: content.id ?? null,
    repo: content.repository?.nameWithOwner ?? ws.repo,
    number: content.number ?? null,
    title: content.title ?? "",
    url: content.url ?? null,
    state: content.state ?? null,
    type: content.issueType?.name ?? null,
    status: node.status?.name ?? null,
    iteration: node.iteration?.title ?? null,
    iterationId: node.iteration?.iterationId ?? null,
    milestone: content.milestone ? { id: content.milestone.id, title: content.milestone.title } : null,
    assignees: (content.assignees?.nodes ?? []).map((assignee) => ({ login: assignee.login, avatar: assignee.avatarUrl ?? null })),
    reviewDecision: content.reviewDecision ?? null,
    prs: (content.closedByPullRequestsReferences?.nodes ?? []).filter((pr) => !pr.isDraft),
  };
}

/**
 * The ids a Board move needs, from the board's first page.
 * @param {object} project The `projectV2` node.
 * @returns {object} `{ projectId, status: { fieldId, options }, iteration: { fieldId, iterations } }`;
 *   `options` maps a status name to its option id, and either field is null when the board has none.
 */
function boardMeta(project) {
  const status = project.statusMeta?.id
    ? { fieldId: project.statusMeta.id, options: Object.fromEntries(project.statusMeta.options.map((option) => [option.name, option.id])) }
    : null;
  const configuration = project.iterationMeta?.configuration;
  const iteration = project.iterationMeta?.id
    ? {
        fieldId: project.iterationMeta.id,
        iterations: [
          ...configuration.completedIterations.map((entry) => ({ ...entry, completed: true })),
          ...configuration.iterations.map((entry) => ({ ...entry, completed: false })),
        ].sort((a, b) => a.startDate.localeCompare(b.startDate)),
      }
    : null;
  return { projectId: project.id, status, iteration };
}

/**
 * The Board tab's statuses that the workspace still has, in its order.
 * @param {object} ws The workspace.
 * @returns {string[]} The statuses ticked for the Board, or none for every status.
 */
export const boardStatuses = (ws) => ws.statuses.filter((status) => ws.boardView.statuses.includes(status));

/**
 * The Board tab's whole filter: the workspace's filter, then its ticked statuses.
 * @param {object} ws The workspace.
 * @returns {string} The filter, or "" when neither is set.
 */
export function boardFilter(ws) {
  const statuses = boardStatuses(ws);
  return [ws.boardView.query.trim(), statuses.length ? valueList("status", statuses) : ""].filter(Boolean).join(" ");
}

/**
 * The board items that match the workspace's Board tab filter, up to five pages of 100.
 * @param {object} ws The workspace, with a board.
 * @returns {Promise<{ filter: string, total: number, items: object[], meta: object | null }>}
 *   `meta` holds the ids a move needs: the board's, its Status field and options, and its
 *   Iteration field with the open and the completed iterations.
 */
export async function loadBoardView(ws) {
  const fields = { statusField: ws.board.statusField ?? "Status", iterationField: ws.board.iterationField ?? "Iteration" };
  const filter = boardFilter(ws);
  const items = [];
  let total = 0;
  let after = null;
  let meta = null;
  for (let page = 0; page < BOARD_VIEW_PAGES; page += 1) {
    const result = await graphql(BOARD_VIEW_PAGE, {
      projectOwner: ws.board.owner,
      projectNumber: ws.board.number,
      ...fields,
      filter,
      ...(after ? { after } : {}),
    });
    const project = result.owner?.projectV2;
    const connection = project?.items;
    if (!connection) break;
    meta ??= boardMeta(project);
    total = connection.totalCount;
    items.push(...connection.nodes.filter((node) => node.content).map((node) => boardViewItem(ws, node)));
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return { filter, total, items, meta };
}

/** A PR from a search, shaped for the lists. */
function prRow(pr) {
  return {
    kind: "pr",
    repo: pr.repository?.nameWithOwner ?? null,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    updatedAt: Date.parse(pr.updatedAt),
    author: pr.author?.login ?? "ghost",
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision ?? null,
    checks: pr.commits?.nodes?.[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

/**
 * Runs one part of a load, keeping its failure apart from the others.
 * @param {Record<string, string>} errors Where a failure is recorded, under `key`.
 * @param {string} key The part's name.
 * @param {Promise<any>} promise The part.
 * @returns {Promise<any>} Its result, or null when it failed.
 */
const part = (errors, key, promise) =>
  promise.catch((error) => {
    errors[key] = String(error.message ?? error);
    return null;
  });

/**
 * Loads one workspace: its repository's milestones, bugs, triage, customer issues, nightly run
 * and open PRs, and its board's iterations, items in flight and the Board tab's items. A part the workspace has no
 * repository or board for is null.
 * @param {object} ws The workspace.
 * @returns {Promise<object>} The workspace's model, with failures in `errors`.
 */
export async function loadWorkspace(ws) {
  const now = Date.now();
  const queries = workspaceQueries(ws);
  const errors = {};
  const fields = {
    statusField: ws.board?.statusField ?? "Status",
    iterationField: ws.board?.iterationField ?? "Iteration",
  };
  const [owner, name] = ws.repo ? ws.repo.split("/") : [];
  const none = Promise.resolve(null);
  const [repo, board, nightlyRun, bugs, customer, prs, boardView] = await Promise.all([
    ws.repo ? part(errors, "github", graphql(WORKSPACE_REPO, { owner, name, ...fields, triageQuery: queries.triageQuery })) : none,
    ws.board
      ? part(
          errors,
          "board",
          graphql(WORKSPACE_BOARD, {
            projectOwner: ws.board.owner,
            projectNumber: ws.board.number,
            ...fields,
            inFlightFilter: queries.inFlightFilter,
          }),
        )
      : none,
    ws.repo ? part(errors, "nightly", nightly(ws)) : none,
    ws.repo ? part(errors, "bugs", bugsByPriority(ws, queries.bugsQuery)) : none,
    ws.repo ? part(errors, "customer", customerIssues(ws)) : none,
    ws.repo && !ws.board ? part(errors, "prs", graphql(OPEN_PRS, { prsQuery: queries.prsQuery })) : none,
    ws.board && boardFilter(ws) ? part(errors, "boardView", loadBoardView(ws)) : none,
  ]);
  const model = { fetchedAt: now, errors, nightly: nightlyRun, bugs, customer, queries, boardView };
  if (repo?.repository) {
    const upcoming = upcomingMilestones(repo.repository, now);
    model.milestone = nextMilestone(ws, repo.repository, upcoming[0]);
    model.spotlight = spotlight(ws, upcoming);
    model.counts = { triage: repo.triage.issueCount };
  }
  const project = board?.owner?.projectV2;
  if (project) {
    model.boardUrl = project.url;
    model.iteration = currentIteration(project.iterationField?.configuration?.iterations, now);
    model.inFlightTotal = project.inFlight.totalCount;
    model.inFlight = project.inFlight.nodes
      .filter((item) => item.content?.number)
      .map((item) => ({
        repo: item.content.repository?.nameWithOwner ?? ws.repo,
        number: item.content.number,
        title: item.content.title,
        url: item.content.url,
        status: item.status?.name ?? null,
        since: item.status?.updatedAt ? Date.parse(item.status.updatedAt) : null,
        iteration: item.iteration?.title ?? null,
        assignees: item.content.assignees.nodes.map((assignee) => assignee.login),
        milestone: item.content.milestone?.title ?? null,
        prs: item.content.closedByPullRequestsReferences.nodes.filter((pr) => !pr.isDraft),
      }));
  } else if (ws.board && !errors.board) {
    errors.board = `Board ${ws.board.owner} #${ws.board.number} not found, or gh lacks the read:project scope.`;
  }
  if (prs) {
    model.openPrsTotal = prs.search.issueCount;
    model.openPrs = prs.search.nodes.filter((pr) => pr.number).map(prRow);
  }
  return model;
}

/**
 * Fetches one of a workspace's Overview cards again, for a filter edited on the card, and puts
 * its result into a copy of the workspace's model: Open bugs, Triage bugs, Customer issues or
 * Open PRs. The other cards stay as they were.
 * @param {object} ws The workspace, with the card's edited search in place.
 * @param {object} model The workspace's model, from `loadWorkspace`.
 * @param {"bugs" | "triage" | "customer" | "prs"} key The card.
 * @returns {Promise<object>} The workspace's model with that card's result and searches.
 * @throws {Error} With GitHub's message when it refuses the search.
 */
export async function loadWorkspaceCard(ws, model, key) {
  const queries = workspaceQueries(ws);
  const next = { ...model, queries: { ...model.queries, ...queries }, errors: { ...model.errors } };
  delete next.errors[key];
  if (key === "bugs") next.bugs = await bugsByPriority(ws, queries.bugsQuery);
  if (key === "triage") {
    const count = (await graphql(ISSUE_COUNT, { searchQuery: queries.triageQuery })).search.issueCount;
    next.counts = { ...model.counts, triage: count };
  }
  if (key === "customer") next.customer = await customerIssues(ws);
  if (key === "prs") {
    const prs = await graphql(OPEN_PRS, { prsQuery: queries.prsQuery });
    next.openPrsTotal = prs.search.issueCount;
    next.openPrs = prs.search.nodes.filter((pr) => pr.number).map(prRow);
  }
  return next;
}

/** Whether a check state is a failure. */
const failing = (state) => state === "FAILURE" || state === "ERROR";

/** Where each Daypack card's rows and count sit in the account's model, by its search's key. */
const CARD_LISTS = { review: "reviews", myPrs: "myPrs", mine: "mine" };

/**
 * A Daypack card's rows from its search's result. With picked repositories, only theirs; "All"
 * keeps everything a search finds, such as a review on a repository you are not in.
 * @param {object} config The settings.
 * @param {"review" | "myPrs" | "mine"} key The card's search.
 * @param {{ nodes: object[] }} search The search's result.
 * @param {Set<string>} scoped The repositories in scope.
 * @returns {object[]} The rows.
 */
function cardRows(config, key, search, scoped) {
  const keep = (item) => !Array.isArray(config.account.repos) || scoped.has(item.repo);
  const nodes = (search?.nodes ?? []).filter((node) => node.number);
  if (key !== "mine") return nodes.map(prRow).filter(keep);
  return nodes
    .map((issue) => {
      const standing = standingOnBoards(config, issue);
      return {
        kind: "issue",
        repo: issue.repository.nameWithOwner,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        updatedAt: Date.parse(issue.updatedAt),
        workspace: standing.ws?.name ?? null,
        status: standing.status,
        iteration: standing.iteration,
        milestone: issue.milestone?.title ?? null,
      };
    })
    .filter(keep);
}

/**
 * A Daypack card's count: the rows kept with picked repositories, else GitHub's total.
 * @param {object} config The settings.
 * @param {object[]} rows The card's rows.
 * @param {{ issueCount: number }} search The search's result.
 * @returns {number}
 */
const cardCount = (config, rows, search) => (Array.isArray(config.account.repos) ? rows.length : search?.issueCount ?? rows.length);

/**
 * Fetches one Daypack card again with another search, for a filter edited on the card, and
 * puts its rows into a copy of the account's model. The other cards stay as they were.
 * @param {object} config The settings.
 * @param {object} account The account's model, from `loadAccount`.
 * @param {"review" | "myPrs" | "mine"} key The card's search.
 * @param {string} query The search to run.
 * @returns {Promise<object>} The account's model with that card's rows, count and search.
 * @throws {Error} With GitHub's message when it refuses the search.
 */
export async function loadCardSearch(config, account, key, query) {
  const data = await graphql(ACCOUNT_SEARCHES[key], { search: query });
  const scoped = new Set(account.repos.map((repo) => repo.repo));
  const rows = cardRows(config, key, data.search, scoped);
  const list = CARD_LISTS[key];
  const next = {
    ...account,
    [list]: rows,
    counts: { ...account.counts, [list]: cardCount(config, rows, data.search) },
    queries: { ...account.queries, [key]: query },
  };
  if (key === "myPrs") next.redPrs = rows.filter((pr) => failing(pr.checks)).length;
  return next;
}

/**
 * Loads the account: every repository in scope with its open counts and checks, your review
 * requests, your PRs and your issues. With picked repositories, the searches keep only theirs.
 * @param {object} config The settings.
 * @returns {Promise<object>} The account's model, with a failure in `error`.
 */
export async function loadAccount(config) {
  const { queries } = config.account;
  const data = await graphql(
    ACCOUNT,
    { reviewQuery: queries.review, mineQuery: queries.mine, myPrsQuery: queries.myPrs },
    { partial: true },
  );
  const repos = data.viewer.repositories.nodes.filter((repo) => inScope(config.account, repo));
  const scoped = new Set(repos.map((repo) => repo.nameWithOwner));
  const reviews = cardRows(config, "review", data.reviews, scoped);
  const myPrs = cardRows(config, "myPrs", data.myPrs, scoped);
  const mine = cardRows(config, "mine", data.mine, scoped);
  return {
    viewer: data.viewer.login,
    reposTotal: data.viewer.repositories.totalCount,
    repos: repos.map((repo) => ({
      repo: repo.nameWithOwner,
      url: repo.url,
      isPrivate: repo.isPrivate,
      isArchived: repo.isArchived,
      pushedAt: repo.pushedAt ? Date.parse(repo.pushedAt) : null,
      issues: repo.issues.totalCount,
      prs: repo.pullRequests.totalCount,
      branch: repo.defaultBranchRef?.name ?? null,
      checks: repo.defaultBranchRef?.target?.statusCheckRollup?.state ?? null,
    })),
    reviews,
    myPrs,
    mine,
    counts: {
      reviews: cardCount(config, reviews, data.reviews),
      myPrs: cardCount(config, myPrs, data.myPrs),
      mine: cardCount(config, mine, data.mine),
    },
    redRepos: repos.filter((repo) => failing(repo.defaultBranchRef?.target?.statusCheckRollup?.state)).length,
    redPrs: myPrs.filter((pr) => failing(pr.checks)).length,
    queries: { review: queries.review, myPrs: queries.myPrs, mine: queries.mine },
  };
}

/**
 * Loads everything: the account and every workspace, each failing on its own.
 * @param {object} config The settings.
 * @returns {Promise<object>} `{ version, fetchedAt, account, workspaces, errors }`.
 */
export async function loadAll(config) {
  const errors = {};
  const [account, ...workspaces] = await Promise.all([
    part(errors, "account", loadAccount(config)),
    ...config.workspaces.map((ws) =>
      loadWorkspace(ws).catch((error) => ({ fetchedAt: Date.now(), errors: { github: String(error.message ?? error) } })),
    ),
  ]);
  return {
    version: MODEL_VERSION,
    fetchedAt: Date.now(),
    errors,
    account,
    workspaces: Object.fromEntries(config.workspaces.map((ws, index) => [ws.name, workspaces[index]])),
  };
}

/**
 * The repository and number of a pinned item, from its fields or its URL.
 * @param {{ repo?: string, url?: string }} item A focus item.
 * @returns {string | null} `owner/name`, or null when neither says.
 */
export function repoOfItem(item) {
  if (item.repo) return item.repo;
  const match = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\//.exec(item.url ?? "");
  return match ? match[1] : null;
}

/**
 * Each pinned issue or PR's standing, keyed by `owner/name#number`: `{ state, status, review }`.
 * `state` is OPEN, CLOSED or MERGED; `status` is an issue's status on a workspace's board;
 * `review` is a PR's review decision. The ones that do not apply are null.
 * @param {object} config The settings.
 * @param {{ repo: string, number: number }[]} picks The pinned items.
 * @returns {Promise<Record<string, { state: string | null, status: string | null, review: string | null }>>}
 */
export async function loadPickStates(config, picks) {
  const byRepo = {};
  for (const pick of picks) (byRepo[pick.repo] ??= new Set()).add(pick.number);
  if (!Object.keys(byRepo).length) return {};
  const { query, aliases } = pickStates(Object.fromEntries(Object.entries(byRepo).map(([repo, set]) => [repo, [...set]])));
  const data = await graphql(query, {}, { partial: true });
  const states = {};
  for (const [repo, numbers] of Object.entries(byRepo)) {
    for (const number of numbers) {
      const node = data?.[aliases[repo]]?.[`n${number}`];
      states[`${repo}#${number}`] = {
        state: node?.state ?? null,
        status: node?.projectItems ? standingOnBoards(config, node).status : null,
        review: node?.reviewDecision ?? null,
      };
    }
  }
  return states;
}
