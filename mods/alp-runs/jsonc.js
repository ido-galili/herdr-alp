// JSON with comments and trailing commas, as VS Code writes `launch.json` and `tasks.json`.

/**
 * The index of the next character that is not whitespace or inside a comment.
 * @param {string} text JSONC source.
 * @param {number} from Where to start looking.
 * @returns {number} That index, or the text's length.
 */
function nextSignificant(text, from) {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i])) i++;
    else if (text[i] === "/" && text[i + 1] === "/") while (i < text.length && text[i] !== "\n") i++;
    else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else return i;
  }
  return i;
}

/**
 * Removes `//` and `/* *\/` comments and trailing commas, leaving strings as they are.
 * @param {string} text JSONC source.
 * @returns {string} Plain JSON source.
 */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, i + 1);
      i++;
    } else if (char === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      i = nextSignificant(text, i);
    } else if (char === ",") {
      const after = nextSignificant(text, i + 1);
      if (text[after] !== "}" && text[after] !== "]") out += char;
      i++;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/**
 * Parses JSONC text.
 * @param {string} text JSONC source.
 * @returns {any} The parsed value.
 */
export const parseJsonc = (text) => JSON.parse(stripJsonc(text));

// Editing: change one key of a JSONC file and keep everything else as written (comments,
// formatting, key order). Import and Save use it on the team's `.herdr/alp.json`.

/**
 * The file's structure with each value's position, for editing in place. Expects text that
 * `parseJsonc` accepts; anything after the first value is ignored.
 * @param {string} text JSONC source.
 * @returns {object} The root node: `{ type, start, end, members?, items? }`, where an object's
 *   members are `{ key, keyStart, node }`.
 */
function parseTree(text) {
  let i = 0;
  const skip = () => {
    i = nextSignificant(text, i);
  };
  const string = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = () => {
    skip();
    const start = i;
    if (text[i] === "{") {
      i++;
      const members = [];
      for (;;) {
        skip();
        if (i >= text.length || text[i] === "}") break;
        if (text[i] === ",") {
          i++;
          continue;
        }
        const keyStart = i;
        const key = string();
        skip();
        i++; // the colon
        members.push({ key, keyStart, node: value() });
      }
      i++;
      return { type: "object", start, end: i, members };
    }
    if (text[i] === "[") {
      i++;
      const items = [];
      for (;;) {
        skip();
        if (i >= text.length || text[i] === "]") break;
        if (text[i] === ",") {
          i++;
          continue;
        }
        items.push(value());
      }
      i++;
      return { type: "array", start, end: i, items };
    }
    if (text[i] === '"') {
      string();
      return { type: "string", start, end: i };
    }
    while (i < text.length && !/[\s,\]}/]/.test(text[i])) i++;
    return { type: "literal", start, end: i };
  };
  return value();
}

/**
 * The whitespace that starts the line `position` is on.
 * @param {string} text The source.
 * @param {number} position An index in it.
 * @returns {string}
 */
function lineIndent(text, position) {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/**
 * A value as pretty JSON whose later lines start at `indent`. Objects take a line per key; a
 * list of strings, numbers or booleans stays on one line when it fits in 80 columns.
 * @param {any} value Plain JSON data.
 * @param {string} indent The indentation of the line the value starts on.
 * @returns {string}
 */
function formatValue(value, indent) {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const flat = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    if (value.every((item) => item === null || typeof item !== "object") && indent.length + flat.length <= 80)
      return flat;
    return `[\n${value.map((item) => inner + formatValue(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatValue(item, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * An object holding `value` at `path`, e.g. `["runs", "Build"]` gives `{ runs: { Build: value } }`.
 * @param {string[]} path Keys, outermost first.
 * @param {any} value The innermost value.
 * @returns {any}
 */
const nest = (path, value) => path.reduceRight((inner, key) => ({ [key]: inner }), value);

/**
 * Adds a member at the end of an object node.
 * @param {string} text The source.
 * @param {object} object The object node.
 * @param {string} key The new key.
 * @param {any} value Its value.
 * @returns {string} The edited source.
 */
function insertMember(text, object, key, value) {
  const last = object.members.at(-1);
  if (!last) {
    const outer = lineIndent(text, object.start);
    const indent = `${outer}  `;
    const inner = text.slice(object.start + 1, object.end - 1);
    const member = `${JSON.stringify(key)}: ${formatValue(value, indent)}`;
    const body = inner.trim() ? `\n${indent}${member}${inner}` : `\n${indent}${member}\n${outer}`;
    return text.slice(0, object.start + 1) + body + text.slice(object.end - 1);
  }
  const indent = lineIndent(text, last.keyStart);
  const member = `${JSON.stringify(key)}: ${formatValue(value, indent)}`;
  const afterLast = nextSignificant(text, last.node.end);
  if (text[afterLast] === ",") {
    // A trailing comma is already there: add the member after it, with its own.
    return `${text.slice(0, afterLast + 1)}\n${indent}${member},${text.slice(afterLast + 1)}`;
  }
  // Keep a comment that ends the last member's line on that line.
  const lineEnd = text.indexOf("\n", last.node.end);
  const rest = lineEnd < 0 ? text.slice(last.node.end) : text.slice(last.node.end, lineEnd);
  const at = /^[ \t]*(\/\/.*)?$/.test(rest) && lineEnd >= 0 ? lineEnd : last.node.end;
  return `${text.slice(0, last.node.end)},${text.slice(last.node.end, at)}\n${indent}${member}${text.slice(at)}`;
}

/**
 * Removes one member of an object node, with its comma and, when it had the line to itself,
 * its line.
 * @param {string} text The source.
 * @param {object} object The object node.
 * @param {number} index The member's index.
 * @returns {string} The edited source.
 */
function removeMember(text, object, index) {
  const member = object.members[index];
  const lineStart = text.lastIndexOf("\n", member.keyStart - 1) + 1;
  const ownLine = /^[ \t]*$/.test(text.slice(lineStart, member.keyStart));
  let start = ownLine ? lineStart : member.keyStart;
  let end = member.node.end;
  let next = end;
  while (next < text.length && /[ \t]/.test(text[next])) next++;
  const hasComma = text[next] === ",";
  if (hasComma) end = next + 1;
  if (ownLine) {
    const lineEnd = text.indexOf("\n", end);
    if (lineEnd >= 0 && /^[ \t]*(\/\/.*)?$/.test(text.slice(end, lineEnd))) end = lineEnd + 1;
  }
  if (!hasComma && object.members.length === 1) {
    // The only member goes: leave `{}`, keeping any comments inside.
    const inner = text.slice(object.start + 1, start) + text.slice(end, object.end - 1);
    return text.slice(0, object.start + 1) + (inner.trim() ? inner : "") + text.slice(object.end - 1);
  }
  if (!hasComma && index > 0) {
    // The last member goes: the comma before it goes too.
    const previous = object.members[index - 1];
    const comma = nextSignificant(text, previous.node.end);
    if (text[comma] === ",") return text.slice(0, comma) + text.slice(comma + 1, start) + text.slice(end);
  }
  return text.slice(0, start) + text.slice(end);
}

/**
 * Sets or removes the value at `path` in JSONC text, changing nothing else. Missing objects on
 * the way are created; a value on the way that isn't an object is replaced.
 * @param {string | null} text JSONC source, or null for a new file.
 * @param {string[]} path Keys, outermost first, e.g. `["runs", "Build"]`.
 * @param {any} value Plain JSON data, or undefined to remove the key.
 * @returns {string} The edited source.
 * @throws {SyntaxError} When the text isn't valid JSONC or doesn't hold an object.
 */
export function editJsonc(text, path, value) {
  if (text == null || !text.trim()) {
    return value === undefined ? (text ?? "") : `${formatValue(nest(path, value), "")}\n`;
  }
  parseJsonc(text);
  let node = parseTree(text);
  if (node.type !== "object") throw new SyntaxError("The file doesn't hold an object");
  for (let depth = 0; depth < path.length; depth++) {
    const index = node.members.findIndex((member) => member.key === path[depth]);
    const last = depth === path.length - 1;
    if (index < 0) {
      return value === undefined ? text : insertMember(text, node, path[depth], nest(path.slice(depth + 1), value));
    }
    const member = node.members[index];
    if (last && value === undefined) return removeMember(text, node, index);
    if (last || member.node.type !== "object") {
      if (value === undefined) return text;
      const indent = lineIndent(text, member.keyStart);
      return (
        text.slice(0, member.node.start) +
        formatValue(nest(path.slice(depth + 1), value), indent) +
        text.slice(member.node.end)
      );
    }
    node = member.node;
  }
  return text;
}
