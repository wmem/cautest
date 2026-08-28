import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);

test("V1 迁移清单锁定实现、测试、Example 和文档基线", async () => {
  const inventory = JSON.parse(await readFile(path.join(root, "migration/v1-inventory.json"), "utf8"));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.counts.documents, 89);
  assert.equal(inventory.counts.exampleFiles, 22);
  assert.equal(inventory.counts.exampleGroups, 6);
  assert.equal(inventory.baselineRuns.default.nodeTests, 88);
  assert.equal(inventory.baselineRuns.default.status, "PASS");
  assert.equal(inventory.baselineRuns.umlIntegration.status, "PASS");
  assert.equal(inventory.baselineRuns.driverIntegration.status, "FAIL");
  assert.match(inventory.baselineRuns.driverIntegration.reason, /probe\.h/u);
  const identities = inventory.items.map((entry) => `${entry.kind}:${entry.key}`);
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(inventory.items.some((entry) => entry.area === "unclassified"), false);
  assert.equal(inventory.items.every((entry) => ["pending", "implemented", "intentional-change", "blocked"].includes(entry.status)), true);
});
