import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildKernel } from "../dist/jobs/kernel.js";
import { buildBusyBox } from "../dist/uml/runtime.js";

async function tree(root, relative = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await tree(root, child));
    else result.push(child.split(path.sep).join("/"));
  }
  return result.sort();
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function context(project, env = {}) {
  return {
    job: { id: "integration.out-of-tree", env }, signal: new AbortController().signal, state: new Map(), output() {},
    project: { configDir: project, resultDir: path.join(project, "results"), cacheDir: path.join(project, ".cautest/cache"), generatedDir: path.join(project, ".cautest/generated"), workDir: path.join(project, ".cautest/work") },
  };
}

test("Kernel 与 BusyBox 并发复用源码时只写各项目的 out-of-tree 目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-kernel-build-"));
  const linux = path.join(root, "linux");
  const busybox = path.join(root, "busybox");
  const projectA = path.join(root, "project-a");
  const projectB = path.join(root, "project-b");
  await Promise.all([mkdir(linux), mkdir(busybox), mkdir(projectA), mkdir(projectB)]);
  await Promise.all([
    writeFile(path.join(linux, "Makefile"), "VERSION = 1\n"),
    writeFile(path.join(linux, "source.c"), "int kernel_source;\n"),
    writeFile(path.join(busybox, "Makefile"), "VERSION = 1\n"),
    writeFile(path.join(busybox, "applets.c"), "int busybox_source;\n"),
  ]);
  const make = path.join(root, "fake-make.mjs");
  await writeFile(make, `#!${process.execPath}
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") { console.log("fake make 1"); process.exit(0); }
const source = args[args.indexOf("-C") + 1];
const output = args.find((item) => item.startsWith("O=")).slice(2);
const target = args.at(-1);
mkdirSync(output, { recursive: true });
mkdirSync(path.join(output, "include/config"), {recursive: true});
writeFileSync(path.join(output, "include/config/kernel.release"), "fixture-only");
appendFileSync(process.env.CAUTEST_FAKE_MAKE_LOG, JSON.stringify({ source, output, target, args, profile: process.env.CAUTEST_PROFILE_ENV ?? null }) + "\\n");
if (target.endsWith("defconfig") && target !== "olddefconfig") writeFileSync(path.join(output, ".config"), "CONFIG_FAKE=y\\n");
if (target === "linux") writeFileSync(path.join(output, "linux"), readFileSync(path.join(source, "source.c")));
if (target === "modules") writeFileSync(path.join(output, "Module.symvers"), "symbols\\n");
if (target === "busybox") writeFileSync(path.join(output, "busybox"), readFileSync(path.join(source, "applets.c")));
`);
  await chmod(make, 0o755);
  const linuxBefore = await tree(linux);
  const busyboxBefore = await tree(busybox);

  async function build(project, profile) {
    const log = path.join(project, "make.log");
    await writeFile(log, "");
    const ctx = context(project, profile === undefined ? {} : { CAUTEST_PROFILE_ENV: profile });
    const environment = { kernel: { sourceDir: linux, make, makeArgs: ["HOST_MARKER=kept"], env: { CAUTEST_FAKE_MAKE_LOG: log } }, busybox: { sourceDir: busybox, make, makeArgs: ["HOST_MARKER=kept"], env: { CAUTEST_FAKE_MAKE_LOG: log } } };
    const [kernelArtifact, busyboxArtifact] = await Promise.all([buildKernel(environment, ctx, "fixture"), buildBusyBox(environment.busybox, ctx)]);
    return { kernelArtifact, busyboxArtifact, calls: (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse) };
  }

  const [first, second] = await Promise.all([build(projectA), build(projectB)]);
  for (const [project, result] of [[projectA, first], [projectB, second]]) {
    assert.equal(inside(path.join(project, ".cautest/cache"), result.kernelArtifact.path), true);
    assert.equal(inside(path.join(project, ".cautest/cache"), result.busyboxArtifact.path), true);
    assert.ok(result.calls.every(call => call.args.includes("HOST_MARKER=kept")), "makeArgs must reach defconfig, olddefconfig, build and modules");
    assert.ok(result.calls.every((call) => inside(path.join(project, ".cautest/cache"), call.output)));
  }
  assert.notEqual(first.kernelArtifact.path, second.kernelArtifact.path);
  assert.deepEqual(await tree(linux), linuxBefore);
  assert.deepEqual(await tree(busybox), busyboxBefore);

  const hit = await build(projectA);
  assert.equal(hit.kernelArtifact.cacheHit, true);
  assert.equal(hit.busyboxArtifact.cacheHit, true);
  for (const relative of ["linux", ".config", "Module.symvers", "include/config/kernel.release"]) {
    await writeFile(path.join(first.kernelArtifact.path, relative), "corrupt-but-present");
    assert.equal((await build(projectA)).kernelArtifact.cacheHit, false, relative);
  }
  await writeFile(first.busyboxArtifact.path, "corrupt-but-present");
  assert.equal((await build(projectA)).busyboxArtifact.cacheHit, false);
  await writeFile(path.join(path.dirname(first.busyboxArtifact.path), ".config"), "corrupt");
  assert.equal((await build(projectA)).busyboxArtifact.cacheHit, false);

  await writeFile(path.join(linux, "source.c"), "int changed_kernel_source;\n");
  const changed = await build(projectA);
  assert.notEqual(changed.kernelArtifact.path, first.kernelArtifact.path);

  const profiled = await build(projectA, "profile-one");
  const reprofiled = await build(projectA, "profile-two");
  assert.notEqual(profiled.kernelArtifact.path, reprofiled.kernelArtifact.path);
  assert.notEqual(profiled.busyboxArtifact.path, reprofiled.busyboxArtifact.path);
  assert.equal(profiled.calls.filter((call) => call.profile !== null).every((call) => call.profile === "profile-one"), true);
  assert.equal(reprofiled.calls.filter((call) => call.profile !== null).every((call) => call.profile === "profile-two"), true);
});
