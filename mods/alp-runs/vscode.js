// VS Code's launch.json and tasks.json, read only to import from: each configuration, compound
// and task becomes a run in Alp's config (see config.js for the shape), or says why it can't.

import { readTextFile } from "herdr";
import { names, runEntry } from "./config.js";
import { parseJsonc } from "./jsonc.js";

const NODE_TYPES = new Set(["node", "pwa-node"]);
const PYTHON_TYPES = new Set(["python", "debugpy"]);
const BROWSER_TYPES = new Set(["chrome", "pwa-chrome", "msedge", "pwa-msedge", "firefox"]);
const PLATFORMS = { osx: "macos", linux: "linux", windows: "windows" };

/** A string, or the `value` of VS Code's `{ value, quoting }` form. */
const text = (value) => (typeof value === "string" ? value : typeof value?.value === "string" ? value.value : "");

/** A word for a shell line, quoted when it needs to be. */
const word = (value) => (/^[A-Za-z0-9_@%+=:,./${}-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/**
 * Drops empty settings so the imported run stays short.
 * @param {object} run A run.
 * @returns {object}
 */
function tidy(run) {
  return Object.fromEntries(
    Object.entries(run).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        value !== false &&
        !(Array.isArray(value) && !value.length) &&
        !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length),
    ),
  );
}

/**
 * A folder from VS Code as the run's `cwd`: under the workspace folder it becomes relative.
 * @param {string | undefined} cwd VS Code's `cwd`.
 * @returns {string | undefined}
 */
function folder(cwd) {
  if (!cwd || cwd === "${workspaceFolder}") return undefined;
  return cwd.startsWith("${workspaceFolder}/") ? cwd.slice("${workspaceFolder}/".length) : cwd;
}

/**
 * A launch configuration as a run, or why it can't be one.
 * @param {object} config One item of `configurations`.
 * @returns {{ run: object | null, reason: string | null }}
 */
function fromLaunch(config) {
  const dependsOn = names(config.preLaunchTask);
  const base = {
    section: "Launch",
    cwd: folder(config.cwd),
    env: config.env,
    envFile: config.envFile ? folder(config.envFile) : undefined,
    dependsOn,
    order: dependsOn.length > 1 ? "sequence" : undefined,
    background: true,
  };
  if (config.request && config.request !== "launch")
    return { run: null, reason: "attaches a debugger to a running program" };
  if (BROWSER_TYPES.has(config.type)) return { run: null, reason: "opens a browser under VS Code's debugger" };
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  if (config.type === "node-terminal") return { run: tidy({ ...base, command: config.command ?? "" }), reason: null };
  if (NODE_TYPES.has(config.type)) {
    if (!config.program && !config.runtimeExecutable && !args.length && typeof config.args !== "string") {
      return dependsOn.length ? { run: tidy(base), reason: null } : { run: null, reason: "names no program to run" };
    }
    const argv = [
      config.runtimeExecutable ?? "node",
      ...(config.runtimeArgs ?? []).map(String),
      ...(config.program ? [config.program] : []),
      ...args,
    ];
    // `args` as one string is shell text: the run becomes a shell line.
    const command = typeof config.args === "string" ? `${argv.map(word).join(" ")} ${config.args}` : argv;
    return { run: tidy({ ...base, command }), reason: null };
  }
  if (PYTHON_TYPES.has(config.type)) {
    const target = config.module ? ["-m", config.module] : config.program ? [config.program] : null;
    if (!target) return { run: null, reason: "names no program to run" };
    return { run: tidy({ ...base, command: [config.python ?? "python3", ...target, ...args] }), reason: null };
  }
  return { run: null, reason: `uses the ${config.type} debugger` };
}

/**
 * The parts of a task that make a run: its command, folder and environment.
 * @param {object} task A task, with any platform block already applied.
 * @returns {{ fields: object, reason: string | null }}
 */
function taskFields(task) {
  const cwd = folder(task.options?.cwd);
  const env = task.options?.env;
  if (task.type === "npm") {
    const path = task.path ? task.path.replace(/\/+$/, "") : undefined;
    return { fields: { command: `npm run ${task.script}`, cwd: path ?? cwd, env }, reason: null };
  }
  if (task.type && !["shell", "process"].includes(task.type)) {
    return { fields: {}, reason: `is a ${task.type} task, which needs its VS Code extension` };
  }
  const command = text(task.command);
  if (!command) return { fields: { cwd, env }, reason: names(task.dependsOn).length ? null : "has no command" };
  const args = (task.args ?? []).map(text);
  if (task.type === "process") return { fields: { command: [command, ...args], cwd, env }, reason: null };
  return {
    fields: { command: [command, ...args.map((arg) => (/\s/.test(arg) ? word(arg) : arg))].join(" "), cwd, env },
    reason: null,
  };
}

/**
 * A task as a run, or why it can't be one. Its `osx`, `linux` and `windows` blocks become the
 * run's `macos`, `linux` and `windows` blocks, holding what differs on that platform.
 * @param {object} raw One item of `tasks`.
 * @returns {{ name: string, run: object | null, reason: string | null }}
 */
function fromTask(raw) {
  const name = raw.label ?? raw.taskName ?? text(raw.command);
  const { fields, reason } = taskFields(raw);
  if (reason) return { name, run: null, reason };
  const dependsOn = names(raw.dependsOn);
  const run = {
    section: "Tasks",
    ...fields,
    dependsOn,
    order: raw.dependsOrder === "sequence" ? "sequence" : undefined,
    background: Boolean(raw.isBackground),
  };
  for (const [vscodeKey, platform] of Object.entries(PLATFORMS)) {
    const own = raw[vscodeKey];
    if (!own) continue;
    const merged = {
      ...raw,
      ...own,
      options: { ...raw.options, ...own.options, env: { ...raw.options?.env, ...own.options?.env } },
    };
    const result = taskFields(merged);
    if (result.reason) continue;
    const diff = Object.fromEntries(
      Object.entries(result.fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(fields[key])),
    );
    if (Object.keys(diff).length) run[platform] = tidy(diff);
  }
  return { name, run: tidy(run), reason: null };
}

/**
 * Reads a JSONC file from .vscode.
 * @param {string} path Where it is.
 * @param {string[]} errors Where a parse error is reported.
 * @returns {Promise<object>} Its value ({} when absent or broken).
 */
async function readFile(path, errors) {
  const source = await readTextFile(path).catch(() => null);
  if (source == null) return {};
  try {
    return parseJsonc(source) ?? {};
  } catch (error) {
    errors.push(`${path.split("/").slice(-2).join("/")}: ${error}`);
    return {};
  }
}

/**
 * Everything in a workspace's .vscode that could be imported, each as a run or with the reason
 * it can't be. Names that two items share keep the first (launch configs before tasks).
 * @param {{ root: string }} workspace From `findWorkspace`.
 * @param {string} platform "macos", "linux" or "windows", to check the runs here.
 * @returns {Promise<{ items: object[], inputs: Record<string, object>, errors: string[] }>} Items are
 *   `{ key, group: "Launch" | "Tasks", name, run, reason, needs, inputIds }`.
 */
export async function readVscode(workspace, platform) {
  const errors = [];
  const [launch, tasks] = await Promise.all([
    readFile(`${workspace.root}/.vscode/launch.json`, errors),
    readFile(`${workspace.root}/.vscode/tasks.json`, errors),
  ]);
  const inputs = Object.fromEntries(
    [...(launch.inputs ?? []), ...(tasks.inputs ?? [])]
      .filter((input) => input?.id)
      .map(({ id, ...definition }) => [id, definition]),
  );
  const raw = [
    ...(launch.compounds ?? [])
      .filter((compound) => compound?.name)
      .map((compound) => ({
        group: "Launch",
        name: compound.name,
        run: tidy({
          section: "Launch",
          runs: names(compound.configurations),
          dependsOn: names(compound.preLaunchTask),
        }),
        reason: null,
      })),
    ...(launch.configurations ?? [])
      .filter((config) => config?.name)
      .map((config) => ({ group: "Launch", name: config.name, ...fromLaunch(config) })),
    ...(tasks.tasks ?? []).map((task) => ({ group: "Tasks", ...fromTask(task) })).filter((item) => item.name),
  ];
  const seen = new Set();
  const items = raw.map((item) => {
    const clash = seen.has(item.name);
    seen.add(item.name);
    const entry = item.run ? runEntry(item.name, item.run, platform) : null;
    const commandInput = entry?.inputIds.find((id) => inputs[id]?.type === "command");
    const reason = clash
      ? "has the same name as another config"
      : (item.reason ??
        (commandInput ? `asks \${input:${commandInput}} through a VS Code command` : null) ??
        (entry?.unsupported === "has no command" ? null : entry?.unsupported) ??
        null);
    return {
      key: `${item.group}:${item.name}`,
      group: item.group,
      name: item.name,
      run: reason ? null : item.run,
      reason,
      needs: entry ? [...entry.dependsOn, ...entry.configurations] : [],
      inputIds: entry?.inputIds ?? [],
    };
  });
  return { items, inputs, errors };
}
