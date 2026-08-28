import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type { FilePattern, FilePatternExpansionInput } from "./schema/common.js";
import { CautestError } from "../model/error.js";

interface PatternMatcher {
  readonly source: string;
  readonly match: (value: string) => boolean;
}

function normalizePattern(pattern: FilePattern, index: number): { readonly negative: boolean; readonly value: string } {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.includes("\0") || pattern.includes("\\")) {
    throw new CautestError(`文件 Pattern[${index}] 必须是使用 / 分隔的非空字符串`, { code: "config_error" });
  }
  const negative = pattern.startsWith("!");
  const value = negative ? pattern.slice(1) : pattern;
  if (value.length === 0 || path.posix.isAbsolute(value) || value.split("/").includes("..")) {
    throw new CautestError(`文件 Pattern[${index}] 必须位于配置根目录内: ${pattern}`, { code: "config_error" });
  }
  return { negative, value: value.replace(/^\.\//u, "") };
}

async function collectFiles(root: string, relative: string, output: Set<string>): Promise<void> {
  const location = path.join(root, relative);
  let metadata;
  try {
    metadata = await lstat(location);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isFile()) {
    output.add(relative.split(path.sep).join("/"));
    return;
  }
  if (!metadata.isDirectory()) return;
  for (const entry of (await readdir(location, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    await collectFiles(root, path.join(relative, entry.name), output);
  }
}

function scanRoot(pattern: string): string {
  const base = picomatch.scan(pattern).base;
  return base.length === 0 ? "." : base;
}

/**
 * 在配置根目录内展开文件和 Glob，返回排序、去重后的 POSIX 相对路径。
 * 每个正向 Pattern 默认都必须至少产生一个未被排除的文件。
 */
export async function expandFilePatterns(
  patterns: readonly FilePattern[],
  options: FilePatternExpansionInput,
): Promise<readonly string[]> {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new CautestError(`${options.label} 必须是非空文件 Pattern 数组`, { code: "config_error" });
  }
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new CautestError("expandFilePatterns() options 必须是对象", { code: "config_error" });
  }
  const unknown = Object.keys(options).filter((key) => !["baseDir", "label", "allowEmpty"].includes(key));
  if (unknown.length > 0) throw new CautestError(`expandFilePatterns() 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  if (typeof options.baseDir !== "string" || !path.isAbsolute(options.baseDir)) {
    throw new CautestError("expandFilePatterns.baseDir 必须是绝对路径", { code: "config_error" });
  }
  if (typeof options.label !== "string" || options.label.length === 0) {
    throw new CautestError("expandFilePatterns.label 必须是非空字符串", { code: "config_error" });
  }
  if (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean") {
    throw new CautestError("expandFilePatterns.allowEmpty 必须是 boolean", { code: "config_error" });
  }

  const normalized = patterns.map(normalizePattern);
  const positive: PatternMatcher[] = normalized
    .filter((item) => !item.negative)
    .map((item) => ({ source: item.value, match: picomatch(item.value, { dot: true }) }));
  if (positive.length === 0) throw new CautestError(`${options.label} 至少需要一个正向 Pattern`, { code: "config_error" });
  const negative = normalized
    .filter((item) => item.negative)
    .map((item) => picomatch(item.value, { dot: true }));

  const candidates = new Set<string>();
  for (const root of [...new Set(positive.map((item) => scanRoot(item.source)))].sort()) {
    await collectFiles(options.baseDir, root, candidates);
  }
  const included = [...candidates]
    .filter((candidate) => positive.some((item) => item.match(candidate)))
    .filter((candidate) => negative.every((match) => !match(candidate)))
    .sort();

  if (options.allowEmpty !== true) {
    for (const pattern of positive) {
      if (!included.some((candidate) => pattern.match(candidate))) {
        throw new CautestError(`${options.label} 的 Pattern 没有匹配文件: ${pattern.source}`, { code: "config_error" });
      }
    }
  }
  return Object.freeze(included);
}
