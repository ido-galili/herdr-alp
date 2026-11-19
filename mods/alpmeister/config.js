// Alpmeister's settings: which repository, board and queries it reads. They live outside
// this repo, in ~/.config/alp/alpmeister.json, so no team's names ship with the mod.
// `alpmeister.example.json` beside this file shows every key.

import { home, readTextFile } from "herdr";

const DEFAULTS = {
  project: { statusField: "Status", iterationField: "Iteration" },
  statuses: ["New", "Todo", "In Progress", "In Review", "Done"],
  notStarted: ["New", "Todo"],
  inFlight: { statuses: ["In Progress", "In Review"], excludeTypes: [] },
  mineHidden: ["New", "Done"],
  queries: {
    triage: "is:issue is:open label:triage",
    review: "is:pr draft:false is:open review-requested:@me sort:updated-desc",
    mine: "is:issue is:open assignee:@me sort:updated-desc",
    myPrs: "is:pr is:open author:@me draft:false sort:updated-desc",
  },
  bugs: {
    query: "is:issue is:open type:Bug",
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
  nightly: null,
  launch: { folder: "", issue: "", pr: "" },
};

/** Where the settings file lives. */
export const configPath = () => `${home()}/.config/alp/alpmeister.json`;

/** Where Alpmeister keeps its own state: the last result and today's focus. */
export const stateDir = () => `${home()}/.local/state/alp`;

/** A path with a leading `~` made absolute. */
export const expandHome = (path) => (path?.startsWith("~") ? home() + path.slice(1) : path);

/**
 * Reads and checks the settings file. Resolves with `{ config }`, or `{ error }` naming what
 * is missing, so the view can say how to fix it.
 */
export async function loadConfig() {
  const text = await readTextFile(configPath());
  if (!text) return { error: `No settings file. Copy alpmeister.example.json to ${configPath()} and fill it in.` };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { error: `${configPath()} is not valid JSON: ${error}` };
  }
  const [owner, name] = String(raw.repo ?? "").split("/");
  if (!owner || !name) return { error: `${configPath()} needs "repo": "owner/name".` };
  if (!raw.project?.owner || !Number.isInteger(raw.project?.number)) {
    return { error: `${configPath()} needs "project": { "owner": "...", "number": 1 }.` };
  }
  const config = {
    ...DEFAULTS,
    ...raw,
    owner,
    name,
    project: { ...DEFAULTS.project, ...raw.project },
    inFlight: { ...DEFAULTS.inFlight, ...raw.inFlight },
    queries: { ...DEFAULTS.queries, ...raw.queries },
    bugs: { ...DEFAULTS.bugs, ...raw.bugs },
    spotlight: { ...DEFAULTS.spotlight, ...raw.spotlight },
    customer: { ...DEFAULTS.customer, ...raw.customer },
    launch: { ...DEFAULTS.launch, ...raw.launch },
  };
  config.launch.folder = expandHome(config.launch.folder);
  return { config };
}
