import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,symlink,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url)),xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
async function fixture(t,value=7){
 const root=await mkdtemp(path.join(tmpdir(),'ct-parallel 中文 '));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
 await writeFile(path.join(root,'test.c'),`#include <cautest/cautest.h>\nCAUTEST_CASE(value){CAUTEST_EXPECT_EQ_INT(${value},PROJECT_VALUE);}\nCAUTEST_SUITE(parallel,CAUTEST_CASE_ENTRY(value));\n`);
 await writeFile(path.join(root,'xmake.lua'),`includes("tools/cautest/xmake.lua")\ntarget("test.parallel")\nset_kind("binary")\nadd_rules("cautest.native")\nadd_files("test.c")\nadd_defines("PROJECT_VALUE=${value}")\nadd_values("cautest.registry.suites","parallel")\ntarget_end()\nctest.native {id="unit.parallel",target="test.parallel"}\n`);
 const result=spawnSync(xmake,['f','-y','-m','release'],{cwd:root,env,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stdout+result.stderr);
 return root;
}
function run(root,args=[]){return new Promise((resolve,reject)=>{
 const p=spawn(xmake,['ct','--json','--reporter=json,junit',...args],{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:true});let out='',err='';
 const timer=setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL');}catch{}reject(new Error('Xmake concurrency timeout'));},120000);
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',async(code)=>{clearTimeout(timer);try{assert.equal(code,0,out+err);const summary=JSON.parse(out);const result=JSON.parse(await readFile(summary.resultPath,'utf8'));assert.equal(result.status,'SUCCESS');resolve({summary,result});}catch(e){reject(e);}});
});}
test('four same-project Xmake sessions and a different project retain complete isolated receipts',{skip:!xmake},async t=>{
 const a=await fixture(t,7),b=await fixture(t,29);
 const results=await Promise.all([run(a),run(a),run(a),run(a),run(b)]);
 assert.equal(new Set(results.map(r=>r.summary.resultPath)).size,5);
 const artifacts=results.map(r=>r.result.jobs[0].artifacts.find(a=>a.kind==='build-artifact'));
 assert.equal(new Set(artifacts.slice(0,4).map(a=>a.buildId)).size,1);assert.notEqual(artifacts[0].buildId,artifacts[4].buildId);
 for(const [index,r] of results.entries()){
  const job=r.result.jobs[0];assert.equal(job.groups.flatMap(g=>g.cases).length,1);assert.equal(job.groups[0].cases[0].status,'PASS');
  assert.ok(artifacts[index].metadata.receipt.context.projectRoot===(index===4?b:a));assert.ok((await stat(artifacts[index].path)).size>0);
 }
});
