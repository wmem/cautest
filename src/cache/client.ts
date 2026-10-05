import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CautestError } from "../model/error.js";
import {fileState} from "./file-state.js";
import { CAUTEST_VERSIONS } from "../config/versions.js";
import { stableSerialize } from "./fingerprint.js";

export interface CacheOutput { readonly name: string; readonly path: string }
interface CacheRecord { readonly name: string; readonly size: number; readonly mtimeNs: string; readonly cachePath: string }
interface CacheManifest { readonly schemaVersion: typeof CAUTEST_VERSIONS.schemas.cacheManifest; readonly fingerprint: string; readonly outputs: readonly CacheRecord[]; readonly metadata: Readonly<Record<string, unknown>> }
export interface CacheInspection { readonly hit: boolean; readonly reason: string; readonly entry?: string; readonly manifest?: CacheManifest; readonly cause?: unknown; readonly output?: string }

function validate(value: string): void { if (!/^[a-f0-9]{64}$/u.test(value)) throw new CautestError("Cache Fingerprint 必须是 SHA-256", { code: "cache_error" }); }

/** 校验输出元数据 Manifest，并通过原子目录发布支持并发 Writer 的文件 Cache。 */
export class CacheClient {
  readonly root: string;
  readonly enabled: boolean;
  constructor(options: { readonly root?: string; readonly enabled?: boolean } = {}) { this.root = path.resolve(options.root ?? ".cautest/cache"); this.enabled = options.enabled !== false; }
  async inspect(fingerprint: string): Promise<CacheInspection> {
    if (!this.enabled) return { hit: false, reason: "disabled" };
    validate(fingerprint); const entry = path.join(this.root, fingerprint); let manifest: CacheManifest;
    try { manifest = JSON.parse(await readFile(path.join(entry, "manifest.json"), "utf8")) as CacheManifest; }
    catch (cause) { return { hit: false, reason: typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT" ? "missing" : "corrupt", cause }; }
    if (manifest.schemaVersion !== CAUTEST_VERSIONS.schemas.cacheManifest || manifest.fingerprint !== fingerprint || !Array.isArray(manifest.outputs)) return { hit: false, reason: "corrupt" };
    try { for (const output of manifest.outputs) { const file = path.join(entry, output.cachePath); const info = await stat(file); if (!info.isFile() || info.size !== output.size || (await fileState(file)).mtimeNs !== output.mtimeNs) return { hit: false, reason: "corrupt" }; } }
    catch (cause) { return { hit: false, reason: typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT" ? "missing-output" : "corrupt", cause }; }
    return { hit: true, reason: "hit", entry, manifest };
  }
  async restore(fingerprint: string, outputs: readonly CacheOutput[]): Promise<CacheInspection> {
    const inspected = await this.inspect(fingerprint); if (!inspected.hit || inspected.manifest === undefined || inspected.entry === undefined) return inspected;
    const destinations = new Map(outputs.map((item) => [item.name, path.resolve(item.path)]));
    for (const output of inspected.manifest.outputs) if (!destinations.has(output.name)) return { hit: false, reason: "output-map-missing", output: output.name };
    try { for (const output of inspected.manifest.outputs) { const destination = destinations.get(output.name)!; await mkdir(path.dirname(destination), { recursive: true }); const temporary = `${destination}.cautest-${process.pid}-${randomUUID()}.tmp`; await copyFile(path.join(inspected.entry, output.cachePath), temporary); await rename(temporary, destination); } }
    catch (cause) { throw new CautestError("恢复 Cache 输出失败", { code: "cache_error", cause }); }
    return { hit: true, reason: "hit", manifest: inspected.manifest };
  }
  async store(fingerprint: string, outputs: readonly CacheOutput[], metadata: Readonly<Record<string, unknown>> = {}): Promise<{ readonly stored: boolean; readonly reason: string; readonly manifest?: CacheManifest }> {
    if (!this.enabled) return { stored: false, reason: "disabled" };
    validate(fingerprint); if (outputs.length === 0) throw new CautestError("Cache Store 至少需要一个输出", { code: "cache_error" });
    await mkdir(this.root, { recursive: true }); const temporary = path.join(this.root, `.tmp-${fingerprint}-${process.pid}-${randomUUID()}`); const entry = path.join(this.root, fingerprint);
    try {
      await mkdir(path.join(temporary, "files"), { recursive: true }); const records: CacheRecord[] = []; const names = new Set<string>();
      for (const output of outputs) {
        if (!/^[A-Za-z0-9._-]+$/u.test(output.name) || names.has(output.name)) throw new CautestError(`Cache Output Name 无效或重复: ${output.name}`, { code: "cache_error" }); names.add(output.name);
        const source = path.resolve(output.path); const info = await stat(source); if (!info.isFile()) throw new CautestError(`Cache 只存储普通文件: ${source}`, { code: "cache_error" });
        const cachePath = path.join("files", output.name); await copyFile(source, path.join(temporary, cachePath)); const record = {name: output.name, size: info.size, mtimeNs: (await fileState(path.join(temporary, cachePath))).mtimeNs, cachePath}; records.push(record);
      }
      const manifest: CacheManifest = { schemaVersion: CAUTEST_VERSIONS.schemas.cacheManifest, fingerprint, outputs: Object.freeze(records), metadata: Object.freeze({ ...metadata }) }; await writeFile(path.join(temporary, "manifest.json"), `${stableSerialize(manifest)}\n`, { flag: "wx" });
      try { await rename(temporary, entry); }
      catch (cause) { if (!(typeof cause === "object" && cause !== null && "code" in cause && (cause.code === "EEXIST" || cause.code === "ENOTEMPTY"))) throw cause; const existing = await this.inspect(fingerprint); if (!existing.hit) throw new CautestError("并发 Cache 条目无效", { code: "cache_error", cause }); await rm(temporary, { recursive: true, force: true }); return { stored: false, reason: "already-exists", ...(existing.manifest === undefined ? {} : { manifest: existing.manifest }) }; }
      return { stored: true, reason: "stored", manifest };
    } catch (cause) { await rm(temporary, { recursive: true, force: true }); if (cause instanceof CautestError) throw cause; throw new CautestError("原子写入 Cache 失败", { code: "cache_error", cause }); }
  }
}
