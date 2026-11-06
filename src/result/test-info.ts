import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestSuiteResult } from "../config/schema/common.js";

export interface TestInformation {
  readonly description: string;
  readonly expectedBehavior: string;
  readonly source?: { readonly file: string; readonly line: number };
}
interface Token { readonly text: string; readonly kind: "code" | "comment" | "literal"; readonly offset: number }
interface SuiteInformation extends TestInformation { readonly cases: ReadonlyMap<string, TestInformation> }
const empty: TestInformation = Object.freeze({ description: "", expectedBehavior: "" });

/** Tokenize only the documented registration syntax, never evaluate C or guess intent. */
function tokens(source: string): Token[] {
  const output: Token[] = [];
  let offset = 0;
  let lineStart = true;
  while (offset < source.length) {
    const start = offset, char = source[offset]!;
    if (/\s/u.test(char)) { if (char === "\n") lineStart = true; offset++; continue; }
    if (lineStart && char === "#") {
      do { const end = source.indexOf("\n", offset); offset = end < 0 ? source.length : end + 1; }
      while (/\\\r?\n$/u.test(source.slice(start, offset)) && offset < source.length);
      continue;
    }
    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      offset = end < 0 ? source.length : end + 2;
      output.push({ text: source.slice(start, offset), kind: "comment", offset: start });
      continue;
    }
    if (source.startsWith("//", offset)) {
      const end = source.indexOf("\n", offset + 2);
      offset = end < 0 ? source.length : end;
      output.push({ text: source.slice(start, offset), kind: "comment", offset: start });
      continue;
    }
    lineStart = false;
    if (char === '"' || char === "'") {
      offset++;
      while (offset < source.length) {
        if (source[offset] === "\\") offset += 2;
        else if (source[offset++] === char) break;
      }
      output.push({ text: source.slice(start, offset), kind: "literal", offset: start });
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(offset));
    offset += identifier?.[0].length ?? 1;
    output.push({ text: source.slice(start, offset), kind: "code", offset: start });
  }
  return output;
}

function argumentsAt(input: readonly Token[], index: number): readonly (readonly Token[])[] | undefined {
  if (input[index + 1]?.text !== "(") return undefined;
  const args: Token[][] = [[]];
  let depth = 0;
  for (let cursor = index + 2; cursor < input.length; cursor++) {
    const token = input[cursor]!;
    if (token.kind === "comment") continue;
    if (token.kind === "code") {
      if (token.text === ")" && depth === 0) return args;
      if (token.text === "," && depth === 0) { args.push([]); continue; }
      if (["(", "{", "["].includes(token.text)) depth++;
      if ([")", "}", "]"].includes(token.text)) depth--;
    }
    args.at(-1)!.push(token);
  }
  return undefined;
}

function identifier(input: readonly Token[] | undefined): string | undefined {
  return input?.length === 1 && input[0]?.kind === "code" && /^[A-Za-z_]\w*$/u.test(input[0].text) ? input[0].text : undefined;
}

function information(comment: Token | undefined, source: string, offset: number, file: string): TestInformation {
  const values = { purpose: "", expected: "" };
  if (comment?.kind === "comment" && comment.text.startsWith("/*") && source.slice(comment.offset + comment.text.length, offset).trim() === "") {
    let field: keyof typeof values | undefined;
    for (const line of comment.text.replace(/^\/\*+|\*\/$/gu, "").split(/\r?\n/u)) {
      const text = line.replace(/^\s*\*?\s?/u, "").trim();
      const tag = /^@(\w+)\b\s*(.*)$/u.exec(text);
      if (tag) {
        field = tag[1] === "purpose" || tag[1] === "expected" ? tag[1] : undefined;
        if (field) values[field] = tag[2]!.trim();
      } else if (field && text) values[field] += `${values[field] ? "\n" : ""}${text}`;
    }
  }
  return Object.freeze({ description: values.purpose, expectedBehavior: values.expected,
    source: Object.freeze({ file, line: source.slice(0, offset).split("\n").length }) });
}

export class CTestInformation {
  readonly #suites = new Map<string, SuiteInformation>();
  readonly diagnostics: Array<{ readonly code: string; readonly message: string }> = [];

  suite(name: string): TestInformation { return this.#suites.get(name) ?? empty; }
  case(suite: string, name: string): TestInformation { return this.#suites.get(suite)?.cases.get(name) ?? empty; }

  add(name: string, info: SuiteInformation): void {
    const previous = this.#suites.get(name);
    if (previous === undefined) { this.#suites.set(name, info); return; }
    // Without preprocessing we cannot choose between conditional definitions.
    const merged = new Map(previous.cases);
    for (const [key, value] of info.cases) {
      const existing = merged.get(key);
      if (existing === undefined) merged.set(key, value);
      else if (JSON.stringify(existing) !== JSON.stringify(value)) {
        merged.set(key, empty);
        this.diagnostics.push({ code: "test_info_ambiguous", message: `测试说明存在重复定义，保持为空: ${name}/${key}` });
      }
    }
    const same = previous.description === info.description && previous.source?.file === info.source?.file && previous.source?.line === info.source?.line;
    if (!same) this.diagnostics.push({ code: "test_info_ambiguous", message: `Suite 说明存在重复定义，保持为空: ${name}` });
    this.#suites.set(name, { ...(same ? previous : empty), cases: merged });
  }

  enrich(groups: readonly TestSuiteResult[]): readonly TestSuiteResult[] {
    return groups.map(group => {
      const suite = this.suite(group.name);
      return Object.freeze({ ...group, description: group.description ?? suite.description,
        ...(group.source ?? suite.source ? { source: group.source ?? suite.source } : {}),
        cases: Object.freeze(group.cases.map(item => {
          const info = this.case(group.name, item.name.split("@")[0]!);
          return Object.freeze({ ...item, description: item.description ?? info.description,
            expectedBehavior: item.expectedBehavior ?? info.expectedBehavior,
            ...(item.source ?? info.source ? { source: item.source ?? info.source } : {}) });
        })) });
    });
  }
}

/** Read only the source list belonging to this artifact/session, never scan a repository. */
export async function readCTestInformation(files: readonly string[], configDir: string): Promise<CTestInformation> {
  const result = new CTestInformation();
  for (const file of [...new Set(files.map(file => path.resolve(configDir, file)))]) {
    if (!/\.(?:c|h|cc|cpp|cxx|hpp)$/iu.test(file)) continue;
    let source: string;
    try { source = await readFile(file, "utf8"); }
    catch { result.diagnostics.push({ code: "test_info_unavailable", message: `无法读取测试说明，保持为空: ${file}` }); continue; }
    const input = tokens(source);
    const cases = new Map<string, TestInformation[]>();
    for (let index = 0; index < input.length; index++) {
      const token = input[index]!;
      if (token.kind !== "code" || !["CAUTEST_CASE", "CAUTEST_PARAM_CASE"].includes(token.text)) continue;
      const args = argumentsAt(input, index), name = identifier(args?.[0]);
      if (name === undefined) continue;
      const values = cases.get(name) ?? [];
      values.push(information(input[index - 1], source, token.offset, file));
      cases.set(name, values);
    }
    for (let index = 0; index < input.length; index++) {
      const token = input[index]!;
      if (token.kind !== "code" || !["CAUTEST_SUITE", "CAUTEST_SUITE_WITH_FIXTURES"].includes(token.text)) continue;
      const args = argumentsAt(input, index), name = identifier(args?.[0]);
      if (name === undefined || args === undefined) continue;
      const entries = new Map<string, TestInformation>();
      for (const arg of args.slice(token.text === "CAUTEST_SUITE" ? 1 : 3)) {
        for (let cursor = 0; cursor < arg.length; cursor++) {
          if (!["CAUTEST_CASE_ENTRY", "CAUTEST_PARAM_CASE_ENTRY"].includes(arg[cursor]!.text)) continue;
          const caseName = identifier(argumentsAt(arg, cursor)?.[0]);
          if (caseName === undefined) continue;
          const definitions = cases.get(caseName) ?? [];
          entries.set(caseName, definitions.length === 1 ? definitions[0]! : empty);
          if (definitions.length > 1) result.diagnostics.push({ code: "test_info_ambiguous", message: `Case 说明存在重复定义，保持为空: ${name}/${caseName}` });
        }
      }
      result.add(name, { ...information(input[index - 1], source, token.offset, file), cases: entries });
    }
  }
  return result;
}
