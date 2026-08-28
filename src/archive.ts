#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createPortableTree, readBuildInfo, verifyPortableTree } from "./portable.js";

const execFileAsync = promisify(execFile);
const usage = `用法: pnpm pack:portable [--output <归档路径>] [--force]

生成解压后可直接使用的 Cautest .tar.gz 便携包和 .sha256 校验文件。

选项:
  -o, --output <路径>  指定输出文件，必须以 .tar.gz 结尾
  --force              覆盖已存在的同名普通文件
  -h, --help           显示帮助
`;

interface ArchiveOptions {
  readonly output?: string;
  readonly force: boolean;
  readonly help: boolean;
}

function parseArgs(args: readonly string[]): ArchiveOptions {
  let output: string | undefined;
  let force = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--force") force = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--output" || argument === "-o") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(`${argument} 缺少路径\n\n${usage.trimEnd()}`);
      if (output !== undefined) throw new Error("只能指定一个输出路径");
      output = value;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new Error(`未知选项: ${argument}\n\n${usage.trimEnd()}`);
    } else if (argument !== undefined && output === undefined) {
      output = argument;
    } else {
      throw new Error(`只能指定一个输出路径\n\n${usage.trimEnd()}`);
    }
  }
  return { ...(output === undefined ? {} : { output }), force, help };
}

function archiveFileName(version: string, commit: string, dirty: boolean): string {
  const revision = /^[0-9a-f]{40}$/u.test(commit) ? commit.slice(0, 12) : "unknown";
  return `cautest-${version}-${revision}${dirty ? "-dirty" : ""}.tar.gz`;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function checkOutput(location: string, force: boolean): Promise<void> {
  try {
    const metadata = await lstat(location);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`输出路径不是普通文件，拒绝覆盖: ${location}`);
    if (!force) throw new Error(`输出文件已存在: ${location}；如需覆盖请使用 --force`);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function createArchive(output: string, force: boolean): Promise<{ readonly archive: string; readonly checksum: string }> {
  if (!output.endsWith(".tar.gz")) throw new Error(`输出文件必须以 .tar.gz 结尾: ${output}`);
  const destination = path.resolve(output);
  const checksumDestination = `${destination}.sha256`;
  await Promise.all([checkOutput(destination, force), checkOutput(checksumDestination, force)]);

  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".cautest-pack-"));
  const portable = path.join(temporary, "cautest");
  const verification = path.join(temporary, "verification");
  const archive = path.join(temporary, "cautest.tar.gz");
  const checksum = path.join(temporary, "cautest.tar.gz.sha256");

  try {
    const build = await readBuildInfo();
    await mkdir(portable);
    await createPortableTree(portable, build);
    await verifyPortableTree(portable);
    await execFileAsync("tar", ["-czf", archive, "-C", temporary, "cautest"]);

    await mkdir(verification);
    await execFileAsync("tar", ["-xzf", archive, "-C", verification]);
    await verifyPortableTree(path.join(verification, "cautest"));

    const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(checksum, `${digest}  ${path.basename(destination)}\n`);
    if (force) await Promise.all([
      rm(destination, { force: true }),
      rm(checksumDestination, { force: true }),
    ]);
    await rename(archive, destination);
    await rename(checksum, checksumDestination);
    return { archive: destination, checksum: checksumDestination };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const build = await readBuildInfo();
  const output = options.output ?? path.join("release", archiveFileName(build.version, build.commit, build.dirty));
  const result = await createArchive(output, options.force);
  process.stdout.write(`便携包: ${result.archive}\nSHA-256: ${result.checksum}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
