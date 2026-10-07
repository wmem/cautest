import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, stat, rm, chmod, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compileC} from '../dist/build/incremental.js';
import {createFingerprint} from '../dist/cache/fingerprint.js';
import {sourceTreeIdentity} from '../dist/uml/runtime.js';
import {nativeCTestJob, executeWorkflow} from '../dist/config/index.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ct 增量 $ # '));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('Native 独立链接驱动：编译与链接分别调用，重运行不执行工具，链接失败移除旧产物', async t => {
  const root = await fixture(t), calls = path.join(root, 'calls');
  const source = path.join(root, 'main.c'), output = path.join(root, 'program');
  const cc = path.join(root, 'compiler'), ld = path.join(root, 'linker');
  await writeFile(source, 'int main(void) { return 0; }\n');
  for (const [file, name] of [[cc, 'compile'], [ld, 'link']]) {
    await writeFile(file, `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst {spawnSync}=require('node:child_process');\nfs.appendFileSync(${JSON.stringify(calls)}, '${name}\\n');\nconst r=spawnSync('cc',process.argv.slice(2),{stdio:'inherit'});\nprocess.exit(r.status ?? 2);\n`);
    await chmod(file, 0o755);
  }
  const input = {compiler: cc, linker: ld, sources: [source], directory: path.join(root, 'objects'), output, env: process.env, signal: new AbortController().signal};
  assert.equal(await compileC(input), false);
  assert.equal(await readFile(calls, 'utf8'), 'compile\nlink\n');
  assert.equal(await compileC(input), true);
  assert.equal(await readFile(calls, 'utf8'), 'compile\nlink\n');
  await writeFile(ld, '#!/bin/sh\nexit 7\n');
  await assert.rejects(compileC({...input, relink: true}), /C 构建失败/);
  await assert.rejects(stat(output), {code: 'ENOENT'});
});

test('真实 Make/depfile：空白及特殊路径、隐式头文件依赖、无变化增量、失败拒用旧产物', async t => {
  const root = await fixture(t), include = path.join(root, 'include'), directory = path.join(root, 'objects');
  await mkdir(include);
  const header = path.join(include, 'value.h'), source = path.join(root, 'main.c'), output = path.join(root, 'program');
  await writeFile(header, '#define VALUE 1\n');
  await writeFile(source, '#include <value.h>\n#include <stdio.h>\nint main(void) { printf("%d\\n", VALUE); return 0; }\n');
  const input = {compiler: 'cc', directory, output, sources: [source], cflags: [`-I${include}`], env: process.env, signal: new AbortController().signal};
  assert.equal(await compileC(input), false);
  assert.equal(execFileSync(output, {encoding: 'utf8'}), '1\n');
  assert.match(await readFile(path.join(directory, 'source_0.d'), 'utf8'), /value\.h/);
  const before = (await stat(output, {bigint: true})).mtimeNs;
  assert.equal(await compileC(input), true);
  assert.equal((await stat(output, {bigint: true})).mtimeNs, before);
  await rm(path.join(directory, 'source_0.d'));
  await writeFile(header, '#define VALUE 2\n');
  assert.equal(await compileC(input), false);
  assert.equal(execFileSync(output, {encoding: 'utf8'}), '2\n');
  await writeFile(source, '#error 编译失败\n');
  await assert.rejects(compileC(input), /C 构建失败/);
  await assert.rejects(stat(output), {code: 'ENOENT'});
});

test('元数据指纹不读取文件内容；源码树定位不遍历目录', async t => {
  const root = await fixture(t), source = path.join(root, 'source.c');
  await writeFile(source, 'aaaa');
  const original = await stat(source);
  const timestamp = new Date(Math.floor(original.mtimeMs));
  await utimes(source, timestamp, timestamp);
  const first = await createFingerprint({files: [source]}, {baseDir: root});
  await writeFile(source, 'bbbb');
  await utimes(source, timestamp, timestamp);
  assert.equal(await createFingerprint({files: [source]}, {baseDir: root}), first);
  await chmod(source, 0);
  await createFingerprint({files: [source]}, {baseDir: root});
  // 非 Git、大文件或不可读的无关文件不参与构建目录身份计算。
  assert.equal(await sourceTreeIdentity(path.join(root, '不存在的源码树'), {}), path.join(root, '不存在的源码树'));
});

test('真实 Native workflow 由编译器发现未显式列出的头文件，并在失败后停止执行', async t => {
  const root = await fixture(t), header = path.join(root, 'value.h');
  await writeFile(header, '#define VALUE 1\n');
  await writeFile(path.join(root, 'case.c'), '#include <cautest/cautest.h>\n#include "value.h"\nCAUTEST_CASE(value) { CAUTEST_ASSERT_EQ_INT(1, VALUE); }\nCAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(value));\n');
  const definition = nativeCTestJob({id: 'unit.incremental', tests: ['case.c'], suites: ['sample']});
  const project = {configDir: root};
  const first = await executeWorkflow(definition, {project});
  assert.equal(first.status, 'SUCCESS', JSON.stringify(first.errors));
  const unchanged = await executeWorkflow(definition, {project});
  assert.equal(unchanged.steps[0].diagnostics[0].code, 'cache_hit');
  await writeFile(header, '#define VALUE 2\n');
  const changed = await executeWorkflow(definition, {project});
  assert.equal(changed.status, 'FAIL');
  assert.equal(changed.steps[0].diagnostics[0].code, 'cache_miss');
  assert.equal(changed.artifacts[0].buildId, first.artifacts[0].buildId);
  await writeFile(header, '#error failed\n');
  const failed = await executeWorkflow(definition, {project});
  assert.equal(failed.status, 'ERROR');
  assert.equal(failed.steps[0].status, 'ERROR');
  assert.equal(failed.steps[1].status, 'SKIPPED');
});


test('真实 Native 并发复用同一构建目录，协议身份和完整 Case 结果一致', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'case.c'), '#include <cautest/cautest.h>\nCAUTEST_CASE(value) { CAUTEST_ASSERT_EQ_INT(1, 1); }\nCAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(value));\n');
  const definition = nativeCTestJob({id: 'unit.parallel', tests: ['case.c'], suites: ['sample']});
  const results = await Promise.all([0, 1, 2, 3].map(index => executeWorkflow(definition, {project: {configDir: root, resultDir: path.join(root, `result-${index}`)}})));
  assert.ok(results.every(result => result.status === 'SUCCESS'), JSON.stringify(results.map(result => result.errors)));
  assert.equal(new Set(results.map(result => result.artifacts[0].buildId)).size, 1);
  assert.equal(results.filter(result => result.artifacts[0].metadata.cacheHit === false).length, 1);
  assert.ok(results.every(result => result.groups[0].cases[0].status === 'PASS'));
});
