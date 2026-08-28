import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import test from "node:test";
import { runCtpSession } from "../dist/protocol/native-session.js";
import { UmlControlChannel } from "../dist/uml/control.js";
import { buildGuestProgram, buildRootfs, collectUml, startUml } from "../dist/uml/runtime.js";
import { testConfig, testJob } from "../dist/config/define.js";
import { executeRun } from "../dist/result/run.js";
import { defineStep } from "../dist/workflow/step.js";

class AgentDuplex extends Duplex {
  _read() {}
  _write(chunk, _encoding, callback) {
    const command = chunk.toString("utf8").trim();
    const responses = command === "OPEN kernel" ? ["OK"]
      : command === "AT+HELLO" ? ["+HELLO:3,0,build-1,boot-1,64,512", "OK:HELLO"]
      : command === "AT+LIST" ? ["+LIST:START", "+CASE:1,1,0,suite,case,", "+LIST:END,1", "OK:LIST"]
      : command.startsWith("AT+SUITE=") ? ["+EXEC-START:1,SUITE,1,0,0", "+SUITE-START:1,1", "+CASE-START:1,1,1,0", "+CASE-END:1,1,1,0,PASS", "+SUITE-END:1,1,PASS", "+EXEC-END:1,PASS,1,0,0,0", "OK:SUITE,1"]
      : command === "AT+BYE" ? ["OK:BYE"] : [];
    queueMicrotask(() => this.push(`${responses.join("\n")}\n`));
    callback();
  }
}

test("UML Control Channel 将 Agent Endpoint 复用为统一 CTP3 Transport", async () => {
  const stream = new AgentDuplex();
  const control = new UmlControlChannel(stream);
  queueMicrotask(() => stream.push("CAUTEST_AGENT_READY 1 image-1 boot-1\n"));
  assert.deepEqual(await control.waitReady(1000), { buildId: "image-1", bootId: "boot-1" });
  const session = await runCtpSession({ transport: control.openEndpoint("kernel"), expectedBuildId: "build-1", run: {}, signal: new AbortController().signal });
  assert.equal(session.groups[0].cases[0].status, "PASS");
  assert.equal(session.catalog.length, 1);
  await control.close();
});

async function archiveEntries(archive) {
  const child = spawn("cpio", ["--quiet", "-it"], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stdin.end(await readFile(archive));
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  return Buffer.concat(output).toString("utf8").split("\n");
}

test("Rootfs 真实生成 Agent、Catalog、Module 和 initramfs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-rootfs-"));
  const module = path.join(root, "test.ko");
  await writeFile(module, "module");
  const context = {
    job: { id: "unit.fixture", env: {} }, signal: new AbortController().signal, state: new Map(), output() {},
    project: { configDir: root, resultDir: path.join(root, "results"), cacheDir: path.join(root, "cache"), generatedDir: path.join(root, "generated"), workDir: path.join(root, "work") },
  };
  const image = await buildRootfs({
    name: "fixture",
    environment: { kernel: { sourceDir: "linux" }, busybox: { sourceDir: "busybox" } },
    kernelOutput: path.join(root, "kernel"),
    busybox: { path: "/usr/bin/busybox", buildId: "busybox", cacheHit: false },
    modules: [{ name: "test", cacheKey: "module-key", cacheHit: false, module, symbols: module, modulesOrder: module }],
  }, context);
  const entries = await archiveEntries(image.rootfsPath);
  assert.ok(entries.includes("bin"));
  assert.ok(entries.includes("init"));
  assert.ok(entries.includes("etc/cautest/catalog"));
  assert.ok(entries.includes("opt/cautest/bin/agent"));
  assert.ok(entries.includes("opt/cautest/modules/00-test.ko"));
  assert.equal(image.endpoints.get("kernel").buildId, image.buildId);
});

test("UML Guest Program 使用独立可关闭的构建缓存", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-guest-program-"));
  await writeFile(path.join(root, "main.c"), "int main(void) { return 0; }\n");
  const context = {
    job: { id: "integration.guest", env: {} }, signal: new AbortController().signal, state: new Map(), output() {},
    project: { configDir: root, resultDir: path.join(root, "results"), cacheDir: path.join(root, "cache"), generatedDir: path.join(root, "generated"), workDir: path.join(root, "work") },
  };
  const cached = await buildGuestProgram({ name: "guest", sources: ["main.c"], cache: { directory: "custom-cache" } }, context);
  assert.equal(cached.path.startsWith(path.join(root, "custom-cache", "guest-programs")), true);
  const disabled = await buildGuestProgram({ name: "guest", sources: ["main.c"], cache: { enabled: false } }, context);
  assert.equal(disabled.path.startsWith(path.join(root, "work", "guest-programs")), true);
});

test("UML 启动、日志收集和清理进入统一 Resource/Artifact 生命周期", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-uml-lifecycle-"));
  const kernel = path.join(root, "fake-uml.mjs");
  const rootfs = path.join(root, "rootfs.cpio");
  await writeFile(rootfs, "rootfs");
  await writeFile(kernel, `#!${process.execPath}
import { createReadStream, createWriteStream } from "node:fs";
const input = createReadStream(null, { fd: 3, autoClose: false });
const output = createWriteStream(null, { fd: 3, autoClose: false });
output.write("CAUTEST_AGENT_READY 1 image-1 boot-1\\n");
let pending = "";
input.on("data", (chunk) => {
  pending += chunk.toString("utf8");
  for (;;) {
    const newline = pending.indexOf("\\n");
    if (newline < 0) break;
    const command = pending.slice(0, newline); pending = pending.slice(newline + 1);
    if (command === "GOODBYE") output.write("BYE\\n");
    if (command === "SHUTDOWN") process.exit(0);
  }
});
console.log("fake uml ready");
`);
  await chmod(kernel, 0o755);
  const image = { kernelPath: kernel, rootfsPath: rootfs, buildId: "image-1", endpoints: new Map(), cacheHit: false };
  const provision = defineStep({ kind: "umlStart", name: "fixture", phase: "provision", async execute(context) { context.state.set("image:fixture", image); await startUml("fixture", image, { kernel: { sourceDir: "linux" }, busybox: { sourceDir: "busybox" } }, context); return {}; } });
  const collect = defineStep({ kind: "umlLogs", name: "fixture", phase: "collect", runWhen: "always", async execute(context) { return { diagnostics: await collectUml("fixture", context) }; } });
  const result = await executeRun(testConfig({ jobs: [testJob({ id: "integration.uml.lifecycle", level: "integration", policy: { allowEmpty: true }, workflow: [provision, collect] })] }), { configDir: root, resultDir: path.join(root, "results") });
  assert.equal(result.jobs[0].status, "SKIP", JSON.stringify(result.jobs[0].errors));
  assert.equal(result.jobs[0].resources[0].state, "closed");
  assert.deepEqual(result.jobs[0].artifacts.map((item) => `${item.kind}:${item.name}`), ["log:fixture-console", "log:fixture-host-stderr"]);
  assert.match(await readFile(result.jobs[0].artifacts[0].path, "utf8"), /fake uml ready/u);
});
