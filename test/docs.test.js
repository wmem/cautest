import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);

async function markdownFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(child);
  }
  return output;
}

test("Project Docs V2 入口完整且本地链接有效", async () => {
  const files = [path.join(root, "README.md"), ...await markdownFiles(path.join(root, "docs")), ...await markdownFiles(path.join(root, "usage"))];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1];
      if (target.startsWith("#") || /^[a-z]+:/u.test(target)) continue;
      await assert.doesNotReject(access(path.resolve(path.dirname(file), target.split("#", 1)[0])), `${path.relative(root, file)} -> ${target}`);
    }
  }
  const index = await readFile(path.join(root, "docs/index.md"), "utf8");
  for (const entry of ["configuration.md", "architecture.md", "protocol-ctp3.md", "testing.md", "results.md"]) assert.match(index, new RegExp(entry.replace(".", "\\."), "u"));
  const driverUnit = await readFile(path.join(root, "usage/linux-driver/unit.md"), "utf8");
  assert.match(driverUnit, /不要求测试作者手写/u);
  assert.match(driverUnit, /kernelCTestJobFactory/u);
});

test("V1 审计的 API、测试、Example 和文档均有明确迁移结论", async () => {
  const inventory = JSON.parse(await readFile(path.join(root, "migration/v1-inventory.json"), "utf8"));
  assert.equal(inventory.items.length, 244);
  assert.deepEqual([...new Set(inventory.items.map((item) => item.status))].sort(), ["implemented", "intentional-change"]);
  assert.ok(inventory.items.filter((item) => item.kind === "document" && item.status === "implemented").length > 0);
});
