import type { Register } from "claude-code";

// Feeds Herdr's agent status files, shared by every agent that reports to Herdr:
//   ~/.local/state/herdr-agents/<herdr terminal>.json  { agent, model, effort, context_pct, ts }
//   ~/.local/state/herdr-agents/limits.json            { <agent>: { five_hour, seven_day, ts } }
// The alp-pane-agent mod polls the per-terminal file every 3 seconds and shows the
// chips when its `agent` matches the program in the pane; alp-usage-limits reads
// its agent's entry in limits.json.

const AGENT = "claude";

type Info = { model: string | null; effort: string | null; context_pct: number | null };

async function dir($: any): Promise<string> {
  return `${(await $.env.get("HOME")) ?? ""}/.local/state/herdr-agents`;
}

// Outside a Herdr terminal there is no pane to feed, so no terminal file is written.
async function statusFile($: any): Promise<string | undefined> {
  const term = await $.env.get("HC_TERMINAL_ID");
  return term ? `${await dir($)}/${term}.json` : undefined;
}

// The last known values; each event updates its own and the whole file is rewritten.
// (A reload starts these over; session.start runs again and reseeds them.)
const info: Info = { model: null, effort: null, context_pct: null };
let written = "";

async function flush($: any) {
  const body = JSON.stringify(info);
  if (body === written) return; // nothing changed: skip the write
  const file = await statusFile($);
  if (!file) return;
  written = body;
  await $.fs.write(file, JSON.stringify({ agent: AGENT, ...info, ts: Date.now() / 1000 }));
}

// Limits are account-wide and the file is shared with other agents: replace
// only this agent's entry. ($.fs.write creates the folder when missing.)
async function writeLimits($: any, entry: object) {
  const file = `${await dir($)}/limits.json`;
  let all: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await $.fs.read(file));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed;
  } catch {
    // missing or unreadable: start fresh
  }
  all[AGENT] = entry;
  await $.fs.write(file, JSON.stringify(all));
}

export const register: Register = (on) => {
  // Seed what is known before the first prompt: the model, and the context fill
  // (present when a resumed session already has a response).
  on("session.start", async ($, e, next) => {
    info.model = (await $.session.model()) ?? null;
    info.context_pct = (await $.session.usage()).context.percent ?? null;
    await flush($);
    return next(e);
  });

  // Every model request of the main conversation (not subagents) carries the
  // model and effort in force; /model or /effort show up here on the next prompt.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId === undefined) {
      info.model = e.model ?? info.model;
      info.effort = e.effort === undefined ? null : String(e.effort);
      await flush($);
    }
    return yield* next(e);
  });

  // Pushed after each main-thread turn when a figure moved.
  on("session.measure", async ($, e, next) => {
    if (e.changed.includes("context")) {
      // absent right after /compact until the next response: hide the bar meanwhile
      info.context_pct = e.context.percent ?? null;
      await flush($);
    }
    const pick = (kind: string) => {
      const w = e.rateLimits.find((r) => r.kind === kind);
      return w ? { used_percentage: w.percentUsed, resets_at: w.resetsAt } : null;
    };
    if (e.rateLimits.length) {
      await writeLimits($, { five_hour: pick("five_hour"), seven_day: pick("seven_day"), ts: Date.now() / 1000 });
    }
    return next(e);
  });

  // Cleanup: /clear keeps Claude running (only the context resets); any other end
  // empties the file, which Herdr reads as "no info" and hides the chips.
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      info.context_pct = null;
      await flush($);
    } else {
      const file = await statusFile($);
      if (file) await $.fs.write(file, "");
      written = "";
    }
    return next(e);
  });
};
