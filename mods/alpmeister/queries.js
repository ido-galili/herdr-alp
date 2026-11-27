// The GraphQL documents Alpmeister sends through `gh api graphql`. Plain strings with no
// imports, so they can be tried from a shell as they are.

const STATUS_VALUE = `... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }`;
const ITERATION_VALUE = `... on ProjectV2ItemFieldIterationValue { title startDate duration }`;
const OWNER_LOGIN = `owner { ... on Organization { login } ... on User { login } }`;
const CHECKS = `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

/** The issue fields of an issue, such as Priority: single-select values with their field's name. */
const ISSUE_FIELDS = `
  issueFieldValues(first: 20) {
    nodes {
      ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldCommon { name } } }
    }
  }`;

/** The board fields of an issue on a known board: its status and iteration, read by field name. */
const BOARD_FIELDS = `
  projectItems(first: 10) {
    nodes {
      project { number ${OWNER_LOGIN} }
      status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
      iteration: fieldValueByName(name: $iterationField) { ${ITERATION_VALUE} }
    }
  }`;

/**
 * The board fields of an issue on any board: every single-select and iteration value with its
 * field's name, so each board's own Status and Iteration fields can be picked out afterwards.
 */
const ANY_BOARD_FIELDS = `
  projectItems(first: 10) {
    nodes {
      project { number ${OWNER_LOGIN} }
      fieldValues(first: 30) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2FieldCommon { name } } }
        }
      }
    }
  }`;

/**
 * Your GitHub as a whole: the repositories you own, collaborate on or reach through an
 * organization, each with its open counts and the default branch's checks, and the @me searches.
 * Variables: reviewQuery, mineQuery, myPrsQuery.
 */
export const ACCOUNT = `
query($reviewQuery: String!, $mineQuery: String!, $myPrsQuery: String!) {
  viewer {
    login
    repositories(
      first: 100
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        nameWithOwner url isArchived isPrivate isFork pushedAt
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
      }
    }
  }
  reviews: search(type: ISSUE, query: $reviewQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt reviewDecision
        repository { nameWithOwner }
        author { login }
        ${CHECKS}
      }
    }
  }
  myPrs: search(type: ISSUE, query: $myPrsQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt reviewDecision
        repository { nameWithOwner }
        ${CHECKS}
      }
    }
  }
  mine: search(type: ISSUE, query: $mineQuery, first: 100) {
    issueCount
    nodes {
      ... on Issue {
        number title url updatedAt
        repository { nameWithOwner }
        milestone { title }
        ${ANY_BOARD_FIELDS}
      }
    }
  }
}`;

/** The fields of a milestone's issue, for the Milestone card. Needs $statusField and $iterationField. */
const MILESTONE_ISSUE = `
  number title state url
  issueType { name }
  parent { number title url }
  labels(first: 10) { nodes { name } }
  subIssuesSummary { total completed }
  assignees(first: 3) { nodes { login } }
  ${ISSUE_FIELDS}
  ${BOARD_FIELDS}`;

/**
 * A workspace's repository: its open milestones with their issues and counts, the open issues
 * without a milestone (counted), and the triage count.
 * Variables: owner, name, statusField, iterationField, triageQuery, noMilestoneQuery.
 */
export const WORKSPACE_REPO = `
query(
  $owner: String!, $name: String!, $statusField: String!, $iterationField: String!, $triageQuery: String!,
  $noMilestoneQuery: String!
) {
  repository(owner: $owner, name: $name) {
    url
    open: milestones(first: 20, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) {
      nodes {
        title number dueOn url createdAt
        closedIssues: issues(states: CLOSED) { totalCount }
        issues(first: 100) {
          totalCount
          nodes { ${MILESTONE_ISSUE} }
        }
      }
    }
    closed: milestones(first: 10, states: CLOSED, orderBy: { field: DUE_DATE, direction: DESC }) {
      nodes { title dueOn }
    }
  }
  triage: search(type: ISSUE, query: $triageQuery, first: 0) { issueCount }
  noMilestone: search(type: ISSUE, query: $noMilestoneQuery, first: 0) { issueCount }
}`;

/**
 * A repository's open issues without a milestone, for the Milestone card when "No milestone" is
 * picked. Variables: searchQuery, statusField, iterationField.
 */
export const NO_MILESTONE_ISSUES = `
query($searchQuery: String!, $statusField: String!, $iterationField: String!) {
  search(type: ISSUE, query: $searchQuery, first: 100) {
    issueCount
    nodes { ... on Issue { ${MILESTONE_ISSUE} } }
  }
}`;

/**
 * A workspace's project board, on a user or an organization: its iterations and the items in
 * flight. Variables: projectOwner, projectNumber, statusField, iterationField, inFlightFilter.
 */
export const WORKSPACE_BOARD = `
query(
  $projectOwner: String!, $projectNumber: Int!, $statusField: String!, $iterationField: String!,
  $inFlightFilter: String!
) {
  owner: repositoryOwner(login: $projectOwner) {
    ... on ProjectV2Owner {
      projectV2(number: $projectNumber) {
        title url
        iterationField: field(name: $iterationField) {
          ... on ProjectV2IterationField {
            configuration { iterations { title startDate duration } }
          }
        }
        inFlight: items(first: 100, query: $inFlightFilter) {
          totalCount
          nodes {
            status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
            iteration: fieldValueByName(name: $iterationField) { ${ITERATION_VALUE} }
            content {
              ... on Issue {
                number title url
                repository { nameWithOwner }
                assignees(first: 3) { nodes { login } }
                milestone { title }
                closedByPullRequestsReferences(first: 3, includeClosedPrs: false) {
                  nodes { number url isDraft reviewDecision }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * One page of a board's items that match a filter, in the board's own filter syntax, for the
 * Board tab, with the ids its moves need: the board's, its Status options and its iterations.
 * Variables: projectOwner, projectNumber, statusField, iterationField, filter, after.
 */
export const BOARD_VIEW_PAGE = `
query(
  $projectOwner: String!, $projectNumber: Int!, $statusField: String!, $iterationField: String!,
  $filter: String!, $after: String
) {
  owner: repositoryOwner(login: $projectOwner) {
    ... on ProjectV2Owner {
      projectV2(number: $projectNumber) {
        id
        statusMeta: field(name: $statusField) {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
        iterationMeta: field(name: $iterationField) {
          ... on ProjectV2IterationField {
            id
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
        items(first: 100, after: $after, query: $filter) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
            iteration: fieldValueByName(name: $iterationField) {
              ... on ProjectV2ItemFieldIterationValue { title iterationId }
            }
            content {
              __typename
              ... on Issue {
                id number title url state
                issueType { name }
                milestone { id title }
                repository { nameWithOwner }
                assignees(first: 10) { nodes { login avatarUrl(size: 64) } }
                closedByPullRequestsReferences(first: 3, includeClosedPrs: false) {
                  nodes { number url isDraft reviewDecision }
                }
              }
              ... on PullRequest {
                id number title url state isDraft reviewDecision
                milestone { id title }
                repository { nameWithOwner }
                assignees(first: 10) { nodes { login avatarUrl(size: 64) } }
              }
              ... on DraftIssue { title assignees(first: 10) { nodes { login avatarUrl(size: 64) } } }
            }
          }
        }
      }
    }
  }
}`;

/** A repository's open milestones, soonest due first, for the Board's menu. Variables: owner, name. */
export const OPEN_MILESTONES = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    milestones(states: OPEN, first: 50, orderBy: { field: DUE_DATE, direction: ASC }) {
      nodes { id title dueOn }
    }
  }
}`;

/** Sets a board item's single-select field. Variables: project, item, field, option. */
export const SET_BOARD_OPTION = `
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }
  ) { projectV2Item { id } }
}`;

/** Sets a board item's iteration. Variables: project, item, field, iteration. */
export const SET_BOARD_ITERATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $iteration: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { iterationId: $iteration } }
  ) { projectV2Item { id } }
}`;

/** Moves a board item to just after another one. Variables: project, item, after. */
export const MOVE_BOARD_ITEM_AFTER = `
mutation($project: ID!, $item: ID!, $after: ID!) {
  updateProjectV2ItemPosition(input: { projectId: $project, itemId: $item, afterId: $after }) {
    items(first: 1) { totalCount }
  }
}`;

/** Moves a board item to the top of the board. Variables: project, item. */
export const MOVE_BOARD_ITEM_FIRST = `
mutation($project: ID!, $item: ID!) {
  updateProjectV2ItemPosition(input: { projectId: $project, itemId: $item }) {
    items(first: 1) { totalCount }
  }
}`;

/** Clears a board item's field. Variables: project, item, field. */
export const CLEAR_BOARD_FIELD = `
mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
    projectV2Item { id }
  }
}`;

/** Sets an issue's milestone. Variables: issue, milestone. */
export const SET_ISSUE_MILESTONE = `
mutation($issue: ID!, $milestone: ID!) {
  updateIssue(input: { id: $issue, milestoneId: $milestone }) { issue { id } }
}`;

/** Takes an issue off its milestone. Variables: issue. */
export const CLEAR_ISSUE_MILESTONE = `
mutation($issue: ID!) {
  updateIssue(input: { id: $issue, milestoneId: null }) { issue { id } }
}`;

/** Sets a PR's milestone. Variables: pr, milestone. */
export const SET_PR_MILESTONE = `
mutation($pr: ID!, $milestone: ID!) {
  updatePullRequest(input: { pullRequestId: $pr, milestoneId: $milestone }) { pullRequest { id } }
}`;

/** Takes a PR off its milestone. Variables: pr. */
export const CLEAR_PR_MILESTONE = `
mutation($pr: ID!) {
  updatePullRequest(input: { pullRequestId: $pr, milestoneId: null }) { pullRequest { id } }
}`;

/** A repository's open PRs, for a workspace with no board. Variables: prsQuery. */
export const OPEN_PRS = `
query($prsQuery: String!) {
  search(type: ISSUE, query: $prsQuery, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt isDraft reviewDecision
        repository { nameWithOwner }
        author { login }
        ${CHECKS}
      }
    }
  }
}`;

/**
 * One page of open bugs with their issue fields, for the count by priority. Issue search
 * cannot filter on an issue field, so the priorities are counted from the nodes.
 * Variables: bugsQuery, after.
 */
export const BUGS_PAGE = `
query($bugsQuery: String!, $after: String) {
  search(type: ISSUE, query: $bugsQuery, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue { ${ISSUE_FIELDS} }
    }
  }
}`;

/** The repository's labels whose names match `labelQuery`. Variables: owner, name, labelQuery. */
export const CUSTOMER_LABELS = `
query($owner: String!, $name: String!, $labelQuery: String!) {
  repository(owner: $owner, name: $name) {
    labels(first: 50, query: $labelQuery) { nodes { name } }
  }
}`;

/** The number of issues a search finds. Variables: searchQuery. */
export const ISSUE_COUNT = `
query($searchQuery: String!) {
  search(type: ISSUE, query: $searchQuery, first: 0) { issueCount }
}`;

/**
 * The state of each pinned GitHub item, so a pick checks itself once it closes or merges, with
 * an issue's board status and a PR's review decision for the focus card. Built per call: one
 * aliased repository per `owner/name`, one aliased lookup per number in it. No variables.
 * @param {Record<string, number[]>} byRepo The pinned numbers, keyed by `owner/name`.
 * @returns {{ query: string, aliases: Record<string, string> }} The document, and the alias of each repository.
 */
export function pickStates(byRepo) {
  const aliases = {};
  const blocks = Object.entries(byRepo).map(([repo, numbers], index) => {
    const [owner, name] = repo.split("/");
    aliases[repo] = `r${index}`;
    const lookups = numbers
      .map(
        (number) =>
          `n${Number(number)}: issueOrPullRequest(number: ${Number(number)}) {
        ... on Issue { state ${ANY_BOARD_FIELDS} }
        ... on PullRequest { state reviewDecision }
      }`,
      )
      .join("\n      ");
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n      ${lookups}\n    }`;
  });
  return { query: `query {\n  ${blocks.join("\n  ")}\n}`, aliases };
}

/**
 * What the Settings tab offers to pick from: your repositories, and the boards on your account
 * and your organizations.
 */
export const DISCOVER = `
query {
  viewer {
    login
    repositories(
      first: 100
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      nodes { nameWithOwner isArchived isPrivate isFork defaultBranchRef { name } }
    }
    projectsV2(first: 50) { nodes { number title closed ${OWNER_LOGIN} } }
    organizations(first: 50) {
      nodes { login projectsV2(first: 50) { nodes { number title closed ${OWNER_LOGIN} } } }
    }
  }
}`;

/** The boards linked to a repository. Variables: owner, name. */
export const REPO_BOARDS = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    projectsV2(first: 20) { nodes { number title closed ${OWNER_LOGIN} } }
  }
}`;

/** A board's single-select fields with their options, and its iteration fields. Variables: login, number. */
export const BOARD_FIELD_LIST = `
query($login: String!, $number: Int!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        title
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField { name options { name } }
            ... on ProjectV2IterationField { name }
          }
        }
      }
    }
  }
}`;

/**
 * One Daypack card's search on its own, for a card whose filter was just changed: the same
 * fields as that search in ACCOUNT. Variable: search (not "query", which gh uses for the document).
 */
export const ACCOUNT_SEARCHES = {
  review: `
query($search: String!) {
  search(type: ISSUE, query: $search, first: 50) {
    issueCount
    nodes { ... on PullRequest { number title url updatedAt reviewDecision repository { nameWithOwner } author { login } ${CHECKS} } }
  }
}`,
  myPrs: `
query($search: String!) {
  search(type: ISSUE, query: $search, first: 50) {
    issueCount
    nodes { ... on PullRequest { number title url updatedAt reviewDecision repository { nameWithOwner } ${CHECKS} } }
  }
}`,
  mine: `
query($search: String!) {
  search(type: ISSUE, query: $search, first: 100) {
    issueCount
    nodes { ... on Issue { number title url updatedAt repository { nameWithOwner } milestone { title } ${ANY_BOARD_FIELDS} } }
  }
}`,
};
