// The GraphQL documents Alpmeister sends through `gh api graphql`. Plain strings with no
// imports, so they can be tried from a shell as they are.

const STATUS_VALUE = `... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }`;
const ITERATION_VALUE = `... on ProjectV2ItemFieldIterationValue { title startDate duration }`;

/** The issue fields of an issue, such as Priority: single-select values with their field's name. */
const ISSUE_FIELDS = `
  issueFieldValues(first: 20) {
    nodes {
      ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldCommon { name } } }
    }
  }`;

/** The board fields of an issue: its status and iteration on the configured project. */
const BOARD_FIELDS = `
  projectItems(first: 10) {
    nodes {
      project { number owner { ... on Organization { login } ... on User { login } } }
      status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
      iteration: fieldValueByName(name: $iterationField) { ${ITERATION_VALUE} }
    }
  }`;

/**
 * Everything the view shows except the nightly run, in one request.
 * Variables: owner, name, projectOwner, projectNumber, statusField, iterationField,
 * inFlightFilter, triageQuery, reviewQuery, mineQuery, myPrsQuery.
 */
export const OVERVIEW = `
query(
  $owner: String!, $name: String!, $projectOwner: String!, $projectNumber: Int!,
  $statusField: String!, $iterationField: String!, $inFlightFilter: String!,
  $triageQuery: String!, $reviewQuery: String!, $mineQuery: String!, $myPrsQuery: String!
) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    url
    open: milestones(first: 20, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) {
      nodes {
        title number dueOn url
        issues(first: 100) {
          totalCount
          nodes {
            number title state url
            issueType { name }
            parent { number title url }
            labels(first: 10) { nodes { name } }
            subIssuesSummary { total completed }
            assignees(first: 3) { nodes { login } }
            ${ISSUE_FIELDS}
            ${BOARD_FIELDS}
          }
        }
      }
    }
    closed: milestones(first: 10, states: CLOSED, orderBy: { field: DUE_DATE, direction: DESC }) {
      nodes { title dueOn }
    }
  }
  board: organization(login: $projectOwner) {
    projectV2(number: $projectNumber) {
      url
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
  triage: search(type: ISSUE, query: $triageQuery, first: 0) { issueCount }
  reviews: search(type: ISSUE, query: $reviewQuery, first: 30) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt
        author { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  myPrs: search(type: ISSUE, query: $myPrsQuery, first: 30) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url updatedAt reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  mine: search(type: ISSUE, query: $mineQuery, first: 100) {
    issueCount
    nodes {
      ... on Issue {
        number title url updatedAt
        milestone { title }
        ${BOARD_FIELDS}
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

/** An issue's status on the board, as the pick lookups read it. Variables: statusField. */
const PICK_BOARD = `
      projectItems(first: 10) {
        nodes {
          project { number owner { ... on Organization { login } ... on User { login } } }
          status: fieldValueByName(name: $statusField) { ${STATUS_VALUE} }
        }
      }`;

/**
 * The state of each pinned GitHub item, so a pick checks itself once it closes or merges, with
 * an issue's board status and a PR's review decision for the focus card.
 * Built per call: one aliased lookup per number. Variables: owner, name, statusField.
 */
export function pickStates(numbers) {
  const lookups = numbers
    .map(
      (number) =>
        `n${Number(number)}: issueOrPullRequest(number: ${Number(number)}) {
      ... on Issue { state ${PICK_BOARD} }
      ... on PullRequest { state reviewDecision }
    }`,
    )
    .join("\n    ");
  return `query($owner: String!, $name: String!, $statusField: String!) {\n  repository(owner: $owner, name: $name) {\n    ${lookups}\n  }\n}`;
}
