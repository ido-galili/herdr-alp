// Alp's config: three JSONC files, deep-merged with the later ones winning.
//
//   you    ~/.config/alp/alp.json        yours, in every repo
//   repo   <repo>/.herdr/alp.json        the team's, committed
//   local  <repo>/.herdr/alp.local.json  yours, in this repo only (git-ignored)
//
// Objects merge key by key; strings, numbers, booleans and lists are replaced whole; `null`
// removes a key. Runs are keyed by name, so a later file can change one field of a run.

import { exec, home, readTextFile, writeTextFile } from "herdr";
import { editJsonc, parseJsonc } from "./jsonc.js";

export const LAYERS = ["you", "repo", "local"];
export const SCHEMA_URL = "https://raw.githubusercontent.com/ido-galili/herdr-alp/main/schema/alp.schema.json";
const LOCAL_PATTERN = ".herdr/alp.local.json";

/** How each layer is named where people see it. */
export const LAYER_LABEL = { you: "Me everywhere", repo: "This repo", local: "Just me here" };

/**
 * Where a layer's file is. The repo's is in the checkout itself (each worktree has the committed
 * file); the local one is always in the main checkout, so every worktree of the repo shares it.
 * @param {"you" | "repo" | "local"} layer The layer.
 * @param {{ root: string, mainRoot?: string } | null} workspace From `findWorkspace`; needed for repo and local.
 * @returns {string | null} The absolute path, or null when the layer needs a workspace and there is none.
 */
export function layerPath(layer, workspace) {
  if (layer === "you") return `${home()}/.config/alp/alp.json`;
  if (!workspace?.root) return null;
  if (layer === "repo") return `${workspace.root}/.herdr/alp.json`;
  return `${workspace.mainRoot ?? workspace.root}/.herdr/alp.local.json`;
}

/** True for a plain object (not a list or null). */
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A value with every `null` inside its objects removed, so a removal marker never reaches a run.
 * @param {any} value Plain JSON data.
 * @returns {any}
 */
function withoutNulls(value) {
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, inner]) => inner !== null)
      .map(([key, inner]) => [key, withoutNulls(inner)]),
  );
}

/**
 * Merges `over` onto `base`: objects key by key, anything else replaced; `null` removes a key.
 * @param {any} base The earlier value.
 * @param {any} over The later value, which wins.
 * @returns {any} A new value; neither input changes.
 */
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (!isObject(over) || !isObject(base)) return withoutNulls(over);
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === null) delete out[key];
    else out[key] = key in out ? deepMerge(out[key], value) : withoutNulls(value);
  }
  return out;
}

/**
 * Reads one layer's file.
 * @param {"you" | "repo" | "local"} layer The layer.
 * @param {string | null} path Its file.
 * @returns {Promise<{ layer: string, path: string | null, text: string | null, value: object, error: string | null }>}
 *   The text as read (null when absent) for a safe write, and its value ({} when absent or broken).
 */
async function readLayer(layer, path) {
  const text = path ? await readTextFile(path).catch(() => null) : null;
  if (text == null) return { layer, path, text: null, value: {}, error: null };
  try {
    const value = parseJsonc(text);
    if (!isObject(value)) throw new Error("it doesn't hold an object");
    return { layer, path, text, value, error: null };
  } catch (error) {
    const short = path.replace(home(), "~");
    return { layer, path, text, value: {}, error: `${short}: ${error?.message ?? error}` };
  }
}

/**
 * Reads the three layers and merges them.
 * @param {{ root: string, mainRoot: string } | null} workspace The workspace, from `findWorkspace`.
 * @returns {Promise<{ layers: Record<string, object>, merged: object, errors: string[] }>}
 */
export async function loadConfig(workspace) {
  const [you, repo, local] = await Promise.all(LAYERS.map((layer) => readLayer(layer, layerPath(layer, workspace))));
  const layers = { you, repo, local };
  const merged = LAYERS.reduce((value, layer) => deepMerge(value, layers[layer].value), {});
  return { layers, merged, errors: LAYERS.map((layer) => layers[layer].error).filter(Boolean) };
}

/**
 * The layer a run's merged value last came from: the latest file that defines it.
 * @param {Record<string, object>} layers From `loadConfig`.
 * @param {string} name The run's name.
 * @returns {"you" | "repo" | "local"}
 */
export const originOf = (layers, name) =>
  [...LAYERS].reverse().find((layer) => isObject(layers[layer].value.runs?.[name])) ?? "repo";

/** The text a new repo file starts from: a pointer to the docs and the schema. */
const REPO_HEADER = `// Alp's config for this repo: the Run tab's runs. https://github.com/ido-galili/herdr-alp#runs
// Your own changes go in .herdr/alp.local.json (git-ignored), or ~/.config/alp/alp.json for every repo.
{
  "$schema": "${SCHEMA_URL}"
}
`;

/**
 * Makes sure Git ignores the local file, through the repository's own `info/exclude` (never
 * committed), so nobody commits it by accident.
 * @param {string} root A folder in the repository.
 * @returns {Promise<void>}
 */
async function ignoreLocalFile(root) {
  const result = await exec("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
  if (result?.code !== 0) return;
  const path = `${result.stdout.trim()}/info/exclude`;
  const text = await readTextFile(path).catch(() => null);
  if (text?.split("\n").some((line) => line.trim() === LOCAL_PATTERN)) return;
  await exec("mkdir", ["-p", path.replace(/\/[^/]+$/, "")]).catch(() => null);
  const base = text ?? "";
  await writeTextFile(path, `${base}${base && !base.endsWith("\n") ? "\n" : ""}${LOCAL_PATTERN}\n`, text);
}

/**
 * Applies edits to one layer's file and writes it, unless someone changed it since it was read.
 * Comments and formatting stay as written. A missing file is created (the repo's with a header
 * and the schema), and a local file is added to Git's exclude list.
 * @param {"you" | "repo" | "local"} layer The layer to write.
 * @param {{ root: string } | null} workspace The workspace, for repo and local.
 * @param {{ path: string[], value: any }[]} edits Values to set, or undefined to remove, in order.
 * @returns {Promise<void>}
 * @throws {Error} When the layer needs a workspace, its file is broken, or it changed meanwhile.
 */
export async function writeLayer(layer, workspace, edits) {
  const path = layerPath(layer, workspace);
  if (!path) throw new Error("Open a terminal in a repository first.");
  const current = await readTextFile(path).catch(() => null);
  let text = current ?? (layer === "repo" ? REPO_HEADER : null);
  for (const edit of edits) text = editJsonc(text, edit.path, edit.value);
  if (text === current) return;
  await exec("mkdir", ["-p", path.replace(/\/[^/]+$/, "")]);
  await writeTextFile(path, text, current);
  if (layer === "local") await ignoreLocalFile(workspace.mainRoot ?? workspace.root);
}
