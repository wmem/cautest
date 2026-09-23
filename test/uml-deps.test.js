import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {doctorJobs} from '../dist/doctor/index.js';

const kit = fileURLToPath(new URL('..', import.meta.url));
const packages = ['flex', 'bison', 'bc', 'libelf-dev', 'libssl-dev', 'zlib1g-dev', 'cpio'];
function run(program, args, options = {}) {
  return spawnSync(program, args, {encoding: 'utf8', timeout: 20000, ...options});
}
test('offline dependency collector requests installed packages through an empty APT status and rejects incomplete bundles', {skip: process.platform !== 'linux'}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-deps-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bin = path.join(root, 'bin'), fixture = path.join(root, 'fixtures');
  await mkdir(bin); await mkdir(fixture);
  for (const name of packages) {
    const directory = path.join(root, name);
    await mkdir(path.join(directory, 'DEBIAN'), {recursive: true});
    await writeFile(path.join(directory, 'DEBIAN/control'), `Package: ${name}\nVersion: 1.0\nArchitecture: amd64\nMaintainer: Cautest <test@invalid>\nDescription: offline command-contract fixture only\n`);
    if (['flex', 'bison', 'bc', 'cpio'].includes(name)) {
      await mkdir(path.join(directory, 'usr/bin'), {recursive: true});
      await writeFile(path.join(directory, 'usr/bin', name), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    }
    const built = run('dpkg-deb', ['--build', directory, path.join(fixture, name + '.deb')]);
    assert.equal(built.status, 0, built.stderr);
  }
  // This fake performs no APT network request; real dpkg-deb/tar process fixtures.
  await writeFile(path.join(bin, 'apt-get'), `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';const a=process.argv.slice(2);if(!a.includes('--download-only')||!a.includes('install'))process.exit(80);const status=a.find(v=>v.startsWith('Dir::State::status=')).split('=').slice(1).join('=');if(fs.statSync(status).size!==0)process.exit(81);const out=a.find(v=>v.startsWith('Dir::Cache::archives=')).split('=').slice(1).join('=');if(!a.includes('--simulate'))for(const f of fs.readdirSync(process.env.CT_FIXTURE)){if(process.env.CT_OMIT==='flex'&&f==='flex.deb')continue;fs.copyFileSync(path.join(process.env.CT_FIXTURE,f),path.join(out,f));}\n`, {mode: 0o755});
  // Node treats extensionless entries as CommonJS unless this package declares ESM.
  await writeFile(path.join(bin, 'package.json'), '{"type":"module"}');
  const env = {...process.env, PATH: bin + ':' + process.env.PATH, CT_FIXTURE: fixture};
  const script = path.join(kit, 'scripts/collect-uml-deps.sh');
  const complete = path.join(root, 'complete');
  let r = run('bash', [script, '--output', complete], {env});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok((await stat(complete + '.tar.gz')).size > 0);
  assert.equal((await readFile(path.join(complete, 'packages.tsv'), 'utf8')).trim().split('\n').length, 7);
  r = run('bash', [script, '--output', complete], {env});
  assert.equal(r.status, 2); assert.match(r.stderr, /Refusing to overwrite/);
  const incomplete = path.join(root, 'incomplete');
  r = run('bash', [script, '--output', incomplete], {env: {...env, CT_OMIT: 'flex'}});
  assert.equal(r.status, 1); assert.match(r.stderr, /Missing requested package: flex/);
  await assert.rejects(stat(incomplete + '.tar.gz'));
  const dry = path.join(root, 'dry');
  r = run('bash', [script, '--output', dry, '--dry-run'], {env});
  assert.equal(r.status, 0, r.stderr); await assert.rejects(stat(dry + '.tar.gz'));
});

test('Linux doctor probes bc arithmetic rather than a GNU-only version flag and rejects incorrect calculators', {skip: process.platform !== 'linux'}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-bc-doctor-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bin = path.join(root, 'bin'), kernel = path.join(root, 'linux');
  await mkdir(bin); await mkdir(path.join(kernel, 'scripts/kconfig'), {recursive: true});
  await writeFile(path.join(kernel, 'scripts/kconfig/Makefile'), '# fixture\n');
  await writeFile(path.join(kernel, 'Makefile'), '# fixture\n');
  for (const name of ['flex', 'bison']) await writeFile(path.join(bin, name), '#!/bin/sh\necho fixture\n', {mode: 0o755});
  const bc = path.join(bin, 'bc');
  await writeFile(bc, '#!/bin/sh\n[ "$1" = --version ] && exit 1\ngrep -q "2\\^64" "$1" || exit 2\necho 18446744073709551616\n', {mode: 0o755});
  const job = {id: 'unit.doctor', env: {PATH: bin + ':' + process.env.PATH}, workflow: [{kind: 'kernelBuild', name: 'linux', timeoutMs: 1000, details: {sourceDir: kernel}}]};
  let issues = await doctorJobs([job], root);
  assert.deepEqual(issues.filter(i => i.message.includes('Linux bc')), []);
  await writeFile(bc, '#!/bin/sh\necho 0\n', {mode: 0o755});
  issues = await doctorJobs([job], root);
  assert.equal(issues.filter(i => i.message.includes('Linux bc')).length, 1);
});
