import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const installer = path.join(projectRoot, "dist/install.js");

async function prepareBuildInfo() {
  await exec(process.execPath, ["dist/build-info.js"], { cwd: projectRoot });
}

test("安装器生成无 TypeScript 和 node_modules 的自包含便携目录", async () => {
  await prepareBuildInfo();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-install-"));
  const destination = path.join(temporary, "tools/cautest");
  await exec(process.execPath, [installer, destination], { cwd: temporary });
  const rootEntries = await readdir(destination);
  assert.ok(rootEntries.includes("cautest.js"));
  assert.ok(rootEntries.includes("lib"));
  assert.ok(rootEntries.includes("docs"));
  assert.ok(rootEntries.includes("usage"));
  assert.ok(rootEntries.includes("examples"));
  assert.ok(!rootEntries.includes("node_modules"));
  assert.deepEqual(await readdir(path.join(destination, "lib/runtime")), ["cli.d.ts", "cli.d.ts.map", "cli.js", "cli.js.map", "direct-session.d.ts", "direct-session.d.ts.map", "direct-session.js", "direct-session.js.map", "environment.d.ts", "environment.d.ts.map", "environment.js", "environment.js.map", "interrupt.d.ts", "interrupt.d.ts.map", "interrupt.js", "interrupt.js.map", "process.d.ts", "process.d.ts.map", "process.js", "process.js.map"]);
  assert.equal((await readFile(path.join(destination, "lib/vendor/picomatch/LICENSE"), "utf8")).includes("MIT License"), true);
  assert.match(await readFile(path.join(destination, "docs/configuration.md"), "utf8"), /唯一顶层模型/u);
  assert.match(await readFile(path.join(destination, "usage/linux-driver/unit.md"), "utf8"), /不要求测试作者手写/u);

  const cBuild = path.join(temporary, "c-kit-build");
  const cPrefix = path.join(temporary, "c-kit-prefix");
  await exec("cmake", ["-S", path.join(destination, "assets/cautest-c"), "-B", cBuild, `-DCMAKE_INSTALL_PREFIX=${cPrefix}`]);
  await exec("cmake", ["--build", cBuild, "--parallel", "2"]);
  await exec("cmake", ["--install", cBuild]);
  const consumer = path.join(temporary, "c-kit-consumer");
  await mkdir(consumer);
  await writeFile(path.join(consumer, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.16)\nproject(cautest_consumer C)\nfind_package(cautest-c 0.2 CONFIG REQUIRED)\nadd_executable(consumer main.c)\ntarget_link_libraries(consumer PRIVATE cautest::mcu-reference)\n`);
  await writeFile(path.join(consumer, "main.c"), `#include <cautest/version.h>\n#include <cautest/ctp3.h>\n#include <cautest/platform/freestanding/cautest_freestanding.h>\n#include <cautest/target/mcu-reference/mcu_reference.h>\nint main(void) { return CAUTEST_C_API_MAJOR == 2U && CTP3_PROTOCOL_MAJOR == 3U ? 0 : 1; }\n`);
  const consumerBuild = path.join(temporary, "c-kit-consumer-build");
  await exec("cmake", ["-S", consumer, "-B", consumerBuild, `-DCMAKE_PREFIX_PATH=${cPrefix}`]);
  await exec("cmake", ["--build", consumerBuild]);
  await exec(path.join(consumerBuild, "consumer"), []);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else assert.ok(!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts"), `便携目录包含 TypeScript 源码: ${location}`);
    }
  }
  await visit(destination);

  const config = path.join(temporary, "cautest.config.mjs");
  await writeFile(config, `import { defineStep, testConfig, testJob } from '@cautest/config.js';

const prepare = defineStep({ kind: 'prepareFixture', phase: 'prepare', execute() {} });
const run = defineStep({ kind: 'runFixture', phase: 'run', execute() {} });

export default testConfig({ jobs: [
  testJob({ id: 'unit.example', level: 'unit', tags: ['unit'], workflow: [prepare, run] }),
] });
`);
  const listed = await exec(path.join(destination, "cautest.js"), ["--config", config, "list"], { cwd: temporary });
  assert.match(listed.stdout, /^unit\.example\tunit\tenabled\tunit$/mu);
  const planned = await exec(path.join(destination, "cautest.js"), ["--config", config, "plan", "unit.example"], { cwd: temporary });
  assert.match(planned.stdout, /01-prepare-prepareFixture-prepareFixture/u);
  assert.match(planned.stdout, /02-run-runFixture-runFixture/u);
  assert.match((await exec(path.join(destination, "cautest.js"), ["--version"])).stdout, /^Cautest 0\.2\.0 \(commit /u);
  assert.equal((await lstat(path.join(destination, "cautest.js"))).mode & 0o111, 0o111);
  assert.equal(JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8")).product, "cautest-portable");

  const allInOne = path.join(destination, "examples/all-in-one/cautest.config.mjs");
  const allPlan = await exec(path.join(destination, "cautest.js"), ["--config", allInOne, "plan"], { cwd: temporary });
  for (const id of ["unit.example-math", "component.kernel-counter", "integration.example-driver", "component.mcu-sim", "system.example-api"]) assert.match(allPlan.stdout, new RegExp(id, "u"));

  for (const example of ["c-lib", "mcu-sim", "system-script"]) {
    const exampleConfig = path.join(destination, `examples/${example}/cautest.config.mjs`);
    const executed = await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "run", "--json"], { cwd: temporary });
    assert.equal(JSON.parse(executed.stdout).status, "SUCCESS", `${example}: ${executed.stderr}`);
  }

  const interruptMarker = path.join(temporary, "interrupt-order.log");
  const interruptConfig = path.join(temporary, "interrupt.config.mjs");
  await writeFile(interruptConfig, `import { appendFile } from 'node:fs/promises';
import { defineStep, testConfig, testJob } from '@cautest/config.js';
const run = defineStep({ kind: 'interruptRun', phase: 'run', async execute({ signal, defer }) {
  defer(async () => appendFile(${JSON.stringify(interruptMarker)}, 'cleanup\\n'), 'interrupt-cleanup');
  await new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
} });
const collect = defineStep({ kind: 'interruptCollect', phase: 'collect', runWhen: 'always', async execute() { await appendFile(${JSON.stringify(interruptMarker)}, 'collect\\n'); } });
export default testConfig({ defaults: { resultDir: '.state/interrupt-results' }, jobs: [testJob({ id: 'system.interrupt', level: 'system', workflow: [run, collect] })] });
`);
  const interrupted = spawn(path.join(destination, "cautest.js"), ["--config", interruptConfig, "run", "--json"], { cwd: temporary, stdio: ["ignore", "pipe", "pipe"] });
  let interruptedStderr = "";
  const started = new Promise((resolve) => interrupted.stderr.on("data", (chunk) => { interruptedStderr += chunk.toString("utf8"); if (/START Step .*interruptRun/u.test(interruptedStderr)) resolve(); }));
  await Promise.race([started, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("等待 Interrupt Step 启动超时")), 5_000))]);
  interrupted.kill("SIGINT");
  const [interruptedCode] = await once(interrupted, "close");
  assert.equal(interruptedCode, 130);
  assert.match(interruptedStderr, /正在取消并清理/u);
  assert.equal(await readFile(interruptMarker, "utf8"), "collect\ncleanup\n");
});

test("安装器拒绝非空目录且不覆盖内容", async () => {
  await prepareBuildInfo();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-safe-"));
  const destination = path.join(temporary, "cautest");
  await mkdir(destination);
  await writeFile(path.join(destination, "keep.txt"), "keep\n");
  await assert.rejects(exec(process.execPath, [installer, destination], { cwd: temporary }));
  assert.equal(await readFile(path.join(destination, "keep.txt"), "utf8"), "keep\n");
});
