import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);

async function markdownFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".cautest", "dist", "node_modules", "release"].includes(entry.name)) continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(child);
  }
  return output;
}

async function assertLocalLinks(file) {
  const contents = await readFile(file, "utf8");
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (target.startsWith("#") || /^[a-z]+:/u.test(target)) continue;
    await assert.doesNotReject(
      access(path.resolve(path.dirname(file), target.split("#", 1)[0])),
      `${path.relative(root, file)} -> ${target}`,
    );
  }
}

test("除根 README 外所有 Markdown 都在 docs 下且本地链接有效", async () => {
  const files = await markdownFiles(root);
  const outside = files
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => file !== "README.md" && !file.startsWith("docs/"));
  assert.deepEqual(outside, []);
  await Promise.all(files.map(assertLocalLinks));
});

test("Usage 提供按需入口并绑定完整可执行示例", async () => {
  const usageIndex = await readFile(path.join(root, "docs/usage/index.md"), "utf8");
  for (const command of ["doctor", "list", "plan", "run"]) assert.match(usageIndex, new RegExp(`\\b${command}\\b`, "u"));
  for (const entry of [
    "native-c.md",
    "kernel-uml.md",
    "linux-driver-unit.md",
    "linux-driver-abi.md",
    "mcu-simulated.md",
    "system-script.md",
    "workflow.md",
    "write-c-tests.md",
    "troubleshooting.md",
  ]) assert.match(usageIndex, new RegExp(entry.replace(".", "\\."), "u"));

  const scenarios = [
    ["native-c.md", "c-lib"],
    ["kernel-uml.md", "kernel-lib"],
    ["linux-driver-unit.md", "linux-driver-unit"],
    ["linux-driver-abi.md", "linux-driver"],
    ["mcu-simulated.md", "mcu-sim"],
    ["system-script.md", "system-script"],
    ["workflow.md", "workflow"],
  ];
  for (const [document, example] of scenarios) {
    const contents = await readFile(path.join(root, `docs/usage/${document}`), "utf8");
    const config = (await readFile(path.join(root, `examples/${example}/cautest.config.mjs`), "utf8")).trim();
    assert.ok(contents.includes(config), `${document} 必须展示 examples/${example} 的完整配置`);
    for (const command of ["doctor", "list", "plan", "run"]) assert.match(contents, new RegExp(`\\b${command}\\b`, "u"), `${document}: ${command}`);
  }

  for (const document of ["kernel-uml.md", "linux-driver-unit.md", "linux-driver-abi.md", "troubleshooting.md"]) {
    const contents = await readFile(path.join(root, `docs/usage/${document}`), "utf8");
    for (const field of ["kernel.timeoutMs", "busybox.timeoutMs", "--run-timeout", "C Test Run"]) assert.match(contents, new RegExp(field.replace(".", "\\."), "u"), `${document}: ${field}`);
  }
});

test("开发者索引覆盖 Project Docs 核心阅读路径", async () => {
  const index = await readFile(path.join(root, "docs/index.md"), "utf8");
  for (const entry of [
    "context.md",
    "capabilities/native.md",
    "specifications/configuration.md",
    "specifications/c-test-api.md",
    "architecture/overview.md",
    "tests/testing.md",
  ]) assert.match(index, new RegExp(entry.replaceAll(".", "\\."), "u"));
});

test("V1 审计的 API、测试、Example 和文档均有明确迁移结论", async () => {
  const inventory = JSON.parse(await readFile(path.join(root, "migration/v1-inventory.json"), "utf8"));
  assert.equal(inventory.items.length, 244);
  assert.deepEqual([...new Set(inventory.items.map((item) => item.status))].sort(), ["implemented", "intentional-change"]);
  assert.ok(inventory.items.filter((item) => item.kind === "document" && item.status === "implemented").length > 0);
});
