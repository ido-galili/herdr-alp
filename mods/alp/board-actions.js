// The Board's writes to GitHub: a card's status (and an Undo putting it back) and iteration on
// the board, and its milestone.
// Each is one mutation through `gh api graphql`, with the ids the board load read.

import { graphql } from "./data.js";
import {
  CLEAR_BOARD_FIELD,
  CLEAR_ISSUE_MILESTONE,
  CLEAR_PR_MILESTONE,
  MOVE_BOARD_ITEM_AFTER,
  MOVE_BOARD_ITEM_FIRST,
  OPEN_MILESTONES,
  SET_BOARD_ITERATION,
  SET_BOARD_OPTION,
  SET_ISSUE_MILESTONE,
  SET_PR_MILESTONE,
} from "./queries.js";

/**
 * Moves a board item to another status, or to none.
 * @param {object} meta The board's ids, from the board load.
 * @param {{ itemId: string }} item The board item.
 * @param {string | null} status The status name, or null for no status.
 * @returns {Promise<void>}
 * @throws {Error} When the board has no Status field or no such option.
 */
export async function setStatus(meta, item, status) {
  if (status === null) {
    if (!meta.status) throw new Error("The board has no Status field.");
    await graphql(CLEAR_BOARD_FIELD, { project: meta.projectId, item: item.itemId, field: meta.status.fieldId });
    return;
  }
  const option = meta.status?.options[status];
  if (!option) throw new Error(`The board has no status ${status}.`);
  await graphql(SET_BOARD_OPTION, { project: meta.projectId, item: item.itemId, field: meta.status.fieldId, option });
}

/**
 * Moves a board item just after another one, or to the top of the board.
 * @param {object} meta The board's ids, from the board load.
 * @param {{ itemId: string }} item The board item.
 * @param {{ itemId: string } | null} after The item it follows, or null for the top.
 * @returns {Promise<void>}
 */
export async function setPosition(meta, item, after) {
  if (after) await graphql(MOVE_BOARD_ITEM_AFTER, { project: meta.projectId, item: item.itemId, after: after.itemId });
  else await graphql(MOVE_BOARD_ITEM_FIRST, { project: meta.projectId, item: item.itemId });
}

/**
 * Puts a board item in an iteration, or takes it out of every iteration.
 * @param {object} meta The board's ids, from the board load.
 * @param {{ itemId: string }} item The board item.
 * @param {{ id: string } | null} iteration The iteration, or null for none.
 * @returns {Promise<void>}
 * @throws {Error} When the board has no Iteration field.
 */
export async function setIteration(meta, item, iteration) {
  if (!meta.iteration) throw new Error("The board has no Iteration field.");
  const ids = { project: meta.projectId, item: item.itemId, field: meta.iteration.fieldId };
  if (iteration) await graphql(SET_BOARD_ITERATION, { ...ids, iteration: iteration.id });
  else await graphql(CLEAR_BOARD_FIELD, ids);
}

/**
 * Sets an issue's or a PR's milestone, or takes it off its milestone.
 * @param {{ kind: string, contentId: string }} item The board item: an issue or a PR.
 * @param {{ id: string } | null} milestone The milestone, or null for none.
 * @returns {Promise<void>}
 */
export async function setMilestone(item, milestone) {
  if (item.kind === "pr") {
    if (milestone) await graphql(SET_PR_MILESTONE, { pr: item.contentId, milestone: milestone.id });
    else await graphql(CLEAR_PR_MILESTONE, { pr: item.contentId });
  } else if (milestone) await graphql(SET_ISSUE_MILESTONE, { issue: item.contentId, milestone: milestone.id });
  else await graphql(CLEAR_ISSUE_MILESTONE, { issue: item.contentId });
}

/**
 * A repository's open milestones, soonest due first.
 * @param {string} repo `owner/name`.
 * @returns {Promise<{ id: string, title: string, dueOn: string | null }[]>}
 */
export async function openMilestones(repo) {
  const [owner, name] = repo.split("/");
  const result = await graphql(OPEN_MILESTONES, { owner, name });
  return result.repository?.milestones?.nodes ?? [];
}
