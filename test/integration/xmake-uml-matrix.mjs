import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {testJob, defineStep, executeWorkflow} from '../../dist/config/index.js';
import {startUml, collectUml, runUmlEndpoint, buildRootfs} from '../../dist/uml/runtime.js';

const casesOf = job => job.groups.flatMap(group => group.cases);
async function consoleOf(job) {
  const log = job.artifacts.find(item => item.kind === 'log' && item.name.endsWith('-console'));
  assert.ok(log, 'Real UML must retain its console');
  return await readFile(log.path, 'utf8');
}
function assertClosed(job) {
  assert.ok(job.resources.some(item => item.kind === 'uml' && item.state === 'closed'), `${job.jobId}: UML must be closed`);
  assert.ok(job.cleanup.every(item => item.status === 'SUCCESS'), JSON.stringify(job.cleanup));
}
async function liveGroup(pgid) {
  const live = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === pgid && fields[0] !== 'Z') live.push(Number(entry));
    } catch { /* process exited between directory enumeration and stat */ }
  }
  return live;
}
async function assertGroupStopped(pid) {
  assert.ok(pid > 0, 'Must have started a real UML OS process');
  let live;
  for (let attempt = 0; attempt < 100; attempt++) {
    live = await liveGroup(pid); if (live.length === 0) return;
    await delay(20);
  }
  assert.deepEqual(live, [], 'No live member of the owned UML process group may remain');
}

/** Real kernel/image only. None of these scenarios substitutes an Agent/VM emulator. */
async function lifecycleMatrix(root, driver, records) {
  const saved = driver.resources.find(item => item.kind === 'uml').metadata;
  const guest = driver.artifacts.find(item => item.kind === 'guest-program');
  const baseImage = {kernelPath: saved.kernelPath, rootfsPath: saved.rootfsPath, buildId: saved.buildId,
    cacheHit: true, endpoints: new Map([['driver-guest', {type: 'process', buildId: guest.buildId}]])};
  for (const mode of ['ready-timeout', 'cancel', 'wrong-catalog', 'wrong-guest-id']) {
    const resultDir = path.join(root, 'lifecycle', mode); await mkdir(resultDir, {recursive: true});
    const noAgent = mode === 'ready-timeout' || mode === 'cancel';
    const environment = {kernel: {sourceDir: 'not-used-by-runtime'}, busybox: {sourceDir: 'not-used-by-runtime'},
      machine: {readyTimeoutMs: mode === 'ready-timeout' ? 1200 : 10000,
        ...(noAgent ? {kernelArgs: ['rdinit=/bin/sh']} : {})}};
    const image = {...baseImage, ...(mode === 'wrong-catalog' ? {buildId: 'deliberately-wrong-catalog'} : {})};
    const controller = new AbortController();
    let pid;
    const start = defineStep({kind: 'umlStart', name: mode, phase: 'provision', timeoutMs: 15000,
      async execute(context) {try {await startUml(mode, image, environment, context);}
        finally {pid = context.state.get(`uml:${mode}`)?.child.pid;}}});
    const run = defineStep({kind: 'cTestRun', name: mode, phase: 'run', timeoutMs: 10000,
      async execute(context) {await runUmlEndpoint(mode, 'driver-guest', image,
        {expectedBuildId: 'deliberately-wrong-guest'}, context);}});
    const collect = defineStep({kind: 'umlLogs', name: mode, phase: 'collect', runWhen: 'always',
      async execute(context) {return {diagnostics: await collectUml(mode, context)};}});
    const started = Date.now();
    const result = await executeWorkflow(testJob({id: `integration.real-uml.${mode}`, level: 'integration',
      workflow: [start, ...(mode === 'wrong-guest-id' ? [run] : []), collect]}), {
      signal: controller.signal, project: {configDir: root, resultDir},
      onOutput(event) {if (mode === 'cancel' && event.text.includes('Linux version ')) controller.abort(new Error('real UML acceptance cancellation'));},
    });
    const resultPath = path.join(resultDir, 'job-result.json'); await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n');
    assert.equal(result.status, 'ERROR', JSON.stringify(result)); assertClosed(result);
    assert.match(await consoleOf(result), /Linux version /, 'Must execute the real supplied kernel');
    const errors = JSON.stringify(result.errors);
    if (mode === 'ready-timeout') assert.match(errors, /timeout_error/);
    if (mode === 'cancel') assert.match(errors, /real UML acceptance cancellation/);
    if (mode === 'wrong-catalog') assert.match(errors, /Build ID/);
    if (mode === 'wrong-guest-id') assert.match(errors, /build.*id|Build ID|BUILD_ID/i);
    await assertGroupStopped(pid);
    records.push({label: mode, status: 'PASS', expectedStatus: 'ERROR', pid, processGroupStopped: true,
      durationMs: Date.now() - started, resultPath});
  }
}

/** Exercise the exact cached image's integrity check, then boot the repaired image. */
async function rootfsIntegrity(root, driver, records) {
  const image = driver.artifacts.find(item => item.kind === 'uml-image');
  const kernel = driver.artifacts.find(item => item.kind === 'uml-kernel');
  const busybox = driver.artifacts.find(item => item.kind === 'busybox');
  const guest = driver.artifacts.find(item => item.kind === 'guest-program');
  const modules = driver.artifacts.filter(item => item.kind === 'kernel-module').map(item => ({name: item.name,
    module: item.path, symbols: item.metadata.symbols, modulesOrder: item.metadata.modulesOrder,
    cacheKey: item.fingerprint, cacheHit: true}));
  const context = {job: {id: driver.jobId, env: {}}, signal: new AbortController().signal, state: new Map(), output() {},
    project: {configDir: root, cacheDir: path.join(root, '.cautest/cache'), workDir: path.join(root, '.cautest/work'), resultDir: path.join(root, 'integrity')}};
  const options = {name: image.name, environment: {kernel: {sourceDir: 'unused'}, busybox: {sourceDir: 'unused'}},
    kernelOutput: kernel.metadata.outputDir, busybox: {path: busybox.path, buildId: busybox.buildId, cacheHit: true}, modules,
    programs: [{name: guest.name, path: guest.path, buildId: guest.buildId, endpoint: guest.metadata.endpoint,
      installPath: `/opt/cautest/bin/${guest.name}`, cacheHit: true}]};
  const cached = await buildRootfs(options, context);
  assert.equal(cached.buildId, image.buildId, 'This must be the exact real acceptance image, not a separate fixture');
  assert.equal(cached.cacheHit, true);
  const bytes = await readFile(cached.rootfsPath); bytes[0] ^= 1; await writeFile(cached.rootfsPath, bytes);
  const repaired = await buildRootfs(options, context); assert.equal(repaired.cacheHit, false); assert.equal(repaired.buildId, cached.buildId);
  assert.equal((await buildRootfs(options, context)).cacheHit, true);
  // lifecycleMatrix next boots this exact repaired file before any product rebuild.
  records.push({label: 'rootfs-same-size-corruption', status: 'PASS', rootfsPath: repaired.rootfsPath, buildId: repaired.buildId});
}

export async function runUmlMatrix({root, xmake, passedRun}) {
  const records = [];
  const driver = passedRun.jobs.find(job => job.jobId === 'integration.driver.abi');
  assert.ok(driver && driver.status === 'SUCCESS');
  await rootfsIntegrity(root, driver, records);
  await lifecycleMatrix(root, driver, records);
  const names = ['environment.mjs', 'product/driver/cautest_echo.c', 'product/guest/driver_test.c', 'product/kernel/math_test.c'];
  const original = new Map(await Promise.all(names.map(async name => [name, await readFile(path.join(root, name), 'utf8')])));
  const patch = async (name, from, to) => {
    const source = original.get(name); assert.ok(source.includes(from), `${name}: fixture anchor missing`);
    await writeFile(path.join(root, name), source.replace(from, to));
  };
  const restore = async () => {for (const [name, source] of original) await writeFile(path.join(root, name), source);};
  async function run(label, jobId, status, code) {
    const command = await xmake(label, ['ct', '--json', '--reporter=json,junit', ...(jobId ? [jobId] : [])], 10 * 60_000);
    assert.equal(command.status, code, `${label}: ${command.stdout}\n${command.stderr}`);
    const summary = JSON.parse(command.stdout), result = JSON.parse(await readFile(summary.resultPath, 'utf8'));
    assert.equal(result.status, status, JSON.stringify(result));
    records.push({label, status: 'PASS', expectedStatus: status, exitCode: code, resultPath: summary.resultPath});
    return result;
  }
  try {
    await patch('product/guest/driver_test.c', 'CAUTEST_EXPECT_EQ_INT(output, input);', 'CAUTEST_EXPECT_EQ_INT(output, input + 1);');
    let result = await run('guest-assertion-failure', 'integration.driver.abi', 'FAIL', 1);
    assertClosed(result.jobs[0]);
    assert.deepEqual(casesOf(result.jobs[0]).map(item => [item.name, item.status]), [['read_write', 'FAIL'], ['ioctl_value', 'PASS'], ['invalid_input', 'PASS']]);
    await restore();

    await writeFile(path.join(root, 'product/guest/driver_test.c'), original.get('product/guest/driver_test.c') + `
__attribute__((constructor)) static void acceptance_guest_exit(void) {
    static const char reason[] = "cautest acceptance: guest exit19\\n";
    (void)write(2, reason, sizeof(reason) - 1); _exit(19);
}
`);
    result = await run('guest-startup-failure', 'integration.driver.abi', 'ERROR', 2);
    assertClosed(result.jobs[0]); assert.match(await consoleOf(result.jobs[0]), /guest exit19/);
    assert.equal(result.jobs[0].steps.find(step => step.kind === 'cTestRun').status, 'ERROR');
    await restore();

    await patch('product/driver/cautest_echo.c', 'return misc_register(&echo_device);', 'pr_err("cautest acceptance: module init refused\\n"); return -EINVAL;');
    await patch('environment.mjs', 'readyTimeoutMs: 30_000', 'readyTimeoutMs: 5000');
    result = await run('module-init-failure', 'integration.driver.abi', 'ERROR', 2);
    assertClosed(result.jobs[0]); assert.match(await consoleOf(result.jobs[0]), /module init refused/);
    assert.equal(result.jobs[0].steps.find(step => step.kind === 'umlStart').status, 'ERROR');
    assert.equal(result.jobs[0].steps.find(step => step.kind === 'cTestRun').status, 'SKIPPED');
    await restore();

    await writeFile(path.join(root, 'product/driver/cautest_echo.c'), original.get('product/driver/cautest_echo.c') + '\n#error acceptance_driver_build_failure\n');
    result = await run('stale-module-after-build-failure', 'integration.driver.abi', 'ERROR', 2);
    assert.match(JSON.stringify(result), /acceptance_driver_build_failure/);
    assert.ok(!result.jobs[0].resources.some(item => item.kind === 'uml'));
    assert.equal(result.jobs[0].steps.find(step => step.kind === 'umlStart').status, 'SKIPPED');
    await restore();

    await patch('product/kernel/math_test.c', 'CAUTEST_EXPECT_EQ_INT(2 + 3, 5)', 'CAUTEST_EXPECT_EQ_INT(2 + 3, 6)');
    result = await run('kernel-case-failure', 'unit.kernel.math', 'FAIL', 1);
    assertClosed(result.jobs[0]);
    assert.deepEqual(casesOf(result.jobs[0]).map(item => [item.name, item.status]), [['add', 'FAIL'], ['boundary', 'PASS']]);
    await restore();

    result = await run('recovery', null, 'SUCCESS', 0);
    assert.equal(result.jobs.length, 2);
    for (const job of result.jobs) {assertClosed(job); assert.ok(casesOf(job).every(item => item.status === 'PASS'));}
    const recoveredDriver = result.jobs.find(job => job.jobId === 'integration.driver.abi');
    const busybox = recoveredDriver.artifacts.find(item => item.kind === 'busybox');
    const bytes = await readFile(busybox.path); bytes[bytes.length - 1] ^= 1; await writeFile(busybox.path, bytes);
    result = await run('busybox-corruption-recovery', 'integration.driver.abi', 'SUCCESS', 0);
    assertClosed(result.jobs[0]);
    assert.ok(result.jobs[0].steps.find(step => step.kind === 'busyboxBuild').diagnostics.some(item => item.code === 'cache_miss'));
    assert.ok(result.jobs[0].steps.find(step => step.kind === 'kernelBuild').diagnostics.some(item => item.code === 'cache_hit'));
  } finally {await restore();}
  for (const [name, source] of original) assert.equal(await readFile(path.join(root, name), 'utf8'), source);
  const result = {status: 'SUCCESS', scope: 'real UML kernel, modules, guest syscalls and process cleanup', records, sourceFilesRestored: true};
  await writeFile(path.join(root, 'matrix.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
