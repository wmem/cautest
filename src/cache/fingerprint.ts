import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { CautestError } from "../model/error.js";

type Json = null | boolean | number | string | readonly Json[] | Readonly<{ readonly [key: string]: Json }>;

function canonical(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new CautestError("Fingerprint 不接受非有限数值", { code: "cache_error" }); return value; }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  throw new CautestError("Fingerprint 只接受 JSON 可表达的确定性输入", { code: "cache_error" });
}

export function stableSerialize(value: unknown): string { return JSON.stringify(canonical(value)); }
export function hashBytes(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export async function hashFile(file: string): Promise<string> { return hashBytes(await readFile(file)); }

export interface FingerprintInput {
  readonly namespace?: string;
  readonly files?: readonly string[];
  readonly generated?: Readonly<Record<string, unknown>>;
  readonly tool?: Readonly<Record<string, unknown>>;
  readonly args?: readonly unknown[];
  readonly env?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
}

/** 生成与对象键、文件声明顺序无关的强内容指纹。 */
export async function createFingerprint(input: FingerprintInput = {}, options: { readonly baseDir?: string } = {}): Promise<string> {
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const files = [...new Set((input.files ?? []).map((file) => path.resolve(baseDir, file)))].sort();
  const fileInputs = [];
  for (const file of files) {
    let info;
    try { info = await stat(file); } catch (cause) { throw new CautestError(`Fingerprint 输入不存在: ${file}`, { code: "cache_error", cause }); }
    if (!info.isFile()) throw new CautestError(`Fingerprint 输入不是普通文件: ${file}`, { code: "cache_error" });
    fileInputs.push({ path: path.relative(baseDir, file).split(path.sep).join("/"), sha256: await hashFile(file) });
  }
  return hashBytes(stableSerialize({ schemaVersion: 1, namespace: input.namespace ?? "cautest", files: fileInputs, generated: input.generated ?? {}, tool: input.tool ?? {}, args: input.args ?? [], env: input.env ?? {}, values: input.values ?? {} }));
}
