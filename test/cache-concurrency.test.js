import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {withBuildLock} from '../dist/cache/build-lock.js';
import {buildGuestProgram, buildDriverGuestCTest} from '../dist/uml/runtime.js';

async function setup(t) {
  const root=await mkdtemp(path.join(tmpdir(),'ct-cache-concurrency-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const context={job:{id:'unit.cache',env:{}},signal:new AbortController().signal,state:new Map(),output(){},project:{configDir:root,resultDir:root,cacheDir:path.join(root,'cache'),workDir:path.join(root,'work'),generatedDir:path.join(root,'generated')}};
  return {root,context};
}
function child(file,...args) {
  const p=spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe']});let out='',err='';
  p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal,out,err}));});
  return {p,done};
}
async function exists(file){try{await stat(file);return true;}catch{return false;}}
async function waitFor(file){const deadline=Date.now()+10000;while(!await exists(file)){assert.ok(Date.now()<deadline,'timed out waiting for '+file);await delay(10);}}

test('same-key real Guest compilation serializes six independent processes and validates one publication', {skip:process.platform!=='linux'}, async t=>{
  const {root}=await setup(t);await writeFile(path.join(root,'main.c'),'int main(void){return 0;}\n');
  const compiler=path.join(root,'compiler');await writeFile(compiler,`#!/bin/sh\ncase "$1" in --version|-dumpmachine) exec cc "$@";; esac\nprintf 'compile\\n' >> '${root}/compiles.log'\nsleep 0.2\nexec cc "$@"\n`);await chmod(compiler,0o755);
  const worker=path.join(root,'worker.mjs');
  await writeFile(worker,`import {buildGuestProgram} from ${JSON.stringify(new URL('../dist/uml/runtime.js',import.meta.url).href)};const root=process.argv[2];const ctx={job:{id:'unit.concurrent',env:{}},signal:new AbortController().signal,state:new Map(),output(){},project:{configDir:root,resultDir:root,cacheDir:root+'/cache',workDir:root+'/work',generatedDir:root+'/generated'}};console.log(JSON.stringify(await buildGuestProgram({name:'guest',sources:['main.c'],compiler:root+'/compiler'},ctx)));`);
  const children=Array.from({length:6},()=>child(worker,root));
  const results=await Promise.all(children.map(c=>c.done));for(const r of results)assert.equal(r.code,0,r.err);
  const artifacts=results.map(r=>JSON.parse(r.out));assert.equal(artifacts.filter(a=>!a.cacheHit).length,1);assert.equal(new Set(artifacts.map(a=>a.path)).size,1);
  assert.equal(await readFile(path.join(root,'compiles.log'),'utf8'),'compile\ncompile\n');
  assert.equal((await readFile(artifacts[0].path)).subarray(0,4).toString('hex'),'7f454c46');
});

test('cache locks survive aliases, release on exception and owner death, and do not release another owner after waiter cancellation',{skip:process.platform!=='linux'},async t=>{
  const {root}=await setup(t),real=path.join(root,'real'),alias=path.join(root,'alias');await mkdir(real);await symlink(real,alias,'dir');
  const worker=path.join(root,'owner.mjs'),ready=path.join(root,'ready');
  await writeFile(worker,`import {writeFile} from 'node:fs/promises';import {withBuildLock} from ${JSON.stringify(new URL('../dist/cache/build-lock.js',import.meta.url).href)};await withBuildLock(process.argv[2],new AbortController().signal,async()=>{await writeFile(process.argv[3],'ready');await new Promise(()=>setInterval(()=>{},1000));});`);
  const owner=child(worker,path.join(real,'entry'),ready);t.after(()=>owner.p.kill('SIGKILL'));await waitFor(ready);
  const abort=new AbortController();const waiting=withBuildLock(path.join(alias,'entry'),abort.signal,async()=>{throw new Error('must not enter');},30000);setTimeout(()=>abort.abort(new Error('wait cancelled')),50);
  await assert.rejects(waiting,/wait cancelled/);
  await assert.rejects(withBuildLock(path.join(real,'entry'),new AbortController().signal,async()=>{},50),/lock wait expired/);
  owner.p.kill('SIGKILL');await owner.done;
  await withBuildLock(path.join(alias,'entry'),new AbortController().signal,async()=>{},3000);
  await assert.rejects(withBuildLock(path.join(real,'entry'),new AbortController().signal,async()=>{throw new Error('build failed');}),/build failed/);
  await withBuildLock(path.join(real,'entry'),new AbortController().signal,async()=>{},3000);
});

test('Guest names are part of cache identity and parallel different-name builds cannot delete each other',async t=>{
  const {root,context}=await setup(t);await writeFile(path.join(root,'main.c'),'int main(void){return 0;}\n');
  const [a,b]=await Promise.all(['one','two'].map(name=>buildGuestProgram({name,sources:['main.c']},context)));
  assert.notEqual(a.buildId,b.buildId);await stat(a.path);await stat(b.path);
  const source='#include <cautest/cautest.h>\nCAUTEST_CASE(ok){CAUTEST_EXPECT_EQ_INT(1,1);}\nCAUTEST_SUITE(test,CAUTEST_CASE_ENTRY(ok));\n';await writeFile(path.join(root,'test.c'),source);
  const [x,y]=await Promise.all(['one','two'].map(name=>buildDriverGuestCTest('unit.'+name,{name,tests:['test.c'],suites:['test']},context)));
  assert.notEqual(x.buildId,y.buildId);await stat(x.path);await stat(y.path);
});
