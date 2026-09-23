import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {cp, mkdir, mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import {runCommand} from '../../dist/runtime/process.js';
import {inspectUmlPrerequisites, reportBlockedUml} from './uml-support.mjs';

const command = 'npm run test:xmake:uml';
const prerequisites = await inspectUmlPrerequisites();
if (!prerequisites.ok) reportBlockedUml(prerequisites, command);
else if (!process.env.CAUTEST_XMAKE) reportBlockedUml({problems: [{name: 'CAUTEST_XMAKE', reason: 'Set a real Xmake executable; no simulator fallback is allowed'}]}, command);
else if (process.platform !== 'linux' || process.arch !== 'x64') reportBlockedUml({problems: [{name: 'host', reason: 'The current UML acceptance requires Linux x86_64'}]}, command);
else {
  const budget = Number(process.env.CAUTEST_UML_TIMEOUT_MS ?? 55 * 60_000);
  assert.ok(Number.isSafeInteger(budget) && budget > 0, 'CAUTEST_UML_TIMEOUT_MS must be a positive integer');
  const deadline = Date.now() + budget;
  const kit = fileURLToPath(new URL('../..', import.meta.url));
  const workspace = process.env.CAUTEST_UML_ACCEPTANCE_DIR ? path.resolve(process.env.CAUTEST_UML_ACCEPTANCE_DIR) : await mkdtemp(path.join(tmpdir(), 'cautest-xmake-uml-'));
  await mkdir(workspace, {recursive: true});
  const root = await mkdtemp(path.join(workspace, 'project-'));
  await cp(path.join(kit, 'examples/xmake/kernel-driver'), root, {recursive: true});
  await mkdir(path.join(root, 'tools')); await symlink(kit, path.join(root, 'tools/cautest'), 'dir');
  const environment = {...process.env, XMAKE_ROOT: 'y', XMAKE_COLORTERM: 'nocolor', KERNEL_SRC: prerequisites.kernelSource, BUSYBOX_SRC: prerequisites.busyboxSource};
  const records = [], runs = [];
  const cancelled = new AbortController();
  const interrupt = () => cancelled.abort(new Error('UML acceptance interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  await writeFile(path.join(root, 'acceptance-pending.json'), JSON.stringify({command, root, started: new Date().toISOString(), deadline: new Date(deadline).toISOString()}, null, 2));
  process.stderr.write(`[uml-acceptance] project: ${root}\n`);
  async function xmake(label, args, timeoutMs = 30_000) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, 'UML acceptance time budget exhausted');
    const started = Date.now();
    const out = createWriteStream(path.join(root, `${label}-stdout.log`));
    const err = createWriteStream(path.join(root, `${label}-stderr.log`));
    process.stderr.write(`[uml-acceptance] ${label}: starting\n`);
    const heartbeat = setInterval(() => process.stderr.write(`[uml-acceptance] ${label}: ${Math.floor((Date.now() - started) / 1000)}s; logs in ${root}\n`), 30_000);
    try {
      const result = await runCommand({program: process.env.CAUTEST_XMAKE, args, cwd: root, env: environment,
        signal: AbortSignal.any([cancelled.signal, AbortSignal.timeout(Math.min(timeoutMs, remaining))]),
        onOutput(channel, text) {(channel === 'stdout' ? out : err).write(text);}});
      records.push({label, args, exitCode: result.exitCode, durationMs: Date.now() - started});
      process.stderr.write(`[uml-acceptance] ${label}: exit ${result.exitCode}\n`);
      return {...result, status: result.exitCode};
    } catch (error) {
      records.push({label, args, error: String(error), durationMs: Date.now() - started});
      throw error;
    } finally {
      clearInterval(heartbeat); out.end(); err.end(); await Promise.all([finished(out), finished(err)]);
      await writeFile(path.join(root, 'commands.json'), JSON.stringify(records, null, 2) + '\n');
    }
  }
  try {
    for (const action of ['list', 'plan']) {
      const result = await xmake(action, ['ct', `--${action}`, '--json']);
      assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).length, 2);
      await writeFile(path.join(root, `${action}.json`), result.stdout);
    }
    const doctor = await xmake('doctor', ['ct', '--doctor', '--json']);
    await writeFile(path.join(root, 'doctor.json'), doctor.stdout || doctor.stderr);
    if (doctor.status !== 0) {
      const report = {schemaVersion: 1, status: 'BLOCKED', code: 'uml_environment_not_ready', command, root,
        doctor: doctor.stdout ? JSON.parse(doctor.stdout) : doctor.stderr, records};
      await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2)); process.exitCode = 77;
    } else {
      let passedRun;
      for (const label of ['cold', 'cache-hit']) {
        const result = await xmake(label, ['ct', '--json', '--reporter=json,junit'], 35 * 60_000);
        assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
        const summary = JSON.parse(result.stdout), run = JSON.parse(await readFile(summary.resultPath, 'utf8'));
        assert.equal(run.status, 'SUCCESS'); assert.equal(run.jobs.length, 2);
        for (const job of run.jobs) {
          const cases = job.groups.flatMap(group => group.cases);
          assert.equal(cases.length, job.jobId === 'integration.driver.abi' ? 3 : 2);
          assert.ok(cases.every(item => item.status === 'PASS'));
          assert.ok(job.resources.some(item => item.kind === 'uml' && item.state === 'closed'));
          assert.ok(job.cleanup.every(item => item.status === 'SUCCESS'));
          const log = job.artifacts.find(item => item.kind === 'log' && item.name.endsWith('-console'));
          assert.ok(log); assert.match(await readFile(log.path, 'utf8'), /Linux version /);
        }
        if (label === 'cold') for (const kind of ['kernelBuild', 'busyboxBuild']) {
          assert.ok(run.jobs[0].steps.find(step => step.kind === kind)?.diagnostics.some(item => item.code === 'cache_miss'), `Fresh ${kind} must actually build`);
        }
        if (label === 'cache-hit') for (const job of run.jobs) for (const kind of ['kernelBuild', 'busyboxBuild']) {
          assert.ok(job.steps.find(step => step.kind === kind)?.diagnostics.some(item => item.code === 'cache_hit'), `${job.jobId}/${kind} must hit a byte-validated cache`);
        }
        runs.push({label, ...summary}); passedRun = run;
      }
      const matrix = process.env.CAUTEST_UML_MATRIX === '0' ? {status: 'NOT_RUN', reason: 'Explicit smoke-only request'}
        : await (await import('./xmake-uml-matrix.mjs')).runUmlMatrix({root, xmake, passedRun});
      const report = {schemaVersion: 1, status: 'SUCCESS', command, root, runs, matrix, records};
      await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    const report = {schemaVersion: 1, status: 'ERROR', command, root, message: error instanceof Error ? error.message : String(error), runs, records};
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
    console.error(JSON.stringify(report, null, 2)); process.exitCode = 2;
  } finally {process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);}
}
