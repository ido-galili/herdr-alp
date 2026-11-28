// Herds: the Claude Code sessions on this machine, the Herdr tab each runs in, the links
// between them, and the agents each one started. A link is a SendMessage from one session to
// another, or a worktree one session made for another. Read from Claude Code's own files, which
// Alpmeister never writes:
//   ~/.claude/sessions/<pid>.json        the live sessions: name, pid, folder, status
//   ~/.claude/jobs/<id>/state.json       a background session's state
//   ~/.claude/projects/*/<session>.jsonl a session's transcript, for the links it made
//   ~/.claude/projects/*/<session>/subagents/agent-<id>.meta.json and .jsonl
//                                        the agents it started (Agent tool): what each is for,
//                                        its type, whether it finished; its own transcript
// A background session runs in no terminal. A tab showing it carries its name as the terminal's
// title, which links the two; else the person links them once, kept in
// ~/.local/state/alp/herds.json.

import { agents, exec, hc, home, readTextFile, writeTextFile } from "herdr";
import { stateDir } from "./config.js";

const claudeDir = () => `${home()}/.claude`;

/** The folder of the session registry, watched to redraw when a session starts, ends or moves. */
export const sessionsDir = () => `${claudeDir()}/sessions`;

const linksPath = () => `${stateDir()}/herds.json`;

/** How long a finished agent stays in its session's row before it folds into "finished earlier". */
export const AGENT_RECENT = 30 * 60000;

/** An unfinished agent whose transcript has not changed for this long shows as idle, not working. */
const AGENT_QUIET = 3 * 60000;

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

/**
 * The Herdr terminal of each Claude process, keyed by pid. The terminal's foreground is Claude
 * itself, or a shell that started it (a tab opened with `fish -ic … claude`), so each foreground's
 * child processes map to its terminal too.
 * @returns {Promise<Map<number, string>>} Terminal addresses by pid.
 */
async function terminalsByPid() {
  const claudes = agents().filter((agent) => agent.app === "claude-code" || agent.program?.name === "claude");
  const [found, ps] = await Promise.all([
    Promise.all(
      claudes.map(async (agent) => {
        const result = await hc(["get", agent.address, "--json"]).catch(() => null);
        try {
          return result?.code === 0 ? [JSON.parse(result.stdout).foreground?.pid, agent.address] : null;
        } catch {
          return null;
        }
      }),
    ),
    exec("ps", ["-e", "-o", "pid=,ppid="]).catch(() => null),
  ]);
  const byPid = new Map(found.filter((pair) => pair?.[0]));
  for (const line of ps?.code === 0 ? ps.stdout.split("\n") : []) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && byPid.has(ppid) && !byPid.has(pid)) byPid.set(pid, byPid.get(ppid));
  }
  return byPid;
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

/**
 * The agents each session started, from the files Claude Code keeps beside its transcript: one
 * `agent-<id>.meta.json` (description, type, fork, foreground or background, model, finished,
 * `spawnDepth`, and `toolUseId`, the Agent call that started it) and one `agent-<id>.jsonl` (its
 * own transcript: the first timestamp is its start, the file's last change its latest step). An
 * agent started by another agent (`spawnDepth` 2 or more) gets `parent`: the agent whose
 * transcript holds that Agent call. One shell call reads every session's.
 * @param {object[]} sessions The live sessions, from the registry.
 * @returns {Promise<{ agents: Map<string, object[]>, folders: string[] }>} Each session's agents
 *   by session id, oldest first, and the folders they live in, for watching.
 */
async function agentsOf(sessions) {
  const script = `cd "$1" || exit 0; shift
for id in "$@"; do
  for m in projects/*/"$id"/subagents/agent-*.meta.json; do
    [ -f "$m" ] || continue
    j="\${m%.meta.json}.jsonl"
    at=$(stat -c %Y "$j" 2>/dev/null || stat -f %m "$j" 2>/dev/null || echo 0)
    start=$(head -n 5 "$j" 2>/dev/null | grep -o '"timestamp":"[^"]*"' | head -n 1 | cut -d'"' -f4)
    meta=$(tr -d '\n' < "$m")
    parent=""
    case "$meta" in
      *'"spawnDepth":'[2-9]*)
        call=$(printf '%s' "$meta" | grep -o '"toolUseId":"[^"]*"' | cut -d'"' -f4)
        for f in $(grep -l -F "$call" "\${m%/*}"/agent-*.jsonl 2>/dev/null); do
          [ "$f" = "$j" ] || { parent=$(basename "$f" .jsonl); break; }
        done ;;
    esac
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "\${m%/*}" "$(basename "$m" .meta.json)" "$at" "$start" "$parent" "$meta"
  done
done`;
  const ids = sessions.map((session) => session.sessionId);
  const result = await exec("sh", ["-c", script, "sh", claudeDir(), ...ids], { timeout: 30000 });
  const agents = new Map();
  const folders = new Set();
  const now = Date.now();
  for (const line of result.stdout.split("\n")) {
    const [sessionId, folder, name, at, start, parent, metaText] = line.split("\t");
    if (!metaText) continue;
    let meta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      continue;
    }
    const lastAt = Number(at) * 1000 || null;
    const finished = Boolean(meta.finished);
    folders.add(`${claudeDir()}/${folder}`);
    if (!agents.has(sessionId)) agents.set(sessionId, []);
    agents.get(sessionId).push({
      id: name.replace(/^agent-/, ""),
      description: meta.description || meta.agentType || "Agent",
      type: meta.agentType ?? "agent",
      fork: Boolean(meta.isFork),
      background: meta.requestShape === "background",
      model: meta.model === "inherit" ? null : (meta.model ?? null),
      finished,
      depth: meta.spawnDepth ?? 1,
      parent: parent ? parent.replace(/^agent-/, "") : null,
      startedAt: Date.parse(start) || null,
      lastAt,
      status: finished ? "done" : lastAt && now - lastAt < AGENT_QUIET ? "working" : "idle",
    });
  }
  for (const list of agents.values()) list.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  return { agents, folders: [...folders] };
}

/**
 * The agents another agent started, oldest first.
 * @param {object} session A session from loadHerds().
 * @param {object} agent One of its agents.
 * @returns {object[]}
 */
export const agentChildren = (session, agent) =>
  (session.agents ?? []).filter((candidate) => candidate.parent === agent.id);

/** Whether an agent, or any agent under it, still runs or finished in the last AGENT_RECENT. */
function isRecent(session, agent, now) {
  if (!agent.finished || (agent.lastAt && now - agent.lastAt < AGENT_RECENT)) return true;
  return agentChildren(session, agent).some((child) => isRecent(session, child, now));
}

/**
 * The agents the session itself started, split for drawing: the ones still running or finished
 * in the last AGENT_RECENT (counting the agents they started), and the ones that finished
 * before. Agents started by agents are drawn under their parent, so they are not listed here.
 * @param {object} session A session from loadHerds().
 * @param {number} [now] The time to measure from.
 * @returns {{ recent: object[], earlier: object[] }}
 */
export function agentsByAge(session, now = Date.now()) {
  const ids = new Set((session.agents ?? []).map((agent) => agent.id));
  const recent = [];
  const earlier = [];
  for (const agent of session.agents ?? []) {
    if (agent.parent && ids.has(agent.parent)) continue;
    (isRecent(session, agent, now) ? recent : earlier).push(agent);
  }
  return { recent, earlier };
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
 *   `agents`: the agents it started, oldest first: `{ id, description, type, fork, background,
 *   model, finished, startedAt, lastAt, status }`.
 * - `links`: `{ from, to, kind: "message" | "worktree", at }` between session ids, the latest
 *   of each kind per pair.
 * - `agentFolders`: the folders holding the sessions' agents, watched to redraw as they work.
 */
export async function loadHerds() {
  const [sessions, byPid, tabLinks] = await Promise.all([liveSessions(), terminalsByPid(), loadTabLinks()]);
  const started = await agentsOf(sessions);
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
        agents: started.agents.get(session.sessionId) ?? [],
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
  return { sessions: shown, links: [...latest.values()], agentFolders: started.folders, loadedAt: Date.now() };
}

/**
 * The herds: sessions joined by links, each led by its herdsman (the one that made the most
 * links), its others in name order, and the links among them. A session with no link that has
 * agents running or just finished leads a herd of its own, its agents its herd. `grazing` are
 * the sessions with neither. A terminal showing a background session is that session's, so the
 * session of its own is left out.
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
    if (placed.has(session.id)) continue;
    if (!neighbors.get(session.id).size) {
      if (agentsByAge(session).recent.length) {
        placed.add(session.id);
        herds.push({ herdsman: session, members: [], links: [] });
      }
      continue;
    }
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
