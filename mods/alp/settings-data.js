// What the Settings tab offers to pick from, read from GitHub through `gh` and from your disk,
// and how it writes the settings file. Reading GitHub never changes it.

import { exec, home, readTextFile, writeTextFile } from "herdr";
import { configPath, tildePath } from "./config.js";
import { gh, graphql } from "./data.js";
import { BOARD_FIELD_LIST, DISCOVER, REPO_BOARDS } from "./queries.js";

/** Folders searched for local clones, under the home folder. */
const CLONE_ROOTS = ["projects", "code", "src", "dev", "work", "repos", "git", "github", "Developer"];

/**
 * A board as the pickers list it.
 * @param {object} node A ProjectV2 node with `number`, `title`, `closed` and `owner.login`.
 * @returns {{ owner: string, number: number, title: string, closed: boolean, key: string }}
 */
const boardOf = (node) => ({
  owner: node.owner?.login,
  number: node.number,
  title: node.title,
  closed: Boolean(node.closed),
  key: `${node.owner?.login}#${node.number}`,
});

/**
 * Your repositories and the boards on your account and organizations. Partial results are
 * kept: an organization that refuses the token loses only its boards.
 * @returns {Promise<{ login: string, repos: object[], boards: object[], warning: string | null }>}
 */
export async function discover() {
  const data = await graphql(DISCOVER, {}, { partial: true });
  const viewer = data.viewer;
  const boards = [
    ...(viewer.projectsV2?.nodes ?? []),
    ...(viewer.organizations?.nodes ?? []).flatMap((org) => org?.projectsV2?.nodes ?? []),
  ]
    .filter(Boolean)
    .map(boardOf);
  return {
    login: viewer.login,
    repos: viewer.repositories.nodes.map((repo) => ({
      repo: repo.nameWithOwner,
      isArchived: repo.isArchived,
      isPrivate: repo.isPrivate,
      isFork: repo.isFork,
      branch: repo.defaultBranchRef?.name ?? "main",
    })),
    boards,
    warning: viewer.projectsV2 ? null : "Boards need gh's read:project scope: gh auth refresh -s read:project",
  };
}

/**
 * A repository's linked boards, default branch and workflows.
 * @param {string} repo `owner/name`.
 * @returns {Promise<{ boards: object[], branch: string, workflows: { name: string, file: string }[] }>}
 */
export async function repoDetails(repo) {
  const [owner, name] = repo.split("/");
  const [data, workflows] = await Promise.all([
    graphql(REPO_BOARDS, { owner, name }, { partial: true }),
    gh(["api", `repos/${repo}/actions/workflows?per_page=100`]).catch(() => ({ workflows: [] })),
  ]);
  return {
    boards: (data?.repository?.projectsV2?.nodes ?? []).filter(Boolean).map(boardOf),
    branch: data?.repository?.defaultBranchRef?.name ?? "main",
    workflows: (workflows.workflows ?? [])
      .filter((workflow) => workflow.path?.startsWith(".github/"))
      .map((workflow) => ({ name: workflow.name, file: workflow.path.split("/").pop() })),
  };
}

/**
 * A board's single-select fields with their options, and its iteration fields.
 * @param {string} owner The board owner's login.
 * @param {number} number The board number.
 * @returns {Promise<{ title: string, selects: { name: string, options: string[] }[], iterations: string[] }>}
 * @throws {Error} When the board cannot be read.
 */
export async function boardFields(owner, number) {
  const data = await graphql(BOARD_FIELD_LIST, { login: owner, number });
  const board = data?.repositoryOwner?.projectV2;
  if (!board) throw new Error(`Cannot read board ${owner} #${number}`);
  const fields = board.fields.nodes.filter(Boolean);
  return {
    title: board.title,
    selects: fields
      .filter((field) => field.__typename === "ProjectV2SingleSelectField")
      .map((field) => ({ name: field.name, options: field.options.map((option) => option.name) })),
    iterations: fields.filter((field) => field.__typename === "ProjectV2IterationField").map((field) => field.name),
  };
}

/**
 * The GitHub repository a remote URL points at.
 * @param {string} url An SSH or HTTPS remote.
 * @returns {string | null} `owner/name`, or null for a remote elsewhere.
 */
function repoOfRemote(url) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Local clones of GitHub repositories under the usual code folders, by their `origin` remote.
 * A repository cloned twice keeps the shorter path, usually the main clone over a copy.
 * @returns {Promise<Record<string, string>>} Folders written with `~`, keyed by `owner/name`.
 */
export async function findClones() {
  const roots = CLONE_ROOTS.map((root) => `${home()}/${root}`);
  const found = await exec("find", [...roots, "-maxdepth", "4", "-type", "d", "-name", ".git", "-prune"], {
    timeout: 20000,
  });
  // find exits non-zero for a missing root, but still lists the rest.
  const folders = found.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/\/\.git$/, ""));
  const remotes = await Promise.all(
    folders.map((folder) =>
      exec("git", ["-C", folder, "remote", "get-url", "origin"], { timeout: 5000 })
        .then((result) => (result.code === 0 ? repoOfRemote(result.stdout) : null))
        .catch(() => null),
    ),
  );
  const clones = {};
  folders.forEach((folder, index) => {
    const repo = remotes[index];
    if (repo && (!clones[repo] || folder.length < clones[repo].length)) clones[repo] = folder;
  });
  return Object.fromEntries(Object.entries(clones).map(([repo, folder]) => [repo, tildePath(folder)]));
}

/**
 * How a board's statuses most likely split into in flight and hidden from your issues, by their
 * names, as setup used to guess them (the not-started ones are neither).
 * @param {string[]} statuses The board's status options, in board order.
 * @returns {{ inFlight: string[], mineHidden: string[], holdStatus: string }}
 */
export function guessRoles(statuses) {
  const matching = (pattern) => statuses.filter((status) => pattern.test(status));
  const notStarted = matching(/new|todo|to do|backlog|triage|ready/i);
  const started = notStarted.length ? notStarted : statuses.slice(0, 1);
  const late = /done|closed|hold|block|invalid|tested|cancel|won.?t/i;
  return {
    inFlight: statuses.filter((status) => !started.includes(status) && !late.test(status)),
    mineHidden: [...new Set([...started.slice(0, 1), ...matching(/done|hold|invalid/i)])],
    holdStatus: matching(/hold/i)[0] ?? "On Hold",
  };
}

/**
 * Writes the settings file over the version that was read, keeping the previous one as
 * `settings.json.bak`.
 * @param {object} settings The settings, as the file holds them.
 * @param {string | null} snapshot The file's text when it was read; null when it did not exist.
 * @returns {Promise<string>} The text written, the new snapshot.
 * @throws {Error} When the file changed on disk since it was read.
 */
export async function saveSettings(settings, snapshot) {
  const path = configPath();
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  await exec("mkdir", ["-p", path.replace(/\/[^/]+$/, "")]);
  const current = await readTextFile(path);
  if (current !== snapshot) throw new Error(`${path} changed on disk since it was read. Revert to load it.`);
  if (snapshot !== null) await exec("cp", [path, `${path}.bak`]);
  await writeTextFile(path, text, snapshot);
  return text;
}
