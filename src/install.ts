#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createPortableTree, readBuildInfo, verifyPortableTree, type BuildInfo } from "./portable.js";

type DestinationState = "missing" | "empty";

const usage = `用法: cautest-install <目标目录>

目标目录必须不存在或为空。安装器不会覆盖文件、符号链接或非空目录。
`;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function inspectDestination(destination: string): Promise<DestinationState> {
  try {
    const metadata = await lstat(destination);
    if (metadata.isSymbolicLink()) throw new Error(`目标目录是符号链接，拒绝写入: ${destination}`);
    if (!metadata.isDirectory()) throw new Error(`目标路径不是目录，拒绝覆盖: ${destination}`);
    if ((await readdir(destination)).length > 0) throw new Error(`目标目录非空，拒绝覆盖: ${destination}`);
    return "empty";
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

function resolveDestination(input: string, cwd: string): string {
  const destination = path.resolve(cwd, input);
  if (destination === path.parse(destination).root) throw new Error("拒绝将文件系统根作为目标目录");
  const relative = path.relative(destination, cwd);
  const containsCwd = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  if (containsCwd) throw new Error("拒绝将当前工作目录或其父目录作为目标目录");
  return destination;
}

async function restoreEmptyDirectory(destination: string): Promise<void> {
  try {
    await mkdir(destination);
  } catch (error) {
    if (!isMissing(error) && !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }
}

async function install(destination: string): Promise<BuildInfo> {
  const initialState = await inspectDestination(destination);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(parent, ".cautest-v2-install-"));
  const staged = path.join(temporaryRoot, "cautest");
  await mkdir(staged);
  try {
    const build = await readBuildInfo();
    await createPortableTree(staged, build);
    await verifyPortableTree(staged);
    if (await inspectDestination(destination) !== initialState) throw new Error("目标目录状态在安装期间发生变化");
    if (initialState === "empty") {
      await rmdir(destination);
      try {
        await rename(staged, destination);
      } catch (error) {
        await restoreEmptyDirectory(destination);
        throw error;
      }
    } else {
      await rename(staged, destination);
    }
    return build;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(usage);
    return;
  }
  const input = args[0];
  if (args.length !== 1 || input === undefined || input.startsWith("-")) throw new Error(usage.trimEnd());
  const destination = resolveDestination(input, process.cwd());
  const build = await install(destination);
  process.stdout.write(`Cautest ${build.version} (commit ${build.commit}${build.dirty ? ", dirty" : ""}) 已安装到: ${destination}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
