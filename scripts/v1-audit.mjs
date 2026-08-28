#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const outputPath = path.join(projectRoot, "migration/v1-inventory.json");
const arguments_ = process.argv.slice(2);
const mode = arguments_.includes("--write") ? "write" : "check";
const explicitRoot = arguments_.find((value) => !value.startsWith("--"));
const v1Root = path.resolve(projectRoot, explicitRoot ?? process.env.CAUTEST_V1_DIR ?? "../../v1");

const evidenceByArea = Object.freeze({
  "public-api": ["test/types/config.mts", "test/factory.test.js", "test/workflow.test.js"],
  "workflow-results": ["test/workflow.test.js", "test/reporters.test.js"],
  "c-runtime": ["scripts/test-c-runtime.sh"],
  "ctp3-session": ["test/protocol.test.js", "test/session.test.js"],
  "system-workflow": ["test/system.test.js", "test/system-steps.test.js", "test/script-test.test.js"],
  "native-cache": ["test/native.test.js", "test/cache.test.js"],
  "kernel-uml": ["test/kernel.test.js", "test/kernel-build.test.js", "test/kernel-module.test.js", "test/uml.test.js"],
  "driver-probe": ["test/driver.test.js", "test/kernel-module.test.js"],
  mcu: ["test/mcu.test.js"],
  "cli-report-package": ["test/cli.test.js", "test/reporters.test.js", "test/install.test.js", "test/version.test.js"],
  testing: ["test/parity.test.js", "docs/testing.md"],
  architecture: ["docs/architecture.md", "test/docs.test.js"],
  "capabilities-specifications": ["migration/v1-gap-remediation.md", "test/parity.test.js"],
  project: ["docs/index.md", "test/docs.test.js"],
  history: ["migration/v1-inventory.json", "migration/v1-decisions.json"],
  usage: ["docs/index.md", "test/docs.test.js"],
});

function decisionFor(entry) {
  if (entry.kind === "public-api") return "DEC-001-V2-PUBLIC-SURFACE";
  if (entry.kind === "test-file") return "DEC-002-CONSOLIDATED-TESTS";
  if (entry.kind === "example") return "DEC-004-EXAMPLE-CONSOLIDATION";
  return "DEC-003-DOCUMENT-CONSOLIDATION";
}

function areaFor(location) {
  for (const [prefix, area] of [
    ["tests/workflow/", "workflow-results"], ["tests/c-core/", "c-runtime"], ["tests/c-protocol/", "ctp3-session"],
    ["tests/js-protocol/", "ctp3-session"], ["tests/session/", "ctp3-session"], ["tests/steps/", "system-workflow"],
    ["tests/script-test/", "system-workflow"], ["tests/native/", "native-cache"], ["tests/cache/", "native-cache"],
    ["tests/kernel/", "kernel-uml"], ["tests/uml/", "kernel-uml"], ["tests/probe/", "driver-probe"],
    ["tests/mcu-sim/", "mcu"], ["tests/cli/", "cli-report-package"], ["tests/package/", "cli-report-package"],
    ["tests/version/", "cli-report-package"], ["examples/c-lib/", "native-cache"], ["examples/kernel-lib/", "kernel-uml"],
    ["examples/linux-driver/", "driver-probe"], ["examples/mcu-sim/", "mcu"], ["examples/system-script/", "system-workflow"],
    ["examples/all-in-one/", "cli-report-package"], ["docs/toolkit/usage/unit/", "native-cache"],
    ["docs/toolkit/usage/component/", "native-cache"], ["docs/toolkit/usage/kernel/", "kernel-uml"],
    ["docs/toolkit/usage/driver/", "driver-probe"], ["docs/toolkit/usage/linux-driver/", "driver-probe"],
    ["docs/toolkit/usage/mcu/", "mcu"], ["docs/toolkit/usage/system/", "system-workflow"],
    ["docs/toolkit/usage/reference/steps/", "system-workflow"], ["docs/test/", "testing"],
    ["docs/design/", "architecture"], ["docs/definition/", "capabilities-specifications"], ["docs/project/", "project"],
    ["docs/work/", "history"], ["docs/toolkit/", "usage"], ["docs/", "project"],
  ]) if (location.startsWith(prefix)) return area;
  return "unclassified";
}

function item(kind, key, area) {
  return { kind, key, area, status: "pending" };
}

function exportedSymbols(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from/gu)) {
    for (const candidate of match[1].split(",")) {
      const name = candidate.trim().split(/\s+as\s+/u)[1] ?? candidate.trim().split(/\s+as\s+/u)[0];
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

async function currentInventory() {
  const [commit, status, trackedOutput, publicEntry] = await Promise.all([
    exec("git", ["rev-parse", "HEAD"], { cwd: v1Root }).then((result) => result.stdout.trim()),
    exec("git", ["status", "--porcelain=v1"], { cwd: v1Root }).then((result) => result.stdout.trim().split("\n").filter(Boolean)),
    exec("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: v1Root }).then((result) => result.stdout),
    exec("git", ["show", "HEAD:packages/cautest-js/src/index.js"], { cwd: v1Root }).then((result) => result.stdout),
  ]);
  const tracked = trackedOutput.trim().split("\n").filter(Boolean);
  const allDocs = tracked.filter((value) => value.startsWith("docs/") && value.endsWith(".md"));
  const allExamples = tracked.filter((value) => value.startsWith("examples/"));
  const allTests = tracked.filter((value) => value.startsWith("tests/"));
  const api = exportedSymbols(publicEntry);
  const exampleGroups = [...new Set(allExamples.map((value) => value.split("/").slice(0, 2).join("/")))].sort();
  const items = [
    ...api.map((key) => item("public-api", key, "public-api")),
    ...allTests.map((key) => item("test-file", key, areaFor(key))),
    ...exampleGroups.map((key) => item("example", key, areaFor(`${key}/`))),
    ...allDocs.map((key) => item("document", key, areaFor(key))),
  ];
  return {
    schemaVersion: 1,
    source: { commit, worktree: status },
    baselineRuns: {
      default: { command: "npm test", status: "PASS", nodeTests: 88, cSuites: ["c-core", "c-protocol", "kernel", "probe"] },
      umlIntegration: { command: "npm run test:uml:integration", status: "PASS", cases: 2 },
      driverIntegration: { command: "npm run test:driver:integration", status: "FAIL", code: "build_error", reason: "cautest_probe.c 无法找到 cautest/probe.h" },
    },
    counts: { publicApi: api.length, testFiles: allTests.length, documents: allDocs.length, exampleFiles: allExamples.length, exampleGroups: exampleGroups.length },
    items,
  };
}

function keys(value) {
  return value.items.map(({ kind, key }) => `${kind}:${key}`).sort();
}

const current = await currentInventory();
if (mode === "write") {
  try {
    const recorded = JSON.parse(await readFile(outputPath, "utf8"));
    const dispositions = new Map(recorded.items.map((entry) => [`${entry.kind}:${entry.key}`, { status: entry.status, ...(entry.note ? { note: entry.note } : {}) }]));
    current.items = current.items.map((entry) => {
      const disposition = dispositions.get(`${entry.kind}:${entry.key}`) ?? { status: "pending" };
      return {
        ...entry,
        ...disposition,
        evidence: evidenceByArea[entry.area] ?? [],
        ...(disposition.status === "intentional-change" ? { decision: decisionFor(entry) } : {}),
      };
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(current, null, 2)}\n`);
  process.stdout.write(`已写入 ${outputPath}\n`);
} else {
  const recorded = JSON.parse(await readFile(outputPath, "utf8"));
  if (recorded.source.commit !== current.source.commit) throw new Error(`V1 Commit 已变化: recorded=${recorded.source.commit}, current=${current.source.commit}`);
  if (JSON.stringify(keys(recorded)) !== JSON.stringify(keys(current))) throw new Error("V1 公共 API、测试、Example 或文档清单已变化；请重新审计");
  const unresolved = recorded.items.filter((entry) => entry.area === "unclassified");
  if (unresolved.length > 0) throw new Error(`V1 存在未分类条目: ${unresolved.map((entry) => entry.key).join(", ")}`);
  const pending = recorded.items.filter((entry) => !["implemented", "intentional-change", "blocked"].includes(entry.status));
  if (pending.length > 0) throw new Error(`V1 存在未处理条目: ${pending.map((entry) => entry.key).join(", ")}`);
  const decisionsDocument = JSON.parse(await readFile(path.join(projectRoot, "migration/v1-decisions.json"), "utf8"));
  const decisions = new Map(decisionsDocument.decisions.map((entry) => [entry.id, entry]));
  const missingEvidence = [];
  for (const entry of recorded.items) {
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) { missingEvidence.push(`${entry.kind}:${entry.key}:无 evidence`); continue; }
    for (const evidence of entry.evidence) {
      try { await readFile(path.join(projectRoot, evidence)); }
      catch (error) {
        if (error.code === "EISDIR") continue;
        missingEvidence.push(`${entry.kind}:${entry.key}:${evidence}`);
      }
    }
    if (entry.status === "implemented" && !entry.evidence.some((value) => value.startsWith("test/") || value.startsWith("scripts/test-"))) missingEvidence.push(`${entry.kind}:${entry.key}:未关联行为测试`);
    if (entry.status === "intentional-change") {
      const decision = decisions.get(entry.decision);
      if (decision?.status !== "approved" || !Array.isArray(decision.evidence) || decision.evidence.length === 0) missingEvidence.push(`${entry.kind}:${entry.key}:决策未批准`);
    }
  }
  if (missingEvidence.length > 0) throw new Error(`V1 审计证据无效:\n${missingEvidence.slice(0, 20).join("\n")}`);
  process.stdout.write(`V1 行为证据审计有效: ${recorded.items.length} items, ${decisions.size} approved decisions\n`);
}
