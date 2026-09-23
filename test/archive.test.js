import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CAUTEST_RELEASE_VERSION } from "../dist/config/index.js";

const exec = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const archiveCommand = path.join(projectRoot, "dist/archive.js");

test("npm 发布包包含安装器运行时输入", async () => {
  const packed = JSON.parse((await exec("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], { cwd: projectRoot })).stdout);
  const files = new Set(packed[0].files.map((item) => item.path));
  for (const required of ["LICENSE", "dist/install.js", "dist/portable.js", "dist/build-info.json", "versions.json"]) assert.ok(files.has(required), required);
});

test("便携包可解压、校验并直接运行", async (t) => {
  await exec(process.execPath, ["dist/build-info.js"], { cwd: projectRoot });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-archive-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "release/cautest-test.tar.gz");

  const generated = await exec(process.execPath, [archiveCommand, "--output", output], { cwd: projectRoot });
  assert.match(generated.stdout, /便携包:/u);
  assert.equal((await lstat(output)).isFile(), true);

  const digest = createHash("sha256").update(await readFile(output)).digest("hex");
  assert.equal(await readFile(`${output}.sha256`, "utf8"), `${digest}  cautest-test.tar.gz\n`);
  const entries = (await exec("tar", ["-tzf", output])).stdout.trim().split("\n");
  assert.ok(entries.includes("cautest/cautest.js"));
  assert.ok(entries.includes("cautest/LICENSE"));
  assert.ok(entries.includes("cautest/assets/cautest-c/LICENSE"));
  assert.ok(entries.includes("cautest/assets/cautest-c/include/cautest/cautest.h"));
  assert.ok(entries.includes("cautest/docs/usage/index.md"));
  assert.ok(entries.includes("cautest/lib/config/index.d.ts"));
  assert.ok(!entries.some((entry) => entry.endsWith(".map")));
  assert.ok(!entries.includes("cautest/docs/index.md"));
  assert.ok(!entries.some((entry) => entry.startsWith("cautest/usage/")));
  assert.ok(entries.every((entry) => entry === "cautest/" || entry.startsWith("cautest/")));

  const extracted = path.join(temporary, "extracted");
  await mkdir(extracted);
  await exec("tar", ["-xzf", output, "-C", extracted]);
  const executable = path.join(extracted, "cautest/cautest.js");
  assert.notEqual((await lstat(executable)).mode & 0o111, 0);
  assert.match((await exec(executable, ["--version"])).stdout, new RegExp(`^Cautest ${CAUTEST_RELEASE_VERSION.replaceAll(".", "\\.")} \\(commit `, "u"));

  const example = path.join(extracted, "cautest/examples/c-lib/cautest.config.mjs");
  const run = await exec(executable, ["--config", example, "run", "--json"], { cwd: temporary });
  assert.equal(JSON.parse(run.stdout).status, "SUCCESS", run.stderr);

  await assert.rejects(
    exec(process.execPath, [archiveCommand, "--output", output], { cwd: projectRoot }),
    /输出文件已存在/u,
  );
  await exec(process.execPath, [archiveCommand, "--output", output, "--force"], { cwd: projectRoot });
  assert.equal((await lstat(output)).isFile(), true);

  const separatedOutput = path.join(temporary, "release/cautest-separated.tar.gz");
  await exec(process.execPath, [archiveCommand, "--", "--output", separatedOutput], { cwd: projectRoot });
  assert.equal((await lstat(separatedOutput)).isFile(), true);
});
