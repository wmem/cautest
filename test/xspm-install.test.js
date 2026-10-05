import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const kit = fileURLToPath(new URL('..', import.meta.url));
const xmake = process.env.CAUTEST_XMAKE;
const env = {...process.env, XMAKE_ROOT: 'y', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false'};

function run(program, args, cwd, success = true) {
  const result = spawnSync(program, args, {cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status === 0, success, result.stdout + result.stderr);
  return result;
}

test('xspm 安装钩子在工具包内构建 JS，失败后可重新安装，宿主目录不需要 npm',
  {skip: !xmake, timeout: 120000}, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cautest 安装 中文 '));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const host = path.join(directory, 'host with spaces');
    const tool = path.join(host, 'tools/cautest');
    await mkdir(tool, {recursive: true});
    await cp(kit, tool, {recursive: true, filter: file => path.relative(kit, file).split(path.sep)[0] !== "build" && !path.relative(kit, file).split(path.sep)
      .some(part => ['.git', 'node_modules', 'dist', '.cautest', '.xmake', 'release'].includes(part))});
    const script = path.join(directory, 'install.lua');
    await writeFile(script, `function main()
    local hook = import("xspm", {rootdir = ${JSON.stringify(tool)}, anonymous = true})
    hook.on_install {rootdir = ${JSON.stringify(tool)}, projectdir = ${JSON.stringify(host)}}
end
`);
    const lock = path.join(tool, 'package-lock.json');
    const validLock = await readFile(lock, 'utf8');
    await writeFile(lock, '{invalid lock');
    const failed = run(xmake, ['lua', script], host, false);
    assert.match(failed.stdout + failed.stderr, /npm/u);
    await assert.rejects(stat(path.join(tool, 'dist')), {code: 'ENOENT'});
    await writeFile(lock, validLock);
    run(xmake, ['lua', script], host);
    await stat(path.join(tool, 'dist/runtime/repository-entry.js'));
    await stat(path.join(tool, 'dist/adapters/xmake/entry.js'));
    await stat(path.join(tool, 'node_modules/typescript/bin/tsc'));
    assert.match(run(process.execPath, [path.join(tool, 'cautest.js'), '--version'], host).stdout, /^Cautest /u);
    for (const entry of ['package.json', 'node_modules', 'dist']) {
      await assert.rejects(stat(path.join(host, entry)), {code: 'ENOENT'});
    }
  });
