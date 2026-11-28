// What Settings > Updates reads and runs. A check runs only when you press Check for updates:
// it reads what sync.sh recorded at install, herdr-alp's releases on GitHub (through gh), and the
// alp Claude plugin (through claude). Updating herdr-alp installs a release into Herdr's home and
// never touches your clone; updating the plugin runs claude's own plugin update.

import { appHome, exec, home, notify, readTextFile, writeTextFile } from "herdr";
import { gh } from "./data.js";

/** The repository releases come from. */
export const REPO = "ido-galili/herdr-alp";
/** Its releases page. */
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
/** The plugin's marketplace and id, as README's install steps add them. */
const MARKETPLACE = "herdr-alp";
const PLUGIN_ID = `alp@${MARKETPLACE}`;

const alpDir = () => `${home()}/.config/alp`;
/** Written by sync.sh install: the version and where it came from. */
const installedPath = () => `${alpDir()}/installed.json`;
/** Written by sync.sh install: a hash of every file it copied. */
const hashesPath = () => `${alpDir()}/installed.sha256`;
/** The last check, so the page looks the same when you come back. */
const checkPath = () => `${alpDir()}/updates.json`;
/** Written by alp-update.sh when an update ends, and its output. */
const resultPath = () => `${alpDir()}/update-result.json`;
const logPath = () => `${alpDir()}/update.log`;

/**
 * Parses JSON, or gives null.
 * @param {string | null} text The text.
 * @returns {any} The value, or null when the text is missing or not JSON.
 */
function parse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A version's parts, for comparing.
 * @param {string | null | undefined} version Such as "v0.7.0" or "0.7.0".
 * @returns {number[] | null} `[major, minor, patch]`, or null when it is not a version.
 */
export function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Whether one version is newer than another. An unknown `than` counts as older than any.
 * @param {string} version The version.
 * @param {string | null | undefined} than The version to compare with.
 * @returns {boolean} True when `version` is newer.
 */
export function isNewer(version, than) {
  const a = versionParts(version);
  const b = versionParts(than);
  if (!a) return false;
  if (!b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * What sync.sh recorded at install.
 * @returns {Promise<{ version: string, from: string, describe: string | null, branch: string | null,
 *   commit: string | null, installedAt: string } | null>} Null when it never ran with a stamp.
 */
export async function readInstalled() {
  return parse(await readTextFile(installedPath()));
}

/**
 * Whether the install came from a release (Update) or from a clone (`sync.sh install`).
 * @param {object | null} installed What `readInstalled` gave.
 * @returns {boolean} True for a clone, which the page calls a dev build.
 */
export const isDevBuild = (installed) => Boolean(installed) && installed.from !== "release";

/**
 * The installed files that differ from what sync.sh copied: edits made in Herdr's home.
 * @returns {Promise<string[]>} Paths under Herdr's home; empty when none, or when there are no hashes.
 */
export async function changedInPlace() {
  if (!(await readTextFile(hashesPath()))) return [];
  const args = ["-c", hashesPath()];
  // Linux has sha256sum; macOS has shasum. Both print "path: FAILED" for a file that differs.
  const result = await exec("sha256sum", args, { cwd: appHome() }).catch(() =>
    exec("shasum", ["-a", "256", ...args], { cwd: appHome() }),
  );
  return result.stdout
    .split("\n")
    .map((line) => /^(.*): FAILED/.exec(line)?.[1])
    .filter(Boolean);
}

/**
 * Runs the claude CLI, from PATH or where its installer puts it.
 * @param {string[]} args Its arguments.
 * @param {number} [timeout] Milliseconds.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 * @throws {Error} When claude isn't installed.
 */
async function claude(args, timeout = 60000) {
  try {
    return await exec("claude", args, { timeout });
  } catch {
    return await exec(`${home()}/.local/bin/claude`, args, { timeout }).catch(() => {
      throw new Error("Claude Code isn't installed: the claude command wasn't found.");
    });
  }
}

/**
 * The alp plugin as Claude Code has it.
 * @returns {Promise<{ state: "marketplace" | "clone" | "missing" | "no-claude", version?: string,
 *   path?: string, error?: string }>} `clone` when it loads from a folder (`alp@inline`), so it
 *   has nothing to update.
 */
export async function readPlugin() {
  let result;
  try {
    result = await claude(["plugin", "list", "--json"]);
  } catch (error) {
    return { state: "no-claude", error: String(error?.message ?? error) };
  }
  const plugins = parse(result.stdout) ?? [];
  const alp =
    plugins.find((plugin) => plugin.id === PLUGIN_ID) ?? plugins.find((plugin) => plugin.id?.startsWith("alp@"));
  if (!alp) return { state: "missing" };
  return {
    state: alp.id === PLUGIN_ID ? "marketplace" : "clone",
    version: alp.version,
    path: alp.installPath,
  };
}

/**
 * One release's notes, as git-cliff wrote them, in groups.
 * @param {string} body The release's Markdown body.
 * @returns {{ group: string, items: { scope: string | null, text: string }[] }[]}
 */
export function parseNotes(body) {
  const groups = [];
  for (const raw of (body ?? "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("### ")) groups.push({ group: line.slice(4).trim(), items: [] });
    else if (line.startsWith("- ") && groups.length) {
      // Links become their text: "([#23](…))" reads "(#23)".
      const text = line.slice(2).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      const scoped = /^\*\*(.+?)\*\*: (.*)$/.exec(text);
      groups.at(-1).items.push(scoped ? { scope: scoped[1], text: scoped[2] } : { scope: null, text });
    }
  }
  return groups.filter((group) => group.items.length);
}

/**
 * Checks for updates: the releases on GitHub and the plugin, saved as the last check.
 * @returns {Promise<object>} The check: `{ checkedAt, releases, plugin, error }`. `releases`
 *   newest first, each `{ tag, date, url, notes }`; `error` when GitHub couldn't be read.
 */
export async function check() {
  const [releases, plugin] = await Promise.all([
    gh(["api", `repos/${REPO}/releases?per_page=30`]).then(
      (list) =>
        list
          .filter((release) => !release.draft && !release.prerelease && versionParts(release.tag_name))
          .map((release) => ({
            tag: release.tag_name,
            date: release.published_at,
            url: release.html_url,
            notes: parseNotes(release.body),
          }))
          .sort((a, b) => (isNewer(a.tag, b.tag) ? -1 : 1)),
      (error) => ({ error: String(error?.message ?? error) }),
    ),
    readPlugin(),
  ]);
  const result = {
    checkedAt: new Date().toISOString(),
    releases: Array.isArray(releases) ? releases : [],
    plugin,
    error: Array.isArray(releases) ? null : releases.error,
  };
  const before = await readTextFile(checkPath());
  await writeTextFile(checkPath(), `${JSON.stringify(result, null, 2)}\n`, before).catch(() => {});
  return result;
}

/**
 * The last check, from its file.
 * @returns {Promise<object | null>} What `check` saved, or null before the first check.
 */
export async function readCheck() {
  return parse(await readTextFile(checkPath()));
}

/**
 * The last update's result, and the end of its output when it failed.
 * @returns {Promise<{ tag: string, ok: boolean, at: string, log?: string } | null>}
 */
export async function readResult() {
  const result = parse(await readTextFile(resultPath()));
  if (result && !result.ok) {
    const log = (await readTextFile(logPath())) ?? "";
    result.log = log.trim().split("\n").slice(-6).join("\n");
  }
  return result;
}

/**
 * Starts installing a release into Herdr's home. It runs detached, in alp-update.sh: installing
 * replaces every mod, this one included, so Herdr reloads it before the update could report
 * back. The reloaded page reads the result from update-result.json.
 * @param {string} tag The release, such as "v0.7.0".
 * @returns {Promise<void>}
 * @throws {Error} When the updater couldn't be started.
 */
export async function startUpdate(tag) {
  const script = `${appHome()}/mods/alpmeister/alp-update.sh`;
  // setsid where there is one (Linux), so the updater outlives this mod's reload; nohup on macOS.
  const launch =
    'if command -v setsid >/dev/null; then setsid -f bash "$0" "$1" "$2" </dev/null >/dev/null 2>&1;' +
    ' else nohup bash "$0" "$1" "$2" </dev/null >/dev/null 2>&1 & fi';
  const result = await exec("bash", ["-c", launch, script, tag, appHome()]);
  if (result.code !== 0) throw new Error((result.stderr || `the updater exited ${result.code}`).trim());
}

/**
 * Updates the plugin through Claude Code: its marketplace first, then the plugin.
 * @returns {Promise<void>}
 * @throws {Error} With claude's message when either step fails.
 */
export async function updatePlugin() {
  for (const args of [
    ["plugin", "marketplace", "update", MARKETPLACE],
    ["plugin", "update", PLUGIN_ID],
  ]) {
    const result = await claude(args, 120000);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || `claude exited ${result.code}`).trim());
  }
}

/**
 * Shows one toast for an update that ended while Alp reloaded. Every Alp tab calls this when
 * it starts; the file's snapshot check lets only the first one post it.
 * @returns {Promise<void>}
 */
export async function announceResult() {
  const text = await readTextFile(resultPath());
  const result = parse(text);
  if (!result || result.announced) return;
  try {
    await writeTextFile(resultPath(), `${JSON.stringify({ ...result, announced: true })}\n`, text);
  } catch {
    // Another Alp tab announced it first.
    return;
  }
  notify(
    result.ok
      ? { title: `Alp updated to ${result.tag}`, level: "success" }
      : { title: `Alp couldn't update to ${result.tag}`, body: "Settings > Updates shows why.", level: "error" },
  );
}
