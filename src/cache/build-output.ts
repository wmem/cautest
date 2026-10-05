import {randomUUID} from "node:crypto";
import {readFile, realpath, rename, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileState} from "./file-state.js";
import {CAUTEST_CACHE_VERSIONS} from "../config/versions.js";

const filename = ".cautest-build-manifest.json";
interface Output {readonly path: string; readonly size: number; readonly mode: number; readonly mtimeNs: string}
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function record(root: string, relative: string): Promise<Output> {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) throw new Error("Invalid cache output path");
  const base = await realpath(root), file = await realpath(path.resolve(base, relative));
  if (!inside(base, file)) throw new Error("Cache output escaped its directory");
  return {path: relative, ...await fileState(file)};
}
/** 构建成功后发布输出元数据；文件存在不代表构建成功，不读取二进制内容。 */
export async function validBuildOutput(root: string, key: string, required: readonly string[]): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(root, filename), "utf8")) as {schema?: number; key?: string; outputs?: Output[]};
    if (manifest.schema !== CAUTEST_CACHE_VERSIONS.umlManifest || manifest.key !== key || !Array.isArray(manifest.outputs)) return false;
    const names = manifest.outputs.map(item => item.path);
    if (new Set(names).size !== names.length || names.length !== required.length || !required.every(name => names.includes(name))) return false;
    for (const output of manifest.outputs) {
      const actual = await record(root, output.path);
      if (actual.size !== output.size || actual.mode !== output.mode || actual.mtimeNs !== output.mtimeNs) return false;
    }
    return true;
  } catch {return false;}
}
export async function publishBuildOutput(root: string, key: string, required: readonly string[]): Promise<void> {
  const outputs = await Promise.all([...new Set(required)].sort().map(relative => record(root, relative)));
  const temporary = path.join(root, `${filename}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({schema: CAUTEST_CACHE_VERSIONS.umlManifest, key, outputs}, null, 2) + "\n");
    await rename(temporary, path.join(root, filename));
  } finally {await rm(temporary, {force: true});}
}
