import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const exec = promisify(execFile);

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
  assert.equal(inventory.items.some((entry) => entry.status === "pending"), false);
  assert.ok(inventory.items.every((entry) => Array.isArray(entry.evidence) && entry.evidence.length > 0));
  const decisions = JSON.parse(await readFile(path.join(root, "migration/v1-decisions.json"), "utf8"));
  const approved = new Set(decisions.decisions.filter((entry) => entry.status === "approved").map((entry) => entry.id));
  assert.ok(inventory.items.filter((entry) => entry.status === "intentional-change").every((entry) => approved.has(entry.decision)));
  const audit = await exec(process.execPath, ["scripts/v1-audit.mjs"], { cwd: root });
  assert.match(audit.stdout, /行为证据审计有效/u);
});
