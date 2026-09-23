import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,symlink,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url)),xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function command(root,args,expected=0){const r=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:40000,maxBuffer:16*1024*1024});assert.equal(r.status,expected,r.stdout+r.stderr);return r;}
async function run(root,code=0,args=[]){const summary=JSON.parse(command(root,['ct','--json','--reporter=json,junit',...args],code).stdout);return JSON.parse(await readFile(summary.resultPath,'utf8'));}
test('SPI behavioral model runs real Xmake firmware/CTP and detects a known receive fault as FAIL, then recovers',{skip:!xmake},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-spi-simulation-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp(path.join(kit,'examples/xmake/mcu-spi-simulated'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
 for(const action of ['list','plan','doctor'])command(root,['ct',`--${action}`,'--json']);await assert.rejects(stat(path.join(root,'build')));
 const cold=await run(root);assert.equal(cold.status,'SUCCESS');assert.equal(cold.jobs.length,2);
 const cases=cold.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases));assert.equal(cases.length,4);assert.ok(cases.every(c=>c.status==='PASS'));
 assert.equal(cold.jobs.flatMap(j=>j.artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-firmware.spi')).length,1);
 for(const j of cold.jobs){assert.equal(j.resources.find(r=>r.kind==='mcu-board').state,'closed');assert.equal(j.resources.find(r=>r.kind==='physical-lock').state,'closed');}
 const artifact=cold.jobs[0].artifacts.find(a=>a.kind==='build-artifact');const before=await stat(artifact.path);
 const selected=await run(root,0,['--case=device_identity','integration.spi.protocol']);assert.equal(selected.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases)).length,1);assert.equal(selected.jobs[0].artifacts.find(a=>a.kind==='build-artifact').buildId,artifact.buildId);assert.equal((await stat(artifact.path)).mtimeMs,before.mtimeMs);
 command(root,['f','-y','--spi-fault=y']);const failed=await run(root,1);assert.equal(failed.status,'FAIL');
 const failedCases=failed.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases)).filter(c=>c.status==='FAIL');assert.equal(failedCases.length,1);assert.equal(failedCases[0].name,'device_identity');assert.ok(failed.jobs.every(j=>j.resources.filter(r=>r.kind==='mcu-board'||r.kind==='physical-lock').every(r=>r.state==='closed')));
 command(root,['f','-y','--spi-fault=n']);const recovered=await run(root);assert.equal(recovered.status,'SUCCESS');assert.equal(recovered.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases)).length,4);
});
