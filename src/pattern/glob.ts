const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|]/u;
const GLOB_META = new Set(["*", "?", "["]);
const MAX_BRACE_EXPANSIONS = 256;

function escaped(character: string): string {
  return REGEXP_SPECIAL.test(character) ? `\\${character}` : character;
}

function brace(pattern: string): Readonly<{ readonly open: number; readonly close: number; readonly alternatives: readonly string[] }> | undefined {
  let inClass = false;
  for (let open = 0; open < pattern.length; open += 1) {
    const character = pattern[open];
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    if (character !== "{" || inClass) continue;
    let depth = 1;
    let classDepth = false;
    const separators: number[] = [];
    for (let index = open + 1; index < pattern.length; index += 1) {
      const candidate = pattern[index];
      if (candidate === "[") classDepth = true;
      else if (candidate === "]") classDepth = false;
      if (classDepth) continue;
      if (candidate === "{") depth += 1;
      else if (candidate === "}") {
        depth -= 1;
        if (depth === 0) {
          if (separators.length === 0) break;
          const boundaries = [open, ...separators, index];
          return Object.freeze({
            open,
            close: index,
            alternatives: Object.freeze(boundaries.slice(0, -1).map((start, part) => pattern.slice(start + 1, boundaries[part + 1]))),
          });
        }
      } else if (candidate === "," && depth === 1) separators.push(index);
    }
  }
  return undefined;
}

function expandBraces(pattern: string, output: string[]): void {
  const group = brace(pattern);
  if (group === undefined) {
    output.push(pattern);
    if (output.length > MAX_BRACE_EXPANSIONS) throw new Error(`Glob 花括号展开超过 ${MAX_BRACE_EXPANSIONS} 项: ${pattern}`);
    return;
  }
  const prefix = pattern.slice(0, group.open);
  const suffix = pattern.slice(group.close + 1);
  for (const alternative of group.alternatives) expandBraces(`${prefix}${alternative}${suffix}`, output);
}

function characterClass(pattern: string, start: number, matchSlash: boolean): Readonly<{ readonly source: string; readonly end: number }> | undefined {
  const end = pattern.indexOf("]", start + 1);
  if (end < 0 || end === start + 1) return undefined;
  let body = pattern.slice(start + 1, end);
  if (body.startsWith("!")) body = `^${body.slice(1)}`;
  const source = `[${body}]`;
  try { new RegExp(source, "u"); }
  catch { return undefined; }
  return Object.freeze({ source: `${matchSlash ? "" : "(?!/)"}${source}`, end });
}

function globRegExp(pattern: string, matchSlash: boolean): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (matchSlash) {
        if (pattern[index + 1] === "*") index += 1;
        expression += ".*";
      } else if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          expression += "(?:[^/]+/)*";
        } else expression += ".*";
      } else expression += "[^/]*";
    } else if (character === "?") expression += matchSlash ? "." : "[^/]";
    else if (character === "[") {
      const group = characterClass(pattern, index, matchSlash);
      if (group === undefined) expression += "\\[";
      else { expression += group.source; index = group.end; }
    } else expression += escaped(character);
  }
  return new RegExp(`${expression}$`, "u");
}

/** 编译 Cautest 支持的 Glob；`matchSlash` 用于 V1 兼容的 Suite/Case 文本过滤。 */
export function globMatcher(pattern: string, options: Readonly<{ readonly matchSlash?: boolean }> = {}): (value: string) => boolean {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.includes("\0")) throw new TypeError("Glob 必须是非空字符串");
  const expanded: string[] = [];
  expandBraces(pattern, expanded);
  const expressions = expanded.map((item) => globRegExp(item, options.matchSlash === true));
  return (value) => expressions.some((expression) => expression.test(value));
}

/** 返回第一个 Glob 元字符前的可遍历路径；没有静态目录时返回 `.`。 */
export function globBase(pattern: string): string {
  let meta = -1;
  for (let index = 0; index < pattern.length; index += 1) if (GLOB_META.has(pattern[index]!) || pattern[index] === "{") { meta = index; break; }
  if (meta < 0) return pattern;
  const slash = pattern.slice(0, meta).lastIndexOf("/");
  return slash < 0 ? "." : pattern.slice(0, slash) || ".";
}
