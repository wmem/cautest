import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CAUTEST_VERSIONS } from "../dist/config/index.js";

const exec = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("版本表统一约束 Package、TypeScript、C Header 和 Build Info", async () => {
  await exec(process.execPath, ["scripts/sync-versions.mjs"], { cwd: root });
  const source = JSON.parse(await readFile(path.join(root, "versions.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  const makefile = await readFile(path.join(root, "assets/cautest-c/Makefile"), "utf8");
  const header = await readFile(path.join(root, "assets/cautest-c/include/cautest/version.h"), "utf8");
  assert.deepEqual(CAUTEST_VERSIONS, source);
  assert.equal(manifest.version, source.release);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.doesNotMatch(lockfile, /picomatch/u);
  assert.match(makefile, new RegExp(`CAUTEST_C_VERSION := ${source.release.replaceAll(".", "\\.")}`, "u"));
  assert.match(header, new RegExp(`#define CAUTEST_RELEASE_VERSION "${source.release.replaceAll(".", "\\.")}"`, "u"));
  assert.match(header, new RegExp(`#define CAUTEST_CTP_PROTOCOL_MAJOR ${source.ctp.major}U`, "u"));
  assert.match(header, new RegExp(`#define CAUTEST_KERNEL_ABI_MAJOR ${source.kernelAbi.major}U`, "u"));
  assert.match(header, new RegExp(`#define CAUTEST_PROBE_ABI_MAJOR ${source.probeAbi.major}U`, "u"));
  await exec(process.execPath, ["dist/build-info.js"], { cwd: root });
  const build = JSON.parse(await readFile(path.join(root, "dist/build-info.json"), "utf8"));
  assert.equal(build.version, source.release);
  assert.deepEqual(build.versions, source);
});
