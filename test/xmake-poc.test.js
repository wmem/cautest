import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const xmake = process.env.CAUTEST_XMAKE;
test('real Xmake 3.1.1: exported table DSL, Node → nested build, options, failure, ordinary build', {skip: !xmake}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cautest PoC 中文 '));
  try {
    await cp(new URL('../examples/xmake/poc/', import.meta.url), root, {recursive:true});
    const run = (args, extra={}) => spawnSync(xmake,args,{cwd:root,env:{...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor',...extra},encoding:'utf8',timeout:25000});
    let r=run(['ct','--tag=a','--tag=b','--test-profile=ci','foo','bar']);
    assert.equal(r.status,0,r.stdout+r.stderr);
    assert.match(r.stdout,/"id":"hello"/);
    assert.match(r.stdout,/"tag":"b"/); // Xmake kv is last-wins: document comma lists, not repeatable flags.
    assert.match(r.stdout,/"test-profile":"ci"/);
    assert.match(r.stdout,/"jobs":\["foo","bar"\]/);
    r=run(['build','-y','app'],{CAUTEST_NODE:'/not/installed/node'});
    assert.equal(r.status,0,r.stdout+r.stderr);
    await writeFile(path.join(root,'main.c'),'#error known_build_failure\n');
    r=run(['clean','-y','app']); assert.equal(r.status,0,r.stdout+r.stderr);
    r=run(['ct']); assert.notEqual(r.status,0); assert.match(r.stdout+r.stderr,/known_build_failure/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
