// Fetches Alpmeister's data through the `gh` CLI and shapes it for the widgets.
// Read-only: nothing here writes to GitHub.

import { exec } from "herdr";
import { BUGS_PAGE, CUSTOMER_LABELS, ISSUE_COUNT, OVERVIEW, pickStates } from "./queries.js";

const DAY = 86400000;
const BUG_PAGES = 10;
const FAILED_CONCLUSIONS = ["failure", "timed_out", "startup_failure"];

/** Runs `gh` with the given arguments and parses its JSON output, or throws with gh's message. */
async function gh(args) {
  const result = await exec("gh", args, { timeout: 60000 });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || `gh exited ${result.code}`).trim());
  return JSON.parse(result.stdout);
}

/** Runs a GraphQL document with string and integer variables. */
async function graphql(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const body = await gh(args);
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  return body.data;
}

/** A board filter or search value list: `name:"A","B"`. */
const valueList = (qualifier, values) => `${qualifier}:${values.map((value) => `"${value}"`).join(",")}`;

/** The search URL GitHub shows for a query, for links out of the view. */
export const searchUrl = (config, query) =>
  `https://github.com/${config.owner}/${config.name}/issues?q=${encodeURIComponent(query)}`;

/** Every query the view runs, scoped to the configured repository. */
export function queriesFor(config) {
  const repo = `repo:${config.owner}/${config.name}`;
  const inFlightParts = [repo, "is:issue", "is:open", valueList("status", config.inFlight.statuses)];
  if (config.inFlight.excludeTypes.length) inFlightParts.push(valueList("-type", config.inFlight.excludeTypes));
  return {
    inFlightFilter: inFlightParts.join(" "),
    triageQuery: `${repo} ${config.queries.triage}`,
    reviewQuery: `${repo} ${config.queries.review}`,
    mineQuery: `${repo} ${config.queries.mine}`,
    myPrsQuery: `${repo} ${config.queries.myPrs}`,
    bugsQuery: `${repo} ${config.bugs.query}`,
  };
}

/**
 * Open bugs counted by the priority issue field, in the configured order, then "Unset" for a
 * missing or unknown value. Reads at most BUG_PAGES pages of 100.
 */
async function bugsByPriority(config, bugsQuery) {
  const counts = Object.fromEntries([...config.bugs.priorities, "Unset"].map((priority) => [priority, 0]));
  let after = null;
  let total = 0;
  let read = 0;
  for (let page = 0; page < BUG_PAGES; page += 1) {
    const search = (await graphql(BUGS_PAGE, after ? { bugsQuery, after } : { bugsQuery })).search;
    total = search.issueCount;
    for (const issue of search.nodes) {
      const value = priorityOf(config, issue);
      counts[value in counts && value !== "Unset" ? value : "Unset"] += 1;
      read += 1;
    }
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return { total, read, counts };
}

/** The board item of an issue on the configured project, or null. */
function boardItem(config, issue) {
  return (
    issue.projectItems?.nodes?.find(
      (item) => item.project?.number === config.project.number && item.project?.owner?.login === config.project.owner,
    ) ?? null
  );
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
function priorityOf(config, issue) {
  return issue.issueFieldValues?.nodes?.find((field) => field.field?.name === config.bugs.priorityField)?.name ?? null;
}

/** A milestone's issue, shaped for the milestone card and the spotlight card. */
function milestoneIssue(config, issue) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    closed: issue.state === "CLOSED",
    status: boardItem(config, issue)?.status?.name ?? null,
    assignees: issue.assignees.nodes.map((assignee) => assignee.login),
    type: issue.issueType?.name ?? null,
    parent: issue.parent ?? null,
    labels: issue.labels?.nodes?.map((label) => label.name) ?? [],
    priority: priorityOf(config, issue),
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
function milestoneSpotlight(config, milestone, issues) {
  const settings = config.spotlight;
  const levels = config.bugs.priorities;
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
function spotlight(config, upcoming) {
  const milestones = upcoming.slice(0, config.spotlight.milestones).map((milestone) => ({
    milestone,
    issues: milestone.issues.nodes.map((issue) => milestoneIssue(config, issue)),
  }));
  return {
    milestones: milestones.map(({ milestone, issues }) => milestoneSpotlight(config, milestone, issues)),
    onHold: milestones.flatMap(({ milestone, issues }) =>
      issues
        .filter((issue) => !issue.closed && issue.status === config.spotlight.holdStatus)
        .map((issue) => ({ ...issue, milestone: milestone.title })),
    ),
  };
}

/** The next milestone, with its status breakdown. */
function nextMilestone(config, repository, next) {
  if (!next) return null;
  const earlierDues = [...repository.open.nodes, ...repository.closed.nodes]
    .map((milestone) => milestone.dueOn)
    .filter((due) => due && due < next.dueOn)
    .sort();
  const issues = next.issues.nodes.map((issue) => milestoneIssue(config, issue));
  const byStatus = {};
  for (const issue of issues) byStatus[issue.status ?? "No status"] = (byStatus[issue.status ?? "No status"] ?? 0) + 1;
  return {
    title: next.title,
    url: next.url,
    due: Date.parse(next.dueOn),
    previousDue: earlierDues.length ? Date.parse(earlierDues[earlierDues.length - 1]) : null,
    total: next.issues.totalCount,
    closed: issues.filter((issue) => issue.closed).length,
    byStatus,
    unassigned: issues.filter((issue) => !issue.closed && issue.assignees.length === 0),
    notStarted: issues.filter((issue) => !issue.closed && config.notStarted.includes(issue.status)),
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
async function nightly(config) {
  const settings = config.nightly;
  if (!settings?.workflow) return null;
  const base = `repos/${config.owner}/${config.name}/actions`;
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
async function customerIssues(config) {
  const match = config.customer.labelMatch.toLowerCase();
  const data = await graphql(CUSTOMER_LABELS, { owner: config.owner, name: config.name, labelQuery: match });
  const labels = data.repository.labels.nodes
    .map((label) => label.name)
    .filter((name) => name.toLowerCase().includes(match));
  if (!labels.length) return { labels, count: 0, query: null };
  const query = `repo:${config.owner}/${config.name} is:issue is:open ${valueList("label", labels)}`;
  return { labels, count: (await graphql(ISSUE_COUNT, { searchQuery: query })).search.issueCount, query };
}

/** Loads everything the view shows. Each part fails on its own: an error lands in `errors`. */
export async function loadOverview(config) {
  const now = Date.now();
  const queries = queriesFor(config);
  const errors = {};
  const [overview, nightlyRun, bugs, customer] = await Promise.all([
    graphql(OVERVIEW, {
      owner: config.owner,
      name: config.name,
      projectOwner: config.project.owner,
      projectNumber: config.project.number,
      statusField: config.project.statusField,
      iterationField: config.project.iterationField,
      inFlightFilter: queries.inFlightFilter,
      triageQuery: queries.triageQuery,
      reviewQuery: queries.reviewQuery,
      mineQuery: queries.mineQuery,
      myPrsQuery: queries.myPrsQuery,
    }).catch((error) => {
      errors.github = String(error.message ?? error);
      return null;
    }),
    nightly(config).catch((error) => {
      errors.nightly = String(error.message ?? error);
      return null;
    }),
    bugsByPriority(config, queries.bugsQuery).catch((error) => {
      errors.bugs = String(error.message ?? error);
      return null;
    }),
    customerIssues(config).catch((error) => {
      errors.customer = String(error.message ?? error);
      return null;
    }),
  ]);
  const model = { fetchedAt: now, errors, nightly: nightlyRun, bugs, customer, queries };
  if (!overview) return model;
  const board = overview.board?.projectV2;
  model.viewer = overview.viewer.login;
  const upcoming = upcomingMilestones(overview.repository, now);
  model.milestone = nextMilestone(config, overview.repository, upcoming[0]);
  model.spotlight = spotlight(config, upcoming);
  model.iteration = currentIteration(board?.iterationField?.configuration?.iterations, now);
  model.inFlightTotal = board?.inFlight.totalCount ?? 0;
  model.inFlight = (board?.inFlight.nodes ?? [])
    .filter((item) => item.content?.number)
    .map((item) => ({
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
  model.counts = {
    triage: overview.triage.issueCount,
    reviews: overview.reviews.issueCount,
    mine: overview.mine.issueCount,
    myPrs: overview.myPrs.issueCount,
  };
  model.reviews = overview.reviews.nodes
    .filter((pr) => pr.number)
    .map((pr) => ({
      kind: "pr",
      number: pr.number,
      title: pr.title,
      url: pr.url,
      updatedAt: Date.parse(pr.updatedAt),
      author: pr.author?.login ?? "ghost",
      checks: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    }));
  model.myPrs = overview.myPrs.nodes
    .filter((pr) => pr.number)
    .map((pr) => ({
      kind: "pr",
      number: pr.number,
      title: pr.title,
      url: pr.url,
      updatedAt: Date.parse(pr.updatedAt),
      reviewDecision: pr.reviewDecision ?? null,
      checks: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    }));
  model.mine = overview.mine.nodes
    .filter((issue) => issue.number)
    .map((issue) => ({
      kind: "issue",
      number: issue.number,
      title: issue.title,
      url: issue.url,
      status: boardItem(config, issue)?.status?.name ?? null,
      iteration: boardItem(config, issue)?.iteration?.title ?? null,
      milestone: issue.milestone?.title ?? null,
    }));
  return model;
}

/**
 * Each numbered issue or PR, keyed by number: `{ state, status, review }`. `state` is OPEN,
 * CLOSED or MERGED; `status` is an issue's board status; `review` is a PR's review decision
 * (APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED). The ones that do not apply are null.
 */
export async function loadPickStates(config, numbers) {
  if (!numbers.length) return {};
  const data = await graphql(pickStates(numbers), {
    owner: config.owner,
    name: config.name,
    statusField: config.project.statusField,
  });
  const states = {};
  for (const number of numbers) {
    const node = data.repository[`n${number}`];
    states[number] = {
      state: node?.state ?? null,
      status: node?.projectItems ? (boardItem(config, node)?.status?.name ?? null) : null,
      review: node?.reviewDecision ?? null,
    };
  }
  return states;
}
