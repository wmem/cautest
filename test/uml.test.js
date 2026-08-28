import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import test from "node:test";
import { runCtpSession } from "../dist/protocol/native-session.js";
import { UmlControlChannel } from "../dist/uml/control.js";
import { buildGuestProgram, buildRootfs } from "../dist/uml/runtime.js";

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
  const results = await runCtpSession({ transport: control.openEndpoint("kernel"), expectedBuildId: "build-1", run: {}, signal: new AbortController().signal });
  assert.equal(results[0].cases[0].status, "PASS");
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
