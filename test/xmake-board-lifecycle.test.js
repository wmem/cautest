import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {hashFile} from '../dist/cache/fingerprint.js';
import {loadManifest} from '../dist/adapters/xmake/load.js';
import {executeWorkflow, testJob, defineStep} from '../dist/config/index.js';
import {stepExecutor} from '../dist/workflow/step.js';
import {acquirePhysicalResource} from '../dist/integration/resource-lock.js';

test('late owned Board factory cannot flash after timeout and closes exactly once; borrowed remains borrowed',
  {skip: process.platform !== 'linux'}, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ct-board-late-'));
    try {
      const binary = path.join(root, 'firmware');
      await writeFile(binary, 'artifact');
      const buildContext = {projectRoot: root, plat: 'linux', arch: 'x86_64', mode: 'release', buildDir: path.join(root, 'build')};
      const receipt = {schemaVersion: 2, kind: 'cautest.artifact-receipt', target: 'firmware', context: buildContext,
        protocolBuildId: 'id', outputs: [{role: 'primary', path: binary, size: (await stat(binary)).size}]};
      for (const ownership of ['owned', 'borrowed']) {
        const log = path.join(root, ownership + '.log'), module = path.join(root, ownership + '.mjs');
        // Return the adapter only AFTER an observed cancellation, not after a guessed sleep.
        await writeFile(module, `import {appendFileSync} from 'node:fs';
const log = s => appendFileSync(${JSON.stringify(log)}, s + '\\n');
export async function create({signal}) {
  log('factory');
  await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, {once:true}));
  log('aborted=' + signal.aborted);
  return {flash(){log('flash');}, reset(){log('reset');return 'boot';},
    openTransport(){throw new Error('must not open');}, close(){log('close');}};
}`);
        const origin = {file: path.join(root, 'ctest.lua'), declaration: 1, includeChain: []};
        const resourceId = 'late-board:' + ownership + root;
        const manifest = {schemaVersion: 1, kind: 'cautest.xmake-manifest', projectRoot: root, xmake: '/unused/xmake',
          buildContext, project: {}, jobs: [{kind: 'mcu', id: 'component.late', target: 'firmware', board: 'board', origin}],
          boards: [{id: 'board', kind: 'board', resourceId, ownership, provider: {module, export: 'create'}, origin}],
          environments: [], sources: []};
        const file = path.join(root, ownership + '.json');
        await writeFile(file, JSON.stringify(manifest));
        const loaded = await loadManifest(file, {provider: {async build() {return receipt;}}});
        let settled;
        const executionSettled = new Promise(resolve => {settled = resolve;});
        const original = loaded.config.jobs[0];
        const workflow = original.workflow.map(step => step.kind !== 'mcuBoardStart' ? step : defineStep({
          kind: step.kind, name: step.name, phase: step.phase, details: step.details, timeoutMs: 1000,
          async execute(context) {try {return await stepExecutor(step)(context);} finally {settled();}},
        }));
        // Artifact validation and lock acquisition must not race an unrelated 80-ms deadline.
        const result = await executeWorkflow(testJob({...original, workflow}), {
          defaultStepTimeoutMs: 10000,
          project: {configDir: root, resultDir: root, workDir: root, cacheDir: root, generatedDir: root},
        });
        await executionSettled;
        assert.equal(result.status, 'ERROR');
        assert.equal(result.steps.find(s => s.kind === 'mcuBoardStart').error?.code, 'timeout_error', JSON.stringify(result));
        const lines = (await readFile(log, 'utf8')).trim().split('\n');
        assert.ok(lines.includes('factory') && lines.includes('aborted=true'));
        assert.ok(!lines.includes('flash') && !lines.includes('reset'));
        assert.equal(lines.filter(line => line === 'close').length, ownership === 'owned' ? 1 : 0);
        const lock = await acquirePhysicalResource({resourceId, signal: new AbortController().signal, timeoutMs: 2000});
        await lock.release();
      }
    } finally {await rm(root, {recursive: true, force: true});}
  });
