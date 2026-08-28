import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIsolatedKernelModule } from "../dist/kernel/module-build.js";

const fixture = path.resolve(new URL("fixtures/kernel/fake-make.sh", import.meta.url).pathname);

async function names(root) {
  const output = [];
  async function visit(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), child);
      else output.push(child.split(path.sep).join("/"));
    }
  }
  await visit(root);
  return output.sort();
}

test("Kernel Module 只在 Sandbox 构建，完整校验发布 Artifact 并支持并发", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cautest-v2-module-"));
  const project = path.join(temporary, "project");
  const kernelA = path.join(temporary, "kernel-a");
  const kernelB = path.join(temporary, "kernel-b");
  await Promise.all([mkdir(path.join(project, "module"), { recursive: true }), mkdir(path.join(project, "product"), { recursive: true }), mkdir(kernelA), mkdir(kernelB)]);
  await Promise.all([
    writeFile(path.join(project, "module/Makefile"), "obj-m += driver.o\n"),
    writeFile(path.join(project, "module/driver.c"), "int driver_symbol;\n"),
    writeFile(path.join(project, "product/product.c"), "int product_symbol;\n"),
    writeFile(path.join(kernelA, ".config"), "CONFIG_FAKE_A=y\n"),
    writeFile(path.join(kernelB, ".config"), "CONFIG_FAKE_B=y\n"),
  ]);
  const fakeMake = path.join(temporary, "fake-make");
  await cp(fixture, fakeMake);
  await chmod(fakeMake, 0o755);
  const module = { name: "driver", sourceDir: "module", sandboxRoot: ".", output: "driver.ko", make: fakeMake, makeVariables: { CC: "cc" } };
  const sourceBefore = await names(project);
  const base = { module, configDir: project, cacheDir: path.join(project, ".cautest/cache/modules"), workDir: path.join(project, ".cautest/work/modules"), signal: new AbortController().signal };
  const first = await buildIsolatedKernelModule({ ...base, kernelOutput: kernelA, arch: "um" });
  assert.equal(first.cacheHit, false);
  assert.equal(await readFile(first.module, "utf8").then((value) => value.includes("M=")), true);
  assert.equal((await readFile(first.symbols, "utf8")).includes("driver_symbol"), true);
  assert.deepEqual(await names(project), [...sourceBefore, ".cautest/cache/modules/" + first.cacheKey + "/Module.symvers", ".cautest/cache/modules/" + first.cacheKey + "/driver.ko", ".cautest/cache/modules/" + first.cacheKey + "/manifest.json", ".cautest/cache/modules/" + first.cacheKey + "/modules.order"].sort());
  assert.deepEqual(await names(path.join(project, "module")), ["Makefile", "driver.c"]);
  assert.deepEqual(await names(path.join(project, "product")), ["product.c"]);

  const hit = await buildIsolatedKernelModule({ ...base, kernelOutput: kernelA, arch: "um" });
  assert.equal(hit.cacheHit, true);
  await writeFile(hit.symbols, "corrupt\n");
  const repaired = await buildIsolatedKernelModule({ ...base, kernelOutput: kernelA, arch: "um" });
  assert.equal(repaired.cacheHit, false);
  assert.equal((await readFile(repaired.symbols, "utf8")).includes("driver_symbol"), true);

  const covered = await buildIsolatedKernelModule({ ...base, module: { ...module, makeVariables: { CC: "cc", CAUTEST_TEST_COVERAGE: 1 } }, kernelOutput: kernelA, arch: "um" });
  assert.equal(covered.coverageNotes.length, 1);
  assert.equal(covered.coverageSources.length, 1);
  assert.equal(await readFile(covered.coverageNotes[0], "utf8"), "gcov notes\n");
  await writeFile(covered.coverageNotes[0], "corrupt\n");
  const repairedCoverage = await buildIsolatedKernelModule({ ...base, module: { ...module, makeVariables: { CC: "cc", CAUTEST_TEST_COVERAGE: 1 } }, kernelOutput: kernelA, arch: "um" });
  assert.equal(repairedCoverage.cacheHit, false);
  assert.equal(await readFile(repairedCoverage.coverageNotes[0], "utf8"), "gcov notes\n");

  const [archA, archB] = await Promise.all([
    buildIsolatedKernelModule({ ...base, kernelOutput: kernelA, arch: "x86" }),
    buildIsolatedKernelModule({ ...base, kernelOutput: kernelB, arch: "arm64" }),
  ]);
  assert.notEqual(archA.cacheKey, archB.cacheKey);
  assert.deepEqual(await names(path.join(project, "module")), ["Makefile", "driver.c"]);
  assert.deepEqual(await names(path.join(project, "product")), ["product.c"]);
});
