import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile,readFile,rm,stat,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const kit=fileURLToPath(new URL('..',import.meta.url));
const xmake=process.env.CAUTEST_XMAKE;
const when={skip:!xmake};
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function command(root,args,code=0){const r=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:45000,maxBuffer:24*1024*1024});let detail='';try{const response=JSON.parse(r.stdout);if(response.resultPath)detail=JSON.stringify(JSON.parse(readFileSync(response.resultPath,'utf8')).jobs.map(j=>({id:j.jobId,errors:j.errors})),null,2);}catch{}assert.equal(r.status,code,r.stdout+'\n'+r.stderr+'\n'+(r.error??'')+'\n'+(r.status===code?'':detail));return r;}
function ct(root,args,code=0){return JSON.parse(command(root,['ct','--json',...args],code).stdout);}
async function result(root,args=[],code=0){return JSON.parse(await readFile(ct(root,['--reporter=json,junit',...args],code).resultPath,'utf8'));}
const coverage=job=>job.artifacts.find(a=>a.kind==='coverage');
const receipt=job=>job.artifacts.find(a=>a.kind==='build-artifact').metadata.receipt;
async function sourceReport(job,source){const reports=await Promise.all(coverage(job).metadata.reports.map(f=>readFile(f,'utf8')));const found=reports.find(s=>s.includes(`Source:${source}\n`));assert.ok(found,`Missing report for ${source}`);return found;}
function count(text,marker){const line=text.split('\n').find(s=>s.includes(marker));assert.ok(line,marker);const value=line.split(':')[0].trim();return value==='#####'||value==='====='?0:Number.parseInt(value,10);}
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'cautest gcov 中文 ;$ '));try{
 await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
 await mkdir(path.join(root,'a'));await mkdir(path.join(root,'b'));
 await writeFile(path.join(root,'a/value.c'),'int value_a(void) { return 7; } /* HIT_A */\n');
 await writeFile(path.join(root,'b/value.c'),'int value_b(void) { return 11; } /* HIT_B */\n');
 await writeFile(path.join(root,'shared.c'),'int shared(void) { return 3; } /* HIT_SHARED */\n');
 await writeFile(path.join(root,'cases.c'),`#include <cautest/cautest.h>
int value_a(void); int value_b(void); int shared(void);
CAUTEST_CASE(covers_a) { CAUTEST_EXPECT_EQ_INT(7,value_a()); CAUTEST_EXPECT_EQ_INT(3,shared()); }
CAUTEST_CASE(covers_b) { CAUTEST_EXPECT_EQ_INT(11,value_b()); }
CAUTEST_CASE(deliberate_failure) { CAUTEST_EXPECT_EQ_INT(42,value_a()); }
CAUTEST_SUITE(covered,CAUTEST_CASE_ENTRY(covers_a),CAUTEST_CASE_ENTRY(covers_b),CAUTEST_CASE_ENTRY(deliberate_failure));
`);
 await writeFile(path.join(root,'xmake.lua'),`set_project("gcov-regression")
set_languages("c99")
includes("tools/cautest/xmake.lua")
target("shared")
 set_kind("static")
 set_default(false)
 add_rules("cautest.gcov")
 add_files("shared.c")
target_end()
for _, name in ipairs({"first","second"}) do
 target("test." .. name)
  set_kind("binary")
  set_default(false)
  add_rules("cautest.native","cautest.gcov")
  add_deps("shared")
  add_cflags("-O0", "-g", {force=true})
  add_files("cases.c","a/value.c","b/value.c")
  add_values("cautest.registry.suites","covered")
 target_end()
 ctest.native {id="unit." .. name,target="test." .. name,coverage={},run={case={"covers_a","covers_b"}}}
end
`);
 await fn(root);
}finally{await rm(root,{recursive:true,force:true});}}
test('real Xmake gcov: list/plan are read-only; shared library and duplicate basenames retain real hits',when,()=>fixture(async root=>{
 assert.equal(ct(root,['--list']).length,2);const plan=ct(root,['--plan']);assert.match(JSON.stringify(plan),/nativeCoverage/);ct(root,['--doctor']);await assert.rejects(stat(path.join(root,'build')));
 const r=await result(root);assert.equal(r.status,'SUCCESS');assert.equal(r.jobs.length,2);
 for(const job of r.jobs){assert.deepEqual(job.steps.map(s=>s.kind),['artifactBuild','cTestRun','nativeCoverage']);assert.ok(receipt(job).outputs.some(o=>o.role.startsWith('gcov-note-')));
  assert.ok(count(await sourceReport(job,path.join(root,'a/value.c')),'HIT_A')>0);
  assert.ok(count(await sourceReport(job,path.join(root,'b/value.c')),'HIT_B')>0);
  assert.ok(count(await sourceReport(job,path.join(root,'shared.c')),'HIT_SHARED')>0);
 }
}));
test('real Xmake gcov: repeated runs isolate data and collect after a failing C case',when,()=>fixture(async root=>{
 const first=await result(root,['--case=covers_a','unit.first']);const a=receipt(first.jobs[0]).outputs.find(o=>o.role==='primary');const before=await stat(a.path);
 const next=await result(root,['--case=covers_b','unit.first']);assert.equal((await stat(a.path)).mtimeMs,before.mtimeMs);
 assert.equal(count(await sourceReport(next.jobs[0],path.join(root,'a/value.c')),'HIT_A'),0);
 assert.ok(count(await sourceReport(next.jobs[0],path.join(root,'b/value.c')),'HIT_B')>0);
 const failed=await result(root,['--case=deliberate_failure','unit.first'],1);assert.equal(failed.status,'FAIL');assert.equal(failed.jobs[0].steps.at(-1).status,'SUCCESS');assert.ok(count(await sourceReport(failed.jobs[0],path.join(root,'a/value.c')),'HIT_A')>0);
 await appendFile(path.join(root,'xmake.lua'),'\nctest.native {id="unit.alias",target="test.first",coverage={},run={case="covers_b"}}\n');
 const aliases=await result(root,['--case=covers_b','unit.first','unit.alias']);assert.equal(aliases.jobs.length,2);
 assert.equal(aliases.jobs.flatMap(j=>j.artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-test.first')).length,1);
 for(const job of aliases.jobs){assert.equal(count(await sourceReport(job,path.join(root,'a/value.c')),'HIT_A'),0);assert.ok(count(await sourceReport(job,path.join(root,'b/value.c')),'HIT_B')>0);}
}));
test('real Xmake gcov: missing notes rebuild their objects; failed builds cannot reuse a stale receipt',when,()=>fixture(async root=>{
 const initial=await result(root,['unit.first']);const notes=receipt(initial.jobs[0]).outputs.filter(o=>o.role.startsWith('gcov-note-'));
 await rm(notes[0].path);await rm(notes[1].path);const next=await result(root,['unit.first']);assert.equal(next.status,'SUCCESS');assert.ok((await stat(notes[0].path)).size>10);assert.ok((await stat(notes[1].path)).size>10);
}));
test('real Xmake gcov: missing instrumentation/tool and invalid declarations fail explicitly',when,()=>fixture(async root=>{
 const file=path.join(root,'xmake.lua');const original=await readFile(file,'utf8');
 await writeFile(file,original.replaceAll('coverage={}','coverage={tool="/missing/gcov"}'));assert.match(JSON.stringify(ct(root,['--doctor','unit.first'],2)),/missing\/gcov/);
 await writeFile(path.join(root,'bad-gcov'),'#!/bin/sh\nif [ "$1" = "--version" ]; then exec gcov --version; fi\nexit 7\n',{mode:0o755});
 await writeFile(file,original.replaceAll('coverage={}','coverage={tool="./bad-gcov"}'));
 const failed=await result(root,['unit.first'],2);assert.equal(failed.status,'ERROR');assert.equal(failed.jobs[0].steps.at(-1).status,'ERROR');assert.match(JSON.stringify(failed),/GCOV 收集失败/);
 await writeFile(file,original.replace('"cautest.native","cautest.gcov"','"cautest.native"'));
 const plain=await result(root,['unit.first'],2);assert.match(JSON.stringify(plain),/cautest.gcov/);
 await writeFile(file,original);await appendFile(file,'\nctest.native {id="unit.invalid",target="test.first",coverage={unexpected=true}}\n');const bad=command(root,['ct','--list'],3);assert.match(bad.stderr,/coverage.*未知字段/);
}));
