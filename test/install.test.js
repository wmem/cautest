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

test("安装器生成仅含运行 JS 和公开声明的自包含便携目录", async () => {
  await prepareBuildInfo();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-install-"));
  const destination = path.join(temporary, "tools/cautest");
  await exec(process.execPath, [installer, destination], { cwd: temporary });
  const rootEntries = await readdir(destination);
  assert.ok(rootEntries.includes("cautest.js"));
  assert.ok(rootEntries.includes("lib"));
  assert.ok(rootEntries.includes("docs"));
  assert.ok(!rootEntries.includes("usage"));
  assert.ok(rootEntries.includes("examples"));
  assert.ok(!rootEntries.includes("node_modules"));
  assert.deepEqual(await readdir(path.join(destination, "lib/runtime")), ["cli.js", "direct-session.js", "environment.js", "interrupt.js", "process.js"]);
  await assert.rejects(lstat(path.join(destination, "lib/vendor")));
  assert.equal((await readFile(path.join(destination, "lib/pattern/glob.js"), "utf8")).includes("globMatcher"), true);
  assert.match(await readFile(path.join(destination, "README.md"), "utf8"), /\[使用指南\]\(docs\/usage\/index\.md\)/u);
  assert.match(await readFile(path.join(destination, "docs/usage/index.md"), "utf8"), /doctor.*list.*plan.*run/su);
  assert.match(await readFile(path.join(destination, "docs/usage/linux-driver-unit.md"), "utf8"), /kernelCTestJobFactory/u);
  for (const document of ["project-organization.md", "model.md", "config-reference.md", "cli.md", "results.md"]) {
    assert.equal((await lstat(path.join(destination, "docs/usage", document))).isFile(), true, document);
  }
  await assert.rejects(lstat(path.join(destination, "docs/usage/installed.md")));
  await assert.rejects(lstat(path.join(destination, "docs/index.md")));
  await assert.rejects(lstat(path.join(destination, "docs/specifications")));
  await assert.rejects(lstat(path.join(destination, "lib/doctor/index.d.ts")));
  await assert.rejects(lstat(path.join(destination, "lib/runtime/cli.d.ts")));
  assert.equal((await lstat(path.join(destination, "lib/config/index.d.ts"))).isFile(), true);
  assert.equal((await lstat(path.join(destination, "lib/config/schema/native.d.ts"))).isFile(), true);

  const cBuild = path.join(temporary, "c-kit-build");
  const cPrefix = path.join(temporary, "c-kit-prefix");
  const cKit = path.join(destination, "assets/cautest-c");
  await exec("make", ["-C", cKit, `BUILD_DIR=${cBuild}`, "-j2"]);
  await exec("make", ["-C", cKit, `BUILD_DIR=${cBuild}`, `PREFIX=${cPrefix}`, "install"]);
  const consumer = path.join(temporary, "c-kit-consumer");
  await mkdir(consumer);
  await writeFile(path.join(consumer, "Makefile"), `CAUTEST_C_PREFIX := ${cPrefix}\ninclude ${cPrefix}/lib/cautest-c/cautest-c.mk\nCC ?= cc\nconsumer: main.c\n\t$(CC) -std=c99 -Wall -Wextra $(CAUTEST_C_CPPFLAGS) $< $(CAUTEST_C_LDFLAGS) $(CAUTEST_C_LIBS) -o $@\n`);
  await writeFile(path.join(consumer, "main.c"), `#include <cautest/version.h>\n#include <cautest/ctp3.h>\n#include <cautest/platform/freestanding/cautest_freestanding.h>\n#include <cautest/target/mcu-reference/mcu_reference.h>\nint main(void) { return CAUTEST_C_API_MAJOR == 2U && CTP3_PROTOCOL_MAJOR == 3U ? 0 : 1; }\n`);
  await exec("make", ["-C", consumer]);
  await exec(path.join(consumer, "consumer"), []);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else assert.ok(!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts"), `便携目录包含 TypeScript 源码: ${location}`);
    }
  }
  await visit(destination);

  async function visitLibrary(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visitLibrary(location);
      else assert.ok(entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"), `lib 包含非运行或声明文件: ${location}`);
    }
  }
  await visitLibrary(path.join(destination, "lib"));

  const typedConfig = path.join(temporary, "typed.config.mjs");
  const typedProject = path.join(temporary, "jsconfig.json");
  await writeFile(typedConfig, `import { nativeCTestJob, testConfig } from '@cautest/config.js';
export default testConfig({ jobs: [nativeCTestJob({ id: 'unit.typed', tests: ['test/**/*_test.c'] })] });
`);
  await writeFile(typedProject, `${JSON.stringify({
    compilerOptions: {
      checkJs: true,
      noEmit: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      baseUrl: ".",
      paths: { "@cautest/config.js": [path.join(destination, "lib/config/index.d.ts")] },
      types: ["node"],
      typeRoots: [path.join(projectRoot, "node_modules/@types")],
    },
    include: [typedConfig],
  }, null, 2)}\n`);
  await exec(process.execPath, [path.join(projectRoot, "node_modules/typescript/bin/tsc"), "-p", typedProject], { cwd: temporary });

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

  const kernelFixture = path.join(temporary, "kernel-fixture");
  const busyboxFixture = path.join(temporary, "busybox-fixture");
  await mkdir(path.join(kernelFixture, "arch/um"), { recursive: true });
  await mkdir(busyboxFixture, { recursive: true });
  await Promise.all([
    writeFile(path.join(kernelFixture, "Makefile"), "all:\n\t@true\n"),
    writeFile(path.join(kernelFixture, "arch/um/Kconfig"), "config UML\n\tbool\n"),
    writeFile(path.join(busyboxFixture, "Makefile"), "all:\n\t@true\n"),
  ]);
  const exampleEnv = {
    ...process.env,
    KERNEL_SRC: kernelFixture,
    BUSYBOX_SRC: busyboxFixture,
    CAUTEST_EXAMPLE_PORT: String(20_000 + process.pid % 20_000),
  };
  const allInOne = path.join(destination, "examples/all-in-one.config.mjs");
  await exec(path.join(destination, "cautest.js"), ["--config", allInOne, "doctor"], { cwd: temporary, env: exampleEnv });
  const allList = JSON.parse((await exec(path.join(destination, "cautest.js"), ["--config", allInOne, "list", "--json"], { cwd: temporary, env: exampleEnv })).stdout);
  assert.deepEqual(allList.map(({ id, level, tags, enabled }) => ({ id, level, tags, enabled })), [
    { id: "unit.example-math", level: "unit", tags: ["unit"], enabled: true },
    { id: "component.kernel-counter", level: "component", tags: ["component", "kernel", "uml"], enabled: true },
    { id: "unit.example-driver-core", level: "unit", tags: ["unit", "driver"], enabled: true },
    { id: "integration.example-driver", level: "integration", tags: ["integration", "driver", "uml"], enabled: true },
    { id: "component.mcu-sim", level: "component", tags: ["component", "mcu"], enabled: true },
    { id: "system.example-api", level: "system", tags: ["system", "script"], enabled: true },
  ]);
  const allPlan = JSON.parse((await exec(path.join(destination, "cautest.js"), ["--config", allInOne, "plan", "--json"], { cwd: temporary, env: exampleEnv })).stdout);
  assert.deepEqual(allPlan.map((job) => job.id), allList.map((job) => job.id));

  for (const [example, jobId, level, tags] of [
    ["kernel-lib", "component.kernel-counter", "component", ["component", "kernel", "uml"]],
    ["linux-driver-unit", "unit.example-driver-core", "unit", ["unit", "driver"]],
    ["linux-driver", "integration.example-driver", "integration", ["integration", "driver", "uml"]],
  ]) {
    const exampleConfig = path.join(destination, `examples/${example}/cautest.config.mjs`);
    await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "doctor"], { cwd: temporary, env: exampleEnv });
    const [listed] = JSON.parse((await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "list", "--json"], { cwd: temporary, env: exampleEnv })).stdout);
    assert.deepEqual({ id: listed.id, level: listed.level, tags: listed.tags }, { id: jobId, level, tags });
    const [planned] = JSON.parse((await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "plan", jobId, "--level", level, "--json"], { cwd: temporary, env: exampleEnv })).stdout);
    assert.equal(planned.id, jobId);
  }

  for (const [example, jobId, level, tags, expectedCases] of [
    ["c-lib", "unit.example-math", "unit", ["unit"], ["adds_two_numbers", "clamps_to_range"]],
    ["mcu-sim", "component.mcu-sim", "component", ["component", "mcu"], ["adds_values", "clamps_values"]],
    ["system-script", "system.example-api", "system", ["system", "script"], ["health endpoint returns ok", "version endpoint returns release"]],
    ["workflow", "system.composed-local", "system", [], ["adds_two_numbers", "server is ready"]],
  ]) {
    const exampleConfig = path.join(destination, `examples/${example}/cautest.config.mjs`);
    await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "doctor"], { cwd: temporary, env: exampleEnv });
    const [listed] = JSON.parse((await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "list", "--json"], { cwd: temporary, env: exampleEnv })).stdout);
    assert.deepEqual({ id: listed.id, level: listed.level, tags: listed.tags }, { id: jobId, level, tags });
    assert.match((await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "plan", jobId], { cwd: temporary, env: exampleEnv })).stdout, new RegExp(jobId, "u"));
    const executed = await exec(path.join(destination, "cautest.js"), ["--config", exampleConfig, "run", "--json"], { cwd: temporary, env: exampleEnv });
    const summary = JSON.parse(executed.stdout);
    assert.equal(summary.status, "SUCCESS", `${example}: ${executed.stderr}`);
    const result = JSON.parse(await readFile(summary.resultPath, "utf8"));
    const cases = result.jobs.flatMap((job) => job.groups.flatMap((group) => group.cases.map((item) => item.name)));
    for (const expected of expectedCases) assert.ok(cases.includes(expected), `${example}: 缺少 Case ${expected}`);
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
