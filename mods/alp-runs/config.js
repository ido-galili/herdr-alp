// What the Run tab lists: the `runs` of Alp's config (alp-config.js), merged from your file, the
// repo's and your local one. Each run becomes an entry the runner can start. VS Code's
// launch.json and tasks.json are only read to import from (vscode.js).
//
// A run, as the files hold it:
//   "Dev server": {
//     "command": "npm run dev",        a string runs in the shell; a list runs the program directly
//     "cwd": "web",                    relative to the repo root; ${workspaceFolder} by default
//     "env": { "PORT": "5173" }, "envFile": "web/.env",
//     "dependsOn": ["Build"], "order": "sequence",   started first; "parallel" by default
//     "background": true,              a dependency that keeps running (others must exit 0 first)
//     "runs": ["API", "Web"],          a group: starts each of these instead of a command
//     "section": "Launch",             the heading it's listed under ("Runs" by default)
//     "macos": { … }, "linux": { … }, "windows": { … }   fields for that platform only
//   }

import { exec, home, notify, readTextFile } from "herdr";
import { loadConfig, originOf, writeLayer } from "./alp-config.js";
import { parseJsonc } from "./jsonc.js";
import { inputIds, unsupportedReason } from "./template.js";

/** Where saved commands were kept before Alp's config; moved into it once, then kept as .bak. */
export const COMMANDS_PATH = () => `${home()}/.config/alp/commands.json`;
export const DEFAULT_SECTION = "Runs";
const SECTION_ORDER = ["Launch", "Tasks", DEFAULT_SECTION];
const PLATFORM_KEY = { macos: "macos", linux: "linux", windows: "windows" };

/** A path with a leading `~` made absolute, without a trailing slash. */
export const expandHome = (path) => (path?.startsWith("~") ? home() + path.slice(1) : (path ?? "")).replace(/\/+$/, "");

/**
 * A list of names from a string, a list, or nothing.
 * @param {any} value The setting.
 * @returns {string[]}
 */
export const names = (value) =>
  value == null
    ? []
    : (Array.isArray(value) ? value : [value])
        .map((item) => (typeof item === "string" ? item : (item?.label ?? "")))
        .filter(Boolean);

/**
 * The workspace a folder belongs to: its git checkout, and the main checkout when it is a worktree.
 * @param {string} folder A folder in the workspace.
 * @returns {Promise<{ root: string, mainRoot: string, name: string, repo: boolean }>}
 */
export async function findWorkspace(folder) {
  const result = await exec("git", [
    "-C",
    folder,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-common-dir",
  ]).catch(() => null);
  const [root, common] = result?.code === 0 ? result.stdout.trim().split("\n") : [folder, ""];
  const absoluteCommon = common?.startsWith("/") ? common : `${root}/${common}`;
  const mainRoot = absoluteCommon.endsWith("/.git") ? absoluteCommon.slice(0, -5) : root;
  return { root, mainRoot, name: root.split("/").pop() ?? root, repo: result?.code === 0 };
}

/**
 * Every template an entry runs, so variables can be checked in one place.
 * @param {object} entry An entry without `unsupported` and `inputIds`.
 * @returns {string[]}
 */
function templatesOf(entry) {
  const command = entry.command;
  const words = !command ? [] : "argv" in command ? command.argv : [command.shell];
  return [...words, entry.cwd, entry.envFile ?? "", ...Object.values(entry.env ?? {})].map(String);
}

/**
 * A folder setting as a template: relative folders are under the repo root.
 * @param {any} cwd The run's `cwd`.
 * @returns {string}
 */
function folderTemplate(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "${workspaceFolder}";
  return /^(\/|~|\$\{)/.test(cwd) ? cwd : `\${workspaceFolder}/${cwd.replace(/^\.\//, "")}`;
}

/**
 * A run from the config as an entry the runner starts, with the platform's own block applied.
 * @param {string} name The run's name.
 * @param {object} raw Its merged value.
 * @param {string} platform "macos", "linux" or "windows".
 * @param {string} origin The layer it came from ("you", "repo" or "local").
 * @returns {object} The entry, with `unsupported` (why it can't run, or null) and `inputIds`.
 */
export function runEntry(name, raw, platform, origin = "repo") {
  const own = raw[PLATFORM_KEY[platform]] ?? {};
  const run = { ...raw, ...own, env: { ...raw.env, ...own.env } };
  const group = names(run.runs);
  const command =
    typeof run.command === "string" && run.command.trim()
      ? { shell: run.command, args: [] }
      : Array.isArray(run.command) && run.command.length
        ? { argv: run.command.map(String) }
        : null;
  const entry = {
    key: `run:${name}`,
    kind: group.length ? "compound" : "run",
    name,
    origin,
    section: typeof run.section === "string" && run.section.trim() ? run.section.trim() : DEFAULT_SECTION,
    cwd: folderTemplate(run.cwd),
    env: Object.fromEntries(Object.entries(run.env ?? {}).map(([key, value]) => [key, String(value)])),
    envFile: typeof run.envFile === "string" ? folderTemplate(run.envFile) : null,
    dependsOn: names(run.dependsOn),
    dependsOrder: run.order === "sequence" ? "sequence" : "parallel",
    isBackground: Boolean(run.background),
    configurations: group,
    command: group.length ? null : command,
  };
  const templates = templatesOf(entry);
  const empty = !entry.command && !group.length && !entry.dependsOn.length ? "has no command" : null;
  return {
    ...entry,
    unsupported: empty ?? templates.map(unsupportedReason).find(Boolean) ?? null,
    inputIds: [...new Set(templates.flatMap(inputIds))],
  };
}

/**
 * Marks groups that name a missing run or one that can't run here.
 * @param {object[]} entries All entries.
 * @returns {object[]} The same entries, groups checked.
 */
function checkGroups(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return entries.map((entry) => {
    if (entry.unsupported || entry.kind !== "compound") return entry;
    const missing = entry.configurations.find((name) => !byName.has(name));
    const blocked = entry.configurations.map((name) => byName.get(name)).find((part) => part?.unsupported);
    const reason = missing
      ? `names ${missing}, which isn't a run`
      : blocked
        ? `includes ${blocked.name}, which ${blocked.unsupported}`
        : null;
    return reason ? { ...entry, unsupported: reason } : entry;
  });
}

/**
 * The section headings in the order the Run tab shows them: Launch, Tasks and Runs first, then
 * the rest as they first appear.
 * @param {object[]} entries The entries.
 * @returns {string[]}
 */
export function sectionsOf(entries) {
  const seen = [...new Set(entries.map((entry) => entry.section))];
  return [
    ...SECTION_ORDER.filter((section) => seen.includes(section)),
    ...seen.filter((s) => !SECTION_ORDER.includes(s)),
  ];
}

/**
 * Whether the workspace has VS Code launch configs or tasks to import.
 * @param {{ root: string }} workspace From `findWorkspace`.
 * @returns {Promise<boolean>}
 */
async function hasVscode(workspace) {
  const files = await Promise.all(
    ["launch.json", "tasks.json"].map((file) => readTextFile(`${workspace.root}/.vscode/${file}`).catch(() => null)),
  );
  return files.some((text) => text != null);
}

/**
 * Everything the Run tab lists for a workspace.
 * @param {{ root: string, mainRoot: string }} workspace The workspace, from `findWorkspace`.
 * @param {string} platform "macos", "linux" or "windows".
 * @returns {Promise<{ runs: object[], sections: string[], inputs: Record<string, object>, errors: string[], layers: Record<string, object>, vscode: boolean }>}
 */
export async function loadEntries(workspace, platform) {
  const [{ layers, merged, errors }, vscode] = await Promise.all([loadConfig(workspace), hasVscode(workspace)]);
  const raw = merged.runs && typeof merged.runs === "object" ? merged.runs : {};
  // The repo file's order first, then runs only in your local file, then only in yours.
  const order = [
    ...new Set(["repo", "local", "you"].flatMap((layer) => Object.keys(layers[layer].value.runs ?? {}))),
  ].filter((name) => name in raw);
  const runs = checkGroups(
    order
      .map((name) => [name, raw[name]])
      .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
      .map(([name, value]) => runEntry(name, value, platform, originOf(layers, name))),
  );
  const inputs = Object.fromEntries(
    Object.entries(merged.inputs ?? {})
      .filter(([, input]) => input && typeof input === "object")
      .map(([id, input]) => [id, { ...input, id }]),
  );
  return { runs, sections: sectionsOf(runs), inputs, errors, layers, vscode };
}

/**
 * Saved commands in the earlier commands.json shape, as edits to Alp's config: the ones kept for
 * one workspace go to that repo's local file, the rest to yours.
 * @param {object[]} commands commands.json's `commands`.
 * @returns {{ layer: "you" | "local", root: string | null, edits: { path: string[], value: any }[] }[]}
 */
export function commandsAsEdits(commands) {
  const groups = new Map();
  for (const saved of commands) {
    if (!saved?.name || !saved.command) continue;
    const root = saved.workspace ? expandHome(saved.workspace) : null;
    const id = root ?? "";
    if (!groups.has(id)) groups.set(id, { layer: root ? "local" : "you", root, edits: [] });
    const run = {
      command: saved.command,
      ...(saved.cwd ? { cwd: saved.cwd } : {}),
      ...(saved.env ? { env: saved.env } : {}),
    };
    groups.get(id).edits.push({ path: ["runs", saved.name], value: run });
    for (const input of saved.inputs ?? []) {
      if (!input?.id) continue;
      const { id: inputId, ...definition } = input;
      groups.get(id).edits.push({ path: ["inputs", inputId], value: definition });
    }
  }
  return [...groups.values()];
}

/**
 * Moves the saved commands of commands.json into Alp's config once, then renames the file to
 * commands.json.bak. Does nothing when there is no commands.json.
 * @returns {Promise<boolean>} Whether anything moved.
 */
export async function migrateCommands() {
  const path = COMMANDS_PATH();
  const text = await readTextFile(path).catch(() => null);
  if (text == null) return false;
  let commands = [];
  try {
    commands = parseJsonc(text)?.commands ?? [];
  } catch (error) {
    notify({ title: "Saved commands not moved", body: `${path}: ${error?.message ?? error}`, level: "error" });
    return false;
  }
  for (const group of commandsAsEdits(commands)) {
    const workspace = group.root ? await findWorkspace(group.root) : null;
    await writeLayer(group.layer, workspace, group.edits);
  }
  await exec("mv", [path, `${path}.bak`]);
  notify({
    title: "Saved commands moved",
    body: "Your saved commands are now runs in Alp's config (~/.config/alp/alp.json, or the repo's .herdr/alp.local.json).",
  });
  return true;
}
