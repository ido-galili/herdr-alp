// What Settings > Updates reads, and the prompt it hands an agent. A check runs only when you
// press Check for updates: it reads what sync.sh recorded at install, herdr-alp's releases on
// GitHub (through gh), and the alp Claude plugin (through claude). The update itself is the
// agent's: as Herdr's own guide has agents add other people's mods, it reads the notes, asks
// before overwriting edits, runs the release's sync.sh install and checks every mod. Alp reloads
// mid-install, which a terminal doesn't notice.

import { exec, home, readTextFile, writeTextFile } from "herdr";
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
/** The last check, so the page looks the same when you come back. */
const checkPath = () => `${alpDir()}/updates.json`;

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
 * Release notes as Markdown again, for a prompt: each release, then its groups and lines.
 * @param {{ tag: string, url: string, notes: { group: string, items: { scope: string | null,
 *   text: string }[] }[] }[]} releases The releases, newest first.
 * @returns {string}
 */
export function notesMarkdown(releases) {
  return releases
    .map((release) => {
      const groups = release.notes.map(
        (group) =>
          `#### ${group.group}\n${group.items.map((item) => `- ${item.scope ? `${item.scope}: ` : ""}${item.text}`).join("\n")}`,
      );
      return [`### ${release.tag} (${release.url})`, ...(groups.length ? groups : ["No notes."])].join("\n\n");
    })
    .join("\n\n");
}

/**
 * The prompt that updates herdr-alp, the plugin, or both, for an agent to carry out.
 * @param {object} what What to update and what is there now.
 * @param {object[]} what.releases The releases newer than the installed one, newest first; empty
 *   to update only the plugin.
 * @param {object | null} what.installed What sync.sh recorded at install.
 * @param {{ state: string, version?: string } | null} what.plugin The plugin, as the last check read it.
 * @param {string | null} what.pluginTarget The version the plugin should reach, or null to leave it.
 * @param {string} what.herdrHome Herdr's home, as the mod sees it.
 * @param {string} what.userHome The person's home folder, to shorten paths.
 * @returns {string}
 */
export function updatePrompt({ releases, installed, plugin, pluginTarget, herdrHome, userHome }) {
  const short = (path) => (path?.startsWith(userHome) ? `~${path.slice(userHome.length)}` : path);
  const herdr = short(herdrHome);
  const latest = releases[0];
  const lines = [];
  let step = 0;
  const next = (text) => lines.push(`${++step}. ${text}`);
  if (latest) {
    const now = !installed
      ? "Installed now: a version from before installs were recorded."
      : isDevBuild(installed)
        ? `Installed now: a dev build, v${installed.version}, put there by sync.sh from ${short(installed.from)}${installed.describe ? ` at ${installed.describe}` : ""}. The release replaces it; don't change that clone.`
        : `Installed now: v${installed.version}, from a release.`;
    lines.push(
      `Update herdr-alp (the Alp layout, theme and mods for Herdr) to ${latest.tag}${pluginTarget ? ", and its Claude plugin alp" : ""}.`,
      "",
      now,
      "",
      "What's new since then, from the release notes:",
      "",
      notesMarkdown(releases),
      "",
      "Steps:",
    );
    next(
      "Tell me in a few lines what changes for me, from the notes above, and call out anything under Breaking. Then go on: ask only where a step below says to.",
    );
    next(
      `Look for files edited in Herdr's home since the last install: in ${herdr} run \`sha256sum -c --quiet ~/.config/alp/installed.sha256\` (macOS: \`shasum -a 256 -c --quiet …\`; no such file means nothing to compare). If it lists any, show them and ask me before going on: installing overwrites them.`,
    );
    next(
      `Download the release into a new temporary folder and unpack it: \`gh release download ${latest.tag} --repo ${REPO} --archive tar.gz --dir <folder>\`, then \`tar -xzf\` the archive there.`,
    );
    next(
      `Run the unpacked release's installer: \`${herdrHome === `${userHome}/.config/herdr-app` ? "" : `HERDR_APP_HOME=${herdrHome} `}bash <unpacked folder>/sync.sh install\`. It copies the layout, theme and mods into ${herdr} (Herdr reloads each mod as it lands) and records the version in ~/.config/alp/installed.json: don't edit that file yourself.`,
    );
    next(
      `Check the install: \`herdr-app check ${herdr}/mods/<mod>\` for every mod the installer listed, and that ~/.config/alp/installed.json now says "version": "${latest.tag.replace(/^v/, "")}" and "from": "release".`,
    );
  } else {
    lines.push(
      `Update the Claude plugin alp (part of herdr-alp, the Alp layout for Herdr) to ${pluginTarget}.`,
      "",
      "Steps:",
    );
  }
  if (pluginTarget) {
    next(
      `Update the plugin from ${plugin?.version ?? "its version"} to ${pluginTarget}: \`claude plugin marketplace update herdr-alp\`, then \`claude plugin update alp@herdr-alp\`, and check that \`claude plugin list\` shows ${pluginTarget}. Running Claude sessions load it when they restart.`,
    );
  }
  next(
    `${latest ? "Remove the temporary folder, then tell" : "Tell"} me what was updated, and anything that failed with its output.`,
  );
  return lines.join("\n");
}
