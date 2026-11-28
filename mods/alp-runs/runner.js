// Starts entries as herdr-core terminals and reads them back as sessions. Each run is a named,
// labelled terminal, so agents find it with `hc ls --label alp.workspace=<root>` and read it with
// `hc read <name>`. A wrapper keeps the terminal open after the command ends, so its output stays,
// and records the exit code as the `alp.run.exit` label.

import { exec, hc, home, readTextFile, run, setShared, shared, terminals } from "herdr";
import { quote, resolveRaw, resolveText, resolveWord } from "./template.js";

export const LABEL = {
  run: "alp.run",
  key: "alp.run.key",
  kind: "alp.run.kind",
  workspace: "alp.workspace",
  exit: "alp.run.exit",
};
const STARTED_KEY = "alp.runs.started";
const POSIX_SHELLS = new Set(["zsh", "bash", "sh", "dash", "ksh"]);
const MAX_DEPTH = 8;
export const LIST_GRACE_MS = 5000;

let shellPath = null;

/**
 * The shell the wrapper runs in: the person's login shell when it is a POSIX one that exists,
 * else the first of zsh, bash and sh that is installed (a fish user on Linux may have no zsh).
 * @returns {Promise<string>} The shell's path.
 */
async function loginShell() {
  if (shellPath) return shellPath;
  const script = [
    'case "${SHELL##*/}" in zsh|bash|sh|dash|ksh) [ -x "$SHELL" ] && { printf %s "$SHELL"; exit; };; esac',
    'for s in /bin/zsh /usr/bin/zsh /bin/bash /usr/bin/bash; do [ -x "$s" ] && { printf %s "$s"; exit; }; done',
    "printf /bin/sh",
  ].join("\n");
  const result = await exec("sh", ["-c", script]).catch(() => null);
  const found = result?.stdout.trim();
  shellPath = found && POSIX_SHELLS.has(found.split("/").pop()) ? found : "/bin/sh";
  return shellPath;
}

/**
 * Every run terminal, newest first.
 * @returns {{ address: string, name: string, title: string, key: string, kind: string, workspace: string, exit: number | null, running: boolean, pid: number, foregroundPid: number | null }[]}
 */
export function sessions() {
  return terminals()
    .filter((terminal) => terminal.state === "live" && terminal.labels?.[LABEL.run])
    .map((terminal) => {
      const exit = terminal.labels[LABEL.exit];
      return {
        address: terminal.address,
        name: terminal.name,
        title: terminal.labels[LABEL.run],
        key: terminal.labels[LABEL.key] ?? "",
        kind: terminal.labels[LABEL.kind] ?? "",
        workspace: terminal.labels[LABEL.workspace] ?? "",
        exit: exit == null || exit === "" ? null : Number(exit),
        running: exit == null || exit === "",
        pid: terminal.pid,
        foregroundPid: terminal.foreground?.pid ?? null,
        created: terminal.created_ms ?? 0,
      };
    })
    .sort((a, b) => b.created - a.created);
}

/** The session an entry has in a workspace, if any. */
export const sessionFor = (key, root) =>
  sessions().find((session) => session.key === key && session.workspace === root);

/**
 * The inputs an entry asks for before it starts, its dependencies and compound parts included.
 * @param {object} entry The entry.
 * @param {object} catalog From `loadEntries`.
 * @returns {object[]} Input definitions, in order of first use.
 */
export function neededInputs(entry, catalog) {
  const ids = [];
  const seen = new Set();
  const visit = (current, depth) => {
    if (!current || seen.has(current.key) || depth > MAX_DEPTH) return;
    seen.add(current.key);
    current.dependsOn.forEach((name) => visit(findRun(catalog, name), depth + 1));
    (current.configurations ?? []).forEach((name) => visit(findRun(catalog, name), depth + 1));
    current.inputIds.forEach((id) => ids.includes(id) || ids.push(id));
  };
  visit(entry, 0);
  return ids.map((id) => entry.inputDefs?.[id] ?? catalog.inputs[id] ?? { id, type: "promptString", description: id });
}

/**
 * A run by its name.
 * @param {object} catalog From `loadEntries`.
 * @param {string} name The run's name.
 * @returns {object | undefined}
 */
const findRun = (catalog, name) => catalog.runs.find((run) => run.name === name);

/** A terminal name: 1-32 of a-z 0-9 - _, unique among live terminals. */
function uniqueName(title, workspace) {
  const slug = (text) =>
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const taken = new Set(
    terminals()
      .filter((terminal) => terminal.state === "live")
      .map((terminal) => terminal.name),
  );
  const base = slug(title).slice(0, 24).replace(/-+$/, "") || "run";
  const candidates = [base, `${base}-${slug(workspace.name)}`.slice(0, 32).replace(/-+$/, "")];
  for (let n = 2; n < 100; n++) candidates.push(`${base.slice(0, 28)}-${n}`);
  return candidates.find((name) => !taken.has(name));
}

/**
 * KEY=VALUE lines of a dotenv file, as VS Code's `envFile` reads them.
 * @param {string} path The file.
 * @returns {Promise<Record<string, string>>}
 */
async function readEnvFile(path) {
  const text = await readTextFile(path).catch(() => null);
  if (text == null) throw new Error(`envFile ${path} not found`);
  const env = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    env[match[1]] = quoted ? quoted[2].replace(/\\n/g, quoted[1] === '"' ? "\n" : "\\n") : value.replace(/\s+#.*$/, "");
  }
  return env;
}

/**
 * The command line an entry runs, as shell source.
 * @param {object} command The entry's `command`.
 * @param {object} context What variables resolve to.
 * @returns {string}
 */
export function commandLine(command, context) {
  if ("argv" in command) {
    const words = command.argv.map((word) => resolveWord(word, context));
    return [...words, ...(command.tail ? [resolveRaw(command.tail, context)] : [])].join(" ");
  }
  const args = command.args.map((arg) =>
    arg.quoted ? resolveWord(arg.template, context) : resolveRaw(arg.template, context),
  );
  return [resolveRaw(command.shell, context), ...args].join(" ");
}

/**
 * The script the terminal runs: the command in a subshell, then the exit label and a held terminal.
 * @param {object} entry The entry.
 * @param {string} name The terminal's name.
 * @param {object} context What variables resolve to.
 * @param {Record<string, string>} fileEnv The envFile's variables.
 * @returns {string}
 */
function wrapperScript(entry, name, context, fileEnv) {
  const exports = [
    ...Object.entries(fileEnv).map(([key, value]) => `export ${key}=${quote(value)}`),
    ...Object.entries(entry.env).map(([key, value]) => `export ${key}=${resolveWord(String(value), context)}`),
  ];
  return [
    "trap : INT",
    `(${[...exports, commandLine(entry.command, context)].join("\n")}\n)`,
    "alp_exit=$?",
    `hc label ${quote(name)} ${LABEL.exit}=$alp_exit >/dev/null 2>&1`,
    `printf '\\n\\033[2m[%s exited with %s]\\033[0m\\n' ${quote(entry.name)} "$alp_exit"`,
    "exec tail -f /dev/null",
  ].join("\n");
}

/**
 * Starts one entry's own command as a session. A running session of the same entry is kept; a
 * finished one is replaced.
 * @returns {Promise<string>} The session's terminal address.
 */
async function startSession(entry, workspace, answers) {
  const existing = sessionFor(entry.key, workspace.root);
  if (existing?.running) return existing.address;
  if (existing) await closeAndWait(existing.address);
  const context = { workspace: workspace.root, home: home(), answers };
  const cwd = resolveText(entry.cwd, context);
  const fileEnv = entry.envFile ? await readEnvFile(resolveText(entry.envFile, context)) : {};
  const name = uniqueName(entry.name, workspace);
  const shell = await loginShell();
  const labels = [
    [LABEL.run, entry.name],
    [LABEL.key, entry.key],
    [LABEL.kind, entry.kind],
    [LABEL.workspace, workspace.root],
  ].flatMap(([key, value]) => ["--label", `${key}=${value}`]);
  const script = wrapperScript(entry, name, context, fileEnv);
  const result = await hc([
    "run",
    "--bg",
    "--json",
    "--no-parent",
    "--name",
    name,
    "--cwd",
    cwd,
    ...labels,
    "--",
    shell,
    "-l",
    "-i",
    "-c",
    script,
  ]);
  if (result.code !== 0) throw new Error(`${entry.name}: ${(result.stderr || result.stdout).trim()}`);
  const address = JSON.parse(result.stdout).address;
  const started = shared(STARTED_KEY) ?? {};
  setShared(STARTED_KEY, { ...started, [address]: { answers } });
  return address;
}

/** Ends a terminal and resolves once herdr-core no longer lists it, so its name is free again. */
export async function closeAndWait(address) {
  await hc(["kill", address]);
  for (
    let i = 0;
    i < 30 && terminals().some((terminal) => terminal.address === address && terminal.state === "live");
    i++
  ) {
    await exec("sleep", ["0.1"]);
  }
}

/**
 * Resolves when a session's command exits; rejects when its terminal goes first. Herdr's live
 * terminal list shows a new terminal a moment after `hc run` returns, so a terminal not seen yet
 * gets `LIST_GRACE_MS` to appear.
 */
async function waitForExit(address) {
  const started = Date.now();
  let seen = false;
  for (;;) {
    const session = sessions().find((candidate) => candidate.address === address);
    if (session) seen = true;
    else if (seen || Date.now() - started > LIST_GRACE_MS) throw new Error("its terminal was closed");
    if (session && !session.running) return session.exit;
    await exec("sleep", ["0.5"]);
  }
}

/**
 * Starts an entry: its dependencies first (waiting for those that aren't background tasks), then
 * its own command or, for a compound, each of its configurations.
 * @param {object} entry The entry.
 * @param {object} catalog From `loadEntries`.
 * @param {{ root: string, name: string }} workspace From `findWorkspace`.
 * @param {Record<string, string>} answers The inputs' answers.
 * @returns {Promise<string | null>} The address of the session to show, if any.
 */
export async function startEntry(entry, catalog, workspace, answers, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error(`${entry.name}: dependencies nest too deep`);
  if (entry.unsupported) throw new Error(`${entry.name} ${entry.unsupported}`);
  const runDependency = async (name) => {
    const task = findRun(catalog, name);
    if (!task) throw new Error(`${entry.name}: no run named ${name}`);
    const address = await startEntry(task, catalog, workspace, answers, depth + 1);
    if (!address || task.isBackground) return;
    const exit = await waitForExit(address);
    if (exit !== 0) throw new Error(`${name} exited with ${exit}, so ${entry.name} didn't start`);
  };
  if (entry.dependsOrder === "sequence") for (const name of entry.dependsOn) await runDependency(name);
  else await Promise.all(entry.dependsOn.map(runDependency));
  if (entry.kind === "compound") {
    const addresses = [];
    for (const name of entry.configurations) {
      const part = findRun(catalog, name);
      if (!part) throw new Error(`${entry.name}: no run named ${name}`);
      addresses.push(await startEntry(part, catalog, workspace, answers, depth + 1));
    }
    return addresses.find(Boolean) ?? null;
  }
  return entry.command ? startSession(entry, workspace, answers) : null;
}

/** The answers a session started with, for a restart. */
export const startedAnswers = (address) => (shared(STARTED_KEY) ?? {})[address]?.answers ?? {};

/**
 * Interrupts a running session's command: SIGINT to its foreground process group, as Ctrl-C would,
 * or `signal` when given. The terminal and its output stay.
 * @param {object} session From `sessions()`.
 * @param {"INT" | "TERM" | "KILL"} signal The signal.
 */
export async function stopSession(session, signal = "INT") {
  if (!session.running) return;
  const target = session.foregroundPid && session.foregroundPid !== session.pid ? session.foregroundPid : null;
  const script = target
    ? 'pg=$(ps -o pgid= -p "$2" | tr -d " "); [ -n "$pg" ] && kill -"$1" -- "-$pg"'
    : 'pkill -"$1" -P "$3"';
  await exec("sh", ["-c", script, "sh", signal, String(target ?? ""), String(session.pid)]);
}

/** Ends a session's terminal and its output. */
export const closeSession = (session) => run("terminal.kill", { terminal: session.address });

/** Drops what is remembered about sessions that are gone. */
export function forgetClosedSessions() {
  const started = shared(STARTED_KEY) ?? {};
  const live = new Set(sessions().map((session) => session.address));
  const kept = Object.fromEntries(Object.entries(started).filter(([address]) => live.has(address)));
  if (Object.keys(kept).length !== Object.keys(started).length) setShared(STARTED_KEY, kept);
}
