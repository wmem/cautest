import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, mkdir, symlink, writeFile, readFile, rm, stat, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const kit = fileURLToPath(new URL('..', import.meta.url));
const xmake = process.env.CAUTEST_XMAKE;
const env = {...process.env, XMAKE_ROOT: 'y', XMAKE_COLORTERM: 'nocolor'};
delete env.CAUTEST_XMAKE_CONFIG;
delete env.CAUTEST_XMAKE_WORKINGDIR;
const when = {skip: !xmake};

async function fixture(t, {legacy = false} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cautest config 中文 '));
  t.after(() => rm(root, {recursive: true, force: true}));
  await cp(path.join(kit, 'examples/xmake/native'), root, {recursive: true});
  await mkdir(path.join(root, 'tools'));
  await symlink(kit, path.join(root, 'tools/cautest'), 'dir');
  let contents = await readFile(path.join(root, 'xmake.lua'), 'utf8');
  contents = contents.replace(/includes\("ctest.lua"\)\s*/u, '');
  contents = contents.replace('includes("tools/cautest/xmake.lua")', 'includes(os.files("tools/cautest/xmake.lua"))');
  if (legacy) contents += '\nincludes("ctest.lua")\n';
  await writeFile(path.join(root, 'xmake.lua'), contents);
  return root;
}

function run(root, args, code = 0, cwd = root) {
  const result = spawnSync(xmake, args, {cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, code, result.stdout + result.stderr + String(result.error ?? ''));
  return result;
}

function query(root, args, cwd = root) {
  return JSON.parse(run(root, ['ct', '--json', ...args], 0, cwd).stdout);
}

async function selectedConfig(root, name, value, spoof = false) {
  const directory = path.join(root, name);
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, 'selected.c'), `#include <cautest/cautest.h>
CAUTEST_CASE(value_${value}) { CAUTEST_EXPECT_EQ_INT(${value}, ${value}); }
CAUTEST_SUITE(selected_config, CAUTEST_CASE_ENTRY(value_${value}));
`);
  const config = path.join(directory, 'tests.lua');
  await writeFile(config, `ctest.project {defaults = {resultDir = "results"}}
target("test.selected")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.native")
    add_files("selected.c")
    add_values("cautest.registry.suites", "selected_config")
target_end()
ctest.native {
    id = "unit.selected", target = "test.selected",
    run = {case = "value_${value}"},
    env = ${spoof ? '{CAUTEST_XMAKE_CONFIG = "/does-not-exist.lua", CAUTEST_XMAKE_WORKINGDIR = "/does-not-exist"}' : '{}'}
}
`);
  return config;
}

async function execute(root, config, cwd = root) {
  const summary = query(root, ['-c', config, '--reporter=json,junit'], cwd);
  const report = JSON.parse(await readFile(summary.resultPath, 'utf8'));
  assert.equal(report.status, 'SUCCESS');
  assert.deepEqual(report.jobs.map(job => job.jobId), ['unit.selected']);
  assert.equal(report.jobs[0].groups[0].cases[0].status, 'PASS');
  const artifact = report.jobs[0].artifacts.find(item => item.kind === 'build-artifact');
  assert.equal(artifact.metadata.receipt.target, 'test.selected');
  assert.equal(artifact.metadata.receipt.context.projectRoot, root);
  return artifact;
}

test('默认自动读取 ctest.lua，查询不构建，测试目标也可由普通 build 发现', when, async t => {
  const root = await fixture(t);
  const rootfile = path.join(root, 'xmake.lua');
  await writeFile(rootfile, await readFile(rootfile, 'utf8') + '\nconfig_available_after_tool = true\n');
  const file = path.join(root, 'ctest.lua');
  await writeFile(file, 'if not config_available_after_tool then ctest._fail("根工程必须先完成解析") end\n' + await readFile(file, 'utf8'));
  assert.deepEqual(query(root, ['--list']).map(job => job.id), ['unit.checksum', 'unit.math', 'unit.math.expected-failure']);
  query(root, ['--plan']);
  query(root, ['--doctor']);
  assert.match(run(root, ['show', '-l', 'targets']).stdout, /test\.checksum/u);
  await assert.rejects(stat(path.join(root, 'build')));
  run(root, ['build', '-y', 'test.checksum']);
});

test('旧工程显式 includes(ctest.lua) 不重复收集，--config 替换默认配置', when, async t => {
  const root = await fixture(t, {legacy: true});
  assert.equal(query(root, ['--list']).length, 3);
  const defaultFile = path.join(root, 'ctest.lua');
  await writeFile(defaultFile, 'default_was_read = true\n' + await readFile(defaultFile, 'utf8'));
  const selected = await selectedConfig(root, '另一套配置', 37);
  await writeFile(selected, 'if default_was_read then ctest._fail("指定配置前不能执行默认配置") end\n' + await readFile(selected, 'utf8'));
  const jobs = query(root, [`--config=${selected}`, '--list']);
  assert.deepEqual(jobs.map(job => job.id), ['unit.selected']);
  assert.equal(fileURLToPath(jobs[0].origin.source), selected);
  await execute(root, selected);
  assert.equal(query(root, ['--list']).length, 3);
});

test('指定配置控制真实 Native 构建和产物查询，Job 环境不能替换配置', when, async t => {
  const root = await fixture(t);
  const selected = await selectedConfig(root, 'config with spaces 中文', 41, true);
  const relative = path.relative(root, selected);
  assert.deepEqual(query(root, [`--config=${relative}`, '--list']).map(job => job.id), ['unit.selected']);
  await assert.rejects(stat(path.join(root, 'build')));
  const artifact = await execute(root, relative);
  assert.ok(artifact.path.startsWith(root + path.sep));
  assert.equal(query(root, ['--list']).length, 3);
});

test('显式 -P 下配置路径相对于项目，配置切换不能复用另一套产物身份', when, async t => {
  const root = await fixture(t);
  const first = await selectedConfig(root, 'configs/first', 11);
  const second = await selectedConfig(root, 'configs/second', 29);
  const a = await execute(root, first);
  const relative = path.relative(root, second);
  const outside = path.join(root, 'independent workdir');
  await mkdir(outside);
  const summary = JSON.parse(run(root, ['ct', '-P', root, '-c', relative, '--json', '--reporter=json,junit'], 0, outside).stdout);
  const report = JSON.parse(await readFile(summary.resultPath, 'utf8'));
  assert.equal(report.status, 'SUCCESS');
  const b = report.jobs[0].artifacts.find(item => item.kind === 'build-artifact');
  assert.notEqual(a.buildId, b.buildId);
  assert.equal(b.metadata.receipt.target, 'test.selected');
  assert.equal(b.metadata.receipt.context.projectRoot, root);
  assert.equal(b.metadata.receipt.context.buildDir, path.join(outside, 'build'));
  const restored = await execute(root, first);
  assert.equal(restored.buildId, a.buildId);
});

test('缺失或语法错误的配置返回配置错误，指定其他配置可绕过损坏的默认文件', when, async t => {
  const root = await fixture(t, {legacy: true});
  const selected = await selectedConfig(root, 'configs', 17);
  await writeFile(path.join(root, 'ctest.lua'), 'this is not valid Lua !!!\n');
  const invalid = run(root, ['ct', '--list'], 3);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /invalid task/u);
  assert.match(invalid.stderr, /ctest\.lua/u);
  await assert.rejects(stat(path.join(root, '.cautest')));
  assert.deepEqual(query(root, ['-c', selected, '--list']).map(job => job.id), ['unit.selected']);
  const manifestDir = path.join(root, '.cautest/xmake/manifests');
  const manifests = await readdir(manifestDir);
  const missing = run(root, ['ct', '--config=missing.lua', '--list'], 3);
  assert.match(missing.stderr, /configuration not found.*missing\.lua/u);
  await writeFile(selected, 'this is invalid Lua !!!\n');
  const broken = run(root, ['ct', '-c', selected, '--list'], 3);
  assert.match(broken.stderr, /tests\.lua/u);
  assert.doesNotMatch(broken.stdout + broken.stderr, /invalid task/u);
  await assert.rejects(stat(path.join(root, 'build')));
  assert.deepEqual(await readdir(manifestDir), manifests);
});

test('缺少默认文件时仍兼容 xmake.lua 内联声明，无声明则给出配置准备提示', when, async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'ctest.lua'));
  const missing = run(root, ['ct', '--list'], 3);
  assert.match(missing.stderr, /create ctest\.lua or use --config=FILE/u);
  await writeFile(path.join(root, 'xmake.lua'), 'includes(os.files("tools/cautest/xmake.lua"))\nctest.native {id="unit.inline", target="not-built"}\n');
  assert.deepEqual(query(root, ['--list']).map(job => job.id), ['unit.inline']);
});

test('工具缺失时 os.files 不读取 ctest.lua，不阻止 init；工具可用后自动加载', when, async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'tools/cautest'));
  await writeFile(path.join(root, 'ctest.lua'), 'error("工具安装前不应读取此文件")\n');
  await writeFile(path.join(root, 'xmake.lua'), `includes(os.files("tools/cautest/xmake.lua"))
task("init")
    set_menu {usage = "xmake init", description = "fixture"}
    on_run(function () io.writefile("initialized", "ok") end)
task_end()
`);
  run(root, ['init']);
  assert.equal(await readFile(path.join(root, 'initialized'), 'utf8'), 'ok');
  await symlink(kit, path.join(root, 'tools/cautest'), 'dir');
  await writeFile(path.join(root, 'ctest.lua'), 'ctest.native {id="unit.installed", target="not-built"}\n');
  assert.deepEqual(query(root, ['--list']).map(job => job.id), ['unit.installed']);
});
