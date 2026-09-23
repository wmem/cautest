import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile, writeFile, rm} from 'node:fs/promises';
import {driverAbiCTestJob, kernelCTestJob, umlKernelEnvironment, testConfig, executeRun, writeRunDirectory} from '../../dist/config/index.js';

/** Same product and C cases through the legacy compiler helpers, not an Adapter clone. */
export async function runUmlParity({root, passedRun}) {
  const source = await readFile(path.join(root, 'product/kernel/math_test.c'), 'utf8');
  const cases = source.match(/CAUTEST_CASE\(add\)[\s\S]*?CAUTEST_SUITE\(kernel_math[^\n]+/);
  assert.ok(cases, 'Shared C case fixture must be present');
  const generated = path.join(root, 'legacy-math-test.c');
  // Legacy kernelCTestJob owns Registry/module entry generation. Keep exactly the
  // same case/suite definitions and remove only the product-owned module glue.
  await writeFile(generated, '#include <cautest/cautest.h>\n' + cases[0] + '\n');
  const environment = umlKernelEnvironment({
    kernel: {sourceDir: process.env.KERNEL_SRC, configFragments: ['uml-host.config'], arch: 'um', jobs: 4, timeoutMs: 20 * 60_000},
    busybox: {sourceDir: process.env.BUSYBOX_SRC, static: true, jobs: 4, timeoutMs: 10 * 60_000},
    moduleDefaults: {timeoutMs: 5 * 60_000}, rootfs: {timeoutMs: 60_000},
    machine: {memory: '256M', readyTimeoutMs: 30_000, startTimeoutMs: 40_000},
  });
  const config = testConfig({jobs: [
    driverAbiCTestJob({id: 'legacy.driver.abi', environment,
      drivers: [{name: 'cautest_echo', sourceDir: 'product/driver', sandboxRoot: 'product', output: 'cautest_echo.ko'}],
      guest: {tests: ['product/guest/driver_test.c'], headers: ['product/include/echo_abi.h'], suites: ['driver_abi']}, timeoutMs: 5 * 60_000}),
    kernelCTestJob({id: 'legacy.kernel.math', environment, tests: ['legacy-math-test.c'], suites: ['kernel_math'], timeoutMs: 5 * 60_000}),
  ]});
  const resultRoot = path.join(root, 'legacy-parity');
  try {
    const run = await executeRun(config, {configDir: root, resultDir: resultRoot,
      output(channel, text) {process.stderr.write(`[legacy:${channel}] ${text}`);}});
    const resultDir = await writeRunDirectory(run, resultRoot);
    await writeFile(path.join(root, 'legacy-parity-summary.json'), JSON.stringify({status: run.status, resultDir}, null, 2) + '\n');
    assert.equal(run.status, 'SUCCESS', `Legacy execution failed: ${resultDir}`);
    const flatten = job => job.groups.flatMap(group => group.cases.map(item => [group.name, item.name, item.status]));
    for (const [legacyId, adapterId] of [['legacy.driver.abi', 'integration.driver.abi'], ['legacy.kernel.math', 'unit.kernel.math']]) {
      const job = run.jobs.find(item => item.jobId === legacyId), adapter = passedRun.jobs.find(item => item.jobId === adapterId);
      assert.deepEqual(flatten(job), flatten(adapter), 'Changing build ownership must not change CTP case results');
      assert.ok(job.resources.some(item => item.kind === 'uml' && item.state === 'closed'));
      assert.ok(job.cleanup.every(item => item.status === 'SUCCESS'));
      for (const kind of ['kernelBuild', 'busyboxBuild']) assert.ok(job.steps.find(item => item.kind === kind).diagnostics.some(item => item.code === 'cache_hit'));
      const consoleLog = job.artifacts.find(item => item.kind === 'log' && item.name.endsWith('-console'));
      assert.match(await readFile(consoleLog.path, 'utf8'), /Linux version /);
    }
    return {status: 'PASS', jobs: 2, cases: 5, resultDir, kernelAndBusyboxCacheReused: true, sameCtpCaseResults: true};
  } finally {await rm(generated, {force: true});}
}
