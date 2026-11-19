// Herds: the Claude Code sessions on this machine, the Herdr tab each runs in, and the links
// between them. A link is a SendMessage from one session to another, or a worktree one
// session made for another. Read from Claude Code's own files, which it never writes:
//   ~/.claude/sessions/<pid>.json        the live sessions: name, pid, folder, status
//   ~/.claude/jobs/<id>/state.json       a background session's state
//   ~/.claude/projects/*/<session>.jsonl a session's transcript, for the links it made
// A background session runs in no terminal. A tab showing it carries its name as the terminal's
// title, which links the two; else the person links them once, kept in
// ~/.local/state/alp/herds.json.

import { agents, exec, hc, home, readTextFile, writeTextFile } from "herdr";
import { stateDir } from "./config.js";

const claudeDir = () => `${home()}/.claude`;

/** The folder of the session registry, watched to redraw when a session starts, ends or moves. */
export const sessionsDir = () => `${claudeDir()}/sessions`;

const linksPath = () => `${stateDir()}/herds.json`;

/** Statuses as the agents list words them: working, blocked, done, idle. */
const REGISTRY_STATUS = { busy: "working", waiting: "blocked", idle: "idle", shell: "idle" };

/** Reads a JSON file; null when it is missing or unreadable. */
async function readJson(path) {
  const text = await readTextFile(path);
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.log(`alpmeister: ${path} unreadable: ${error}`);
    return null;
  }
}

/** The registry's sessions whose process is still running. */
async function liveSessions() {
  const list = await exec("ls", [sessionsDir()]);
  if (list.code !== 0) return [];
  const files = list.stdout.split("\n").filter((name) => /^\d+\.json$/.test(name));
  const entries = (await Promise.all(files.map((file) => readJson(`${sessionsDir()}/${file}`)))).filter(
    (session) => session?.pid && session.sessionId,
  );
  if (!entries.length) return [];
  const ps = await exec("ps", ["-o", "pid=", "-p", entries.map((session) => session.pid).join(",")]);
  const alive = new Set(ps.stdout.split(/\s+/).filter(Boolean).map(Number));
  return entries.filter((session) => alive.has(session.pid));
}

/** A background session's state from its job folder ("working", "blocked", "done"), or null. */
async function jobState(session) {
  if (!session.jobId) return null;
  return (await readJson(`${claudeDir()}/jobs/${session.jobId}/state.json`))?.state ?? null;
}

/** The git branch checked out in a folder, or null (not a repository, or a detached HEAD). */
async function branchIn(folder) {
  if (!folder) return null;
  const result = await exec("git", ["-C", folder, "branch", "--show-current"], { timeout: 5000 }).catch(() => null);
  return result?.code === 0 ? result.stdout.trim() || null : null;
}

/** The Herdr terminal of each Claude process, keyed by pid: Claude's pid is the terminal's foreground. */
async function terminalsByPid() {
  const claudes = agents().filter((agent) => agent.app === "claude-code" || agent.program?.name === "claude");
  const found = await Promise.all(
    claudes.map(async (agent) => {
      const result = await hc(["get", agent.address, "--json"]).catch(() => null);
      try {
        return result?.code === 0 ? [JSON.parse(result.stdout).foreground?.pid, agent.address] : null;
      } catch {
        return null;
      }
    }),
  );
  return new Map(found.filter((pair) => pair?.[0]));
}

/** A path with `.` and `..` worked out. */
function normalize(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The folder a `git worktree add ...` command makes, absolute, or null. */
export function worktreeFolder(command, cwd) {
  const match = command.match(/git\s+worktree\s+add\s+([^;&|\n]+)/);
  if (!match) return null;
  const tokens = match[1].trim().split(/\s+/).map((token) => token.replace(/^["']|["']$/g, ""));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-b", "-B", "--reason"].includes(token)) index += 1;
    else if (!token.startsWith("-")) {
      if (token.startsWith("/")) return normalize(token);
      if (token.startsWith("~")) return normalize(home() + token.slice(1));
      return normalize(`${cwd}/${token}`);
    }
  }
  return null;
}

/**
 * The links each session made, from its transcript: messages it sent (to a session name) and
 * worktrees it made (a folder). Only the lines of the main conversation that call those tools
 * are read: grep picks them out, so a long transcript costs little.
 */
async function linksMade(sessions) {
  const script = `cd "$1" || exit 0; shift
for id in "$@"; do
  for f in projects/*/"$id".jsonl; do
    [ -f "$f" ] || continue
    grep -h -e '"name":"SendMessage"' -e 'git worktree add' "$f" | grep '"type":"assistant"' | sed "s/^/$id	/"
  done
done`;
  const ids = sessions.map((session) => session.sessionId);
  const result = await exec("sh", ["-c", script, "sh", claudeDir(), ...ids], { timeout: 60000 });
  const made = [];
  const seen = new Set();
  for (const line of result.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    let entry;
    try {
      entry = JSON.parse(line.slice(tab + 1));
    } catch {
      continue;
    }
    const at = Date.parse(entry.timestamp);
    for (const use of entry.message?.content ?? []) {
      if (use?.type !== "tool_use" || seen.has(use.id)) continue;
      seen.add(use.id);
      if (use.name === "SendMessage" && use.input?.to) {
        made.push({ from: line.slice(0, tab), kind: "message", to: String(use.input.to), at });
      } else if (use.name === "Bash" && /git\s+worktree\s+add/.test(use.input?.command ?? "")) {
        made.push({ from: line.slice(0, tab), kind: "worktree", command: use.input.command, at });
      }
    }
  }
  return made;
}

/** The tabs linked to background sessions by hand: `{ sessionId: terminal address }`. */
export async function loadTabLinks() {
  return (await readJson(linksPath()))?.links ?? {};
}

/** Links a background session to the tab that shows it, or unlinks it with a null address. */
export async function saveTabLink(sessionId, address) {
  const before = await readTextFile(linksPath());
  let links = {};
  try {
    links = before ? (JSON.parse(before).links ?? {}) : {};
  } catch {
    links = {};
  }
  if (address) links[sessionId] = address;
  else delete links[sessionId];
  await exec("mkdir", ["-p", stateDir()]);
  await writeTextFile(linksPath(), `${JSON.stringify({ links }, null, 2)}\n`, before);
}

/**
 * Everything the Herds tab draws:
 * - `sessions`: `{ id, name, kind, entrypoint, cwd, branch, terminal, linked, shownIn, viewer,
 *   status }`. `branch` is the one checked out in the session's folder when it was read.
 *   `terminal` is the Herdr terminal it runs in or is shown in; `shownIn` says that terminal
 *   shows this background session (by its title, or `linked` by a person); `viewer` says a
 *   session's own terminal shows a background session instead.
 * - `links`: `{ from, to, kind: "message" | "worktree", at }` between session ids, the latest
 *   of each kind per pair.
 */
export async function loadHerds() {
  const [sessions, byPid, tabLinks] = await Promise.all([liveSessions(), terminalsByPid(), loadTabLinks()]);
  const live = agents();
  const addresses = new Set(live.map((agent) => agent.address));
  const shown = await Promise.all(
    sessions.map(async (session) => {
      const linked = addresses.has(tabLinks[session.sessionId]) ? tabLinks[session.sessionId] : null;
      // A Claude tab that shows a background session is titled with the session's name.
      const titled =
        session.kind === "bg" && session.name
          ? (live.find((agent) => agent.app === "claude-code" && agent.title === session.name)?.address ?? null)
          : null;
      const [state, branch] = await Promise.all([
        session.kind === "bg" ? jobState(session) : null,
        branchIn(session.cwd),
      ]);
      return {
        id: session.sessionId,
        name: session.name || session.sessionId.slice(0, 8),
        names: [session.name, ...(session.formerNames ?? []).map((former) => former.name)].filter(Boolean),
        kind: session.kind,
        entrypoint: session.entrypoint,
        cwd: session.cwd,
        branch,
        terminal: linked ?? titled ?? byPid.get(session.pid) ?? null,
        linked: Boolean(linked),
        shownIn: Boolean(linked || titled),
        viewer: Boolean(session.parkedJobId),
        status: state ?? REGISTRY_STATUS[session.status] ?? "idle",
      };
    }),
  );
  const byName = new Map();
  for (const session of shown) for (const name of session.names) byName.set(name, session.id);

  const latest = new Map();
  for (const made of await linksMade(sessions)) {
    const sender = shown.find((session) => session.id === made.from);
    let to = null;
    if (made.kind === "message") to = byName.get(made.to) ?? null;
    else {
      const folder = worktreeFolder(made.command, sender?.cwd ?? "/");
      to = folder
        ? (shown.find((session) => session.cwd === folder || session.cwd?.startsWith(`${folder}/`))?.id ?? null)
        : null;
    }
    if (!to || to === made.from) continue;
    const key = `${made.from} ${to} ${made.kind}`;
    if (!latest.has(key) || latest.get(key).at < made.at) {
      latest.set(key, { from: made.from, to, kind: made.kind, at: made.at });
    }
  }
  return { sessions: shown, links: [...latest.values()], loadedAt: Date.now() };
}

/**
 * The herds: sessions joined by links, each led by its herdsman (the one that made the most
 * links), its others in name order, and the links among them. `grazing` are the sessions with no
 * link. A terminal showing a background session is that session's, so the session of its own
 * is left out.
 */
export function herdsOf({ sessions, links }) {
  const showing = new Set(sessions.filter((session) => session.shownIn).map((session) => session.terminal));
  const visible = sessions.filter(
    (session) => session.shownIn || !session.terminal || !showing.has(session.terminal),
  );
  const ids = new Set(visible.map((session) => session.id));
  const kept = links.filter((link) => ids.has(link.from) && ids.has(link.to));
  const neighbors = new Map(visible.map((session) => [session.id, new Set()]));
  for (const link of kept) {
    neighbors.get(link.from).add(link.to);
    neighbors.get(link.to).add(link.from);
  }
  const herds = [];
  const placed = new Set();
  for (const session of visible) {
    if (placed.has(session.id) || !neighbors.get(session.id).size) continue;
    const members = [];
    const queue = [session.id];
    placed.add(session.id);
    while (queue.length) {
      const id = queue.shift();
      members.push(id);
      for (const next of neighbors.get(id)) {
        if (!placed.has(next)) {
          placed.add(next);
          queue.push(next);
        }
      }
    }
    const made = (id) => kept.filter((link) => link.from === id).length;
    const herdsman = [...members].sort((a, b) => made(b) - made(a))[0];
    const byId = (id) => visible.find((candidate) => candidate.id === id);
    herds.push({
      herdsman: byId(herdsman),
      members: members
        .filter((id) => id !== herdsman)
        .map(byId)
        .sort((a, b) => a.name.localeCompare(b.name)),
      links: kept.filter((link) => members.includes(link.from)),
    });
  }
  return {
    herds,
    grazing: visible.filter((session) => !placed.has(session.id)).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
