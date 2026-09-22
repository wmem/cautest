import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defineStep, selectJobs, testJob } from "../dist/config/index.js";
import { globMatcher } from "../dist/pattern/glob.js";
import { runCli } from "../dist/runtime/cli.js";

let executed = 0;
const step = defineStep({ kind: "selectionFixture", phase: "run", execute() { executed += 1; } });
const jobs = Object.freeze([
  testJob({ id: "unit.math", level: "unit", tags: ["native", "fast"], workflow: [step] }),
  testJob({ id: "component.queue", level: "component", tags: ["native", "slow"], workflow: [step] }),
  testJob({ id: "integration.spi", level: "integration", tags: ["mcu", "hardware", "spi"], workflow: [step] }),
  testJob({ id: "unit.disabled", level: "unit", tags: ["native", "fast"], enabled: false, workflow: [step] }),
  testJob({ id: "system.health", level: "system", tags: ["host"], workflow: [step] }),
]);
const ids = (selected) => selected.map((job) => job.id);

// Literal baseline implementation from runtime/cli.ts at 062044d.
function baseline(input) {
  const matchers = (input.selectors ?? []).map((selector) => globMatcher(selector));
  const levels = input.levels ?? [];
  const tags = input.tags ?? [];
  return jobs.filter((job) => (input.includeDisabled || job.enabled) && (matchers.length === 0 || matchers.some((match) => match(job.id))) && (levels.length === 0 || levels.includes(job.level)) && tags.every((tag) => job.tags.includes(tag)));
}

function subsets(values) {
  return Array.from({ length: 1 << values.length }, (_, mask) => values.filter((_, i) => (mask & (1 << i)) !== 0));
}

test("selection matches the baseline truth table across 8192 combinations", () => {
  const patterns = subsets(["unit.*", "component.*", "*.spi", "system.health"]);
  const levels = subsets(["unit", "component", "integration", "system"]);
  const tags = subsets(["native", "fast", "mcu", "hardware"]);
  let count = 0;
  for (const selectors of patterns) for (const selectedLevels of levels) for (const requiredTags of tags) for (const includeDisabled of [false, true]) {
    const input = { selectors, levels: selectedLevels, tags: requiredTags, includeDisabled };
    assert.deepEqual(ids(selectJobs(jobs, input)), ids(baseline(input)), JSON.stringify(input));
    count += 1;
  }
  assert.equal(count, 8192);
  assert.equal(executed, 0);
});

test("ID OR / level OR / tag AND and cross-dimension AND are independent", () => {
  assert.deepEqual(ids(selectJobs(jobs, { selectors: ["unit.*", "integration.*"] })), ["unit.math", "integration.spi"]);
  assert.deepEqual(ids(selectJobs(jobs, { levels: ["unit", "component"] })), ["unit.math", "component.queue"]);
  assert.deepEqual(ids(selectJobs(jobs, { tags: ["native", "fast"] })), ["unit.math"]);
  assert.deepEqual(ids(selectJobs(jobs, { selectors: ["*"], levels: ["unit", "component"], tags: ["native", "slow"] })), ["component.queue"]);
  assert.deepEqual(ids(selectJobs(jobs, { levels: ["integration"] })), ["integration.spi"]);
  assert.deepEqual(ids(selectJobs(jobs, { tags: ["missing"] })), []);
});

test("explicit IDs never enable disabled jobs, while inspection includes them", () => {
  assert.deepEqual(ids(selectJobs(jobs, { selectors: ["unit.disabled"] })), []);
  assert.deepEqual(ids(selectJobs(jobs, { selectors: ["unit.disabled"], includeDisabled: true })), ["unit.disabled"]);
});

test("selector preserves identity/order, does not mutate input, and deduplicates overlapping patterns", () => {
  const before = jobs.map((job) => JSON.stringify(job));
  const input = Object.freeze({ selectors: Object.freeze(["unit.*", "unit.math", "unit.*"]) });
  const result = selectJobs(jobs, input);
  assert.equal(result.length, 1);
  assert.equal(result[0], jobs[0]);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(jobs.map((job) => JSON.stringify(job)), before);
  assert.equal(executed, 0);
});

test("invalid options and categorical levels fail deterministically even for an empty registry", () => {
  for (const input of [null, [], { includeDisabled: 1 }, { tags: "native" }, { selectors: [1] }, { extra: true }]) {
    assert.throws(() => selectJobs([], input), { code: "config_error" });
  }
  for (const level of ["1", "integration,unit", "UNIT", ""]) {
    assert.throws(() => selectJobs([], { levels: [level] }), { code: "config_error", message: `--level 无效: ${level}` });
  }
  // Comma splitting belongs to the frontend, not the shared selection contract.
  assert.deepEqual(ids(selectJobs(jobs, { tags: ["native,fast"] })), []);
});

function io() {
  let stdout = "";
  let stderr = "";
  return { streams: { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } }, output: () => ({ stdout, stderr }) };
}

test("old JS list/plan/doctor remain side-effect free, including disabled jobs; run excludes them", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-select-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, "cautest.config.mjs");
  const marker = path.join(directory, "unexpected-build");
  await writeFile(config, `import { testConfig, testJob, defineStep } from ${JSON.stringify(new URL("../dist/config/index.js", import.meta.url).href)};
import { writeFile } from 'node:fs/promises';
const build = defineStep({ kind: 'selectionBuild', phase: 'build', async execute() { await writeFile(${JSON.stringify(marker)}, 'built'); } });
export default testConfig({ jobs: [testJob({ id: 'unit.off', level: 'unit', tags: ['native','fast'], enabled: false, workflow: [build] })] });\n`);
  for (const command of ["list", "plan", "doctor"]) {
    const stream = io();
    assert.equal(await runCli(["--config", config, command, "unit.*", "--tag", "native", "--tag", "fast", "--json"], stream.streams), 0, stream.output().stderr);
    if (command !== "doctor") assert.equal(JSON.parse(stream.output().stdout)[0].id, "unit.off");
    await assert.rejects(access(marker), { code: "ENOENT" });
  }
  const stream = io();
  assert.equal(await runCli(["--config", config, "run", "unit.off"], stream.streams), 4);
  await assert.rejects(access(marker), { code: "ENOENT" });
  await assert.rejects(access(path.join(directory, ".cautest/results")), { code: "ENOENT" });
});
