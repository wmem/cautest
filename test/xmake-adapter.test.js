import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,symlink,mkdir,readFile,writeFile,appendFile,rm,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url));const xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'cautest xmake 中文 '));try{await cp(path.join(kit,'examples/xmake/native'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
function run(root,args,code=0,extra={}){const r=spawnSync(xmake,args,{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:25000,maxBuffer:16*1024*1024});assert.equal(r.status,code,r.stdout+'\n'+r.stderr+'\n'+(r.error??''));return r;}
function json(root,args,code=0){return JSON.parse(run(root,['ct','--json',...args],code).stdout);}
async function result(root,args=[],code=0){return JSON.parse(await readFile(json(root,['--reporter=json,junit',...args],code).resultPath,'utf8'));}
const artifact=j=>j.artifacts.find(a=>a.kind==='build-artifact');
const when={skip:!xmake};
test('configured DSL uses saved options before collection without loading target hooks',when,()=>fixture(async root=>{
 run(root,['f','-y','--coverage=y']);
 await appendFile(path.join(root,'xmake.lua'),'\ntarget("demo")\n on_load(function () io.writefile("target-loaded.txt","must not load on list/plan") end)\ntarget_end()\n');
 assert.equal(json(root,['--list']).length,3);
 const plan=json(root,['--plan','unit.math']);assert.match(JSON.stringify(plan),/nativeCoverage/);
 json(root,['--doctor','unit.math']);await assert.rejects(stat(path.join(root,'target-loaded.txt')));await assert.rejects(stat(path.join(root,'build')));
}));
test('real vendored entry: side-effect-free list/plan, deterministic fragments, old selectors and disabled jobs',when,()=>fixture(async root=>{
 await appendFile(path.join(root,'xmake.lua'),'\nincludes("tools/cautest/xmake.lua")\n');
 let jobs=json(root,['--list']);assert.deepEqual(jobs.map(j=>j.id),['unit.checksum','unit.math','unit.math.expected-failure']);
 assert.equal(jobs[2].enabled,false);assert.match(jobs[0].origin.source,/modules\/checksum\/test.lua/);
 assert.equal(json(root,['--list','--tag=host,math']).length,1);assert.equal(json(root,['--list','--level=unit','unit.math']).length,1);
 json(root,['--plan']);json(root,['--doctor']);await assert.rejects(stat(path.join(root,'build')));
 run(root,['ct','--json','--list','missing.*'],4);run(root,['ct','--json','unit.math.expected-failure'],4);
 const bad=spawnSync(xmake,['ct','--list','--plan'],{cwd:root,env,encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stdout+bad.stderr,/mutually exclusive/);
}));
test('real Native multi-module/suite CTP, same-build source reuse and product library macro isolation',when,()=>fixture(async root=>{
 const r=await result(root);assert.equal(r.status,'SUCCESS');assert.equal(r.jobs.length,2);assert.equal(r.jobs.flatMap(j=>j.groups).length,3);assert.equal(r.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases)).length,5);
 for(const job of r.jobs){const a=artifact(job);assert.match(a.buildId,/^[a-f0-9]{64}$/);assert.notEqual(a.buildId,a.fingerprint);assert.equal(a.metadata.receipt.target,job.jobId==='unit.math'?'test.math':'test.checksum');}
 run(root,['build','-y','demo'],0,{CAUTEST_NODE:'/missing/node'});const executable=path.join(root,'build/linux/x86_64/release/demo');assert.equal(spawnSync(executable,[],{encoding:'utf8'}).status,0);
 const pass=await result(root,['--suite=math_second','unit.math']);assert.equal(pass.jobs[0].groups[0].cases.length,1);
 await result(root,['--case=deliberate_failure','unit.math'],1);
 const files=await readdir(path.dirname(json(root,['--reporter=json,junit','unit.checksum']).resultPath));assert.ok(files.some(f=>f.endsWith('.xml'))||files.includes('reports'));
}));
test('real build session: shared target built once, stable binary, corrupted residual rebuilt, error blocks CTP',when,()=>fixture(async root=>{
 const first=await result(root,['unit.math']);const a=artifact(first.jobs[0]);const before=await stat(a.path);const second=await result(root,['unit.math']);assert.equal(artifact(second.jobs[0]).buildId,a.buildId);assert.equal((await stat(a.path)).mtimeMs,before.mtimeMs);
 await appendFile(path.join(root,'ctest.lua'),'\nctest.native {id="unit.shared",target="test.math",tags={"host"},run={case="smoke"}}\n');
 const shared=await result(root,['unit.math','unit.shared']);assert.equal(shared.jobs.length,2);assert.equal(shared.jobs.flatMap(j=>j.artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-test.math')).length,1);
 await writeFile(a.path,'CORRUPTED OUTPUT');const restored=await result(root,['unit.math']);assert.equal(restored.status,'SUCCESS');assert.ok((await stat(a.path)).size>1000);
 await appendFile(path.join(root,'modules/math/math_ops.c'),'\n#error required_build_failure\n');const failed=await result(root,['unit.math'],2);assert.equal(failed.jobs[0].steps[1].status,'SKIPPED');assert.match(JSON.stringify(failed),/required_build_failure/);
}));
test('real collector diagnoses duplicate IDs, empty required patterns, unknown fields, cycles and reserved tasks',when,()=>fixture(async root=>{
 const file=path.join(root,'ctest.lua');const original=await readFile(file,'utf8');
 const cases=[['ctest.include {patterns={"does-not-exist/*.lua"}}','required pattern matched no files'],['ctest.native {id="unit.math",target="other"}','Duplicate jobs:unit.math'],['ctest.native {id="unit.typo",target="other",typo=true}','unknown fields: typo'],['ctest.include {patterns={"ctest.lua"}}','ctest.include cycle'],['task("ct")','reserved by Cautest']];
 for(const [extra,message] of cases){await writeFile(file,original+'\n'+extra+'\n');const r=spawnSync(xmake,['ct','--list'],{cwd:root,env,encoding:'utf8',timeout:15000});assert.notEqual(r.status,0,r.stdout+r.stderr);assert.ok((r.stdout+r.stderr).includes(message),r.stdout+r.stderr);}
 await writeFile(file,original+'\nctest.include {patterns={"optional/*.lua"},optional=true}\nctest.include {patterns={"modules/**/test.lua"}}');assert.equal(json(root,['--list']).length,3);
}));
test('real workflow module provider receives explicit artifact, reuses old engine, tracks source and rejects env sharing',when,()=>fixture(async root=>{
 await writeFile(path.join(root,'workflow.mjs'),`import {defineStep} from '@cautest/config';\nexport function create({getArtifact}) { return [defineStep({kind:'checkArtifact',name:'check',phase:'run',async execute(ctx){const a=getArtifact(ctx,'app');if(!a.path.endsWith('demo'))throw new Error('wrong role');return {testResults:[{name:'app',cases:[{name:'artifact',status:'PASS',assertions:[],diagnostics:[]}]}]};}})]; }\n`);
 await appendFile(path.join(root,'ctest.lua'),'\nctest.workflow {id="integration.app",provider={module="workflow.mjs",export="create"},artifacts={app={target="demo"}}}\n');
 assert.equal((await result(root,['integration.app'])).status,'SUCCESS');const description=json(root,['--describe']);assert.match(JSON.stringify(description),/workflow.mjs/);
 await appendFile(path.join(root,'ctest.lua'),'\nctest.native {id="unit.envA",target="test.math",env={VAR="a"},run={case="smoke"}}\nctest.native {id="unit.envB",target="test.math",env={VAR="b"},run={case="smoke"}}\n');const conflict=await result(root,['unit.envA','unit.envB'],2);assert.match(JSON.stringify(conflict),/Conflicting build env/);assert.equal(conflict.jobs[1].steps[1].status,'SKIPPED');
}));
