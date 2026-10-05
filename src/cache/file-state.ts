import {stat, readFile, writeFile, mkdir, copyFile, rm} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";

/** 仅查询文件元数据，不读取源码或二进制内容。 */
export async function fileState(file: string): Promise<{size: number; mtimeNs: string; mode: number}> {
  const info = await stat(file, {bigint: true});
  if (!info.isFile()) throw new Error(`不是普通文件: ${file}`);
  return {size: Number(info.size), mtimeNs: info.mtimeNs.toString(), mode: Number(info.mode & 0o777n)};
}

export async function writeChanged(file: string, text: string): Promise<void> {
  try { if (await readFile(file, "utf8") === text) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, text);
}

/** 持久化普通协议标识；不根据文件内容生成，不在无变化运行时改写入口。 */
export async function buildIdentity(directory: string): Promise<string> {
  const file = path.join(directory, "build-id");
  await mkdir(directory, {recursive: true});
  try { return (await readFile(file, "utf8")).trim(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const id = randomUUID().replaceAll("-", "").slice(0, 24);
  try { await writeFile(file, id, {flag: "wx"}); return id; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
}

/** 同步构建隔离目录。只复制元数据有变化的输入，不读取内容判断变化。 */
export async function syncFiles(directory: string, files: readonly {source: string; destination: string}[]): Promise<void> {
  const record = path.join(directory, "source-state.json");
  let previous: Record<string, unknown> = {};
  try { previous = JSON.parse(await readFile(record, "utf8")) as Record<string, unknown>; } catch { /* 首次同步。 */ }
  const next: Record<string, unknown> = {};
  for (const {source, destination} of files) {
    const relative = path.relative(directory, destination);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("同步输出越过隔离目录");
    const state = {source, input: await fileState(source)};
    let current: unknown;
    try { current = { ...state, output: await fileState(destination)}; } catch { /* 缺失输出需要复制。 */ }
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(previous[relative])) {
      await mkdir(path.dirname(destination), {recursive: true});
      await copyFile(source, destination);
    }
    next[relative] = {...state, output: await fileState(destination)};
  }
  for (const relative of Object.keys(previous)) if (!(relative in next)) {
    const destination = path.resolve(directory, relative);
    if (path.relative(directory, destination).startsWith("..")) throw new Error("同步记录越过隔离目录");
    await rm(destination, {force: true});
  }
  await writeChanged(record, JSON.stringify(next));
}
