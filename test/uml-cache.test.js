import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink,readdir} from 'node:fs/promises';
import {validBuildOutput,publishBuildOutput} from '../dist/cache/build-output.js';
import {buildGuestProgram,buildDriverGuestCTest,buildRootfs} from '../dist/uml/runtime.js';
async function setup(t){const root=await mkdtemp(path.join(tmpdir(),'ct-uml-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,context:{job:{id:'unit.cache',env:{}},signal:new AbortController().signal,state:new Map(),output(){},project:{configDir:root,resultDir:path.join(root,'results'),cacheDir:path.join(root,'cache'),generatedDir:path.join(root,'generated'),workDir:path.join(root,'work')}}};}
async function damage(file){const data=await readFile(file);data[data.length-1]^=1;await writeFile(file,data);}
test('build-output manifests reject partial builds, changed timestamps, modes, missing outputs and path escapes',async t=>{
 const {root}=await setup(t);const dir=path.join(root,'cache');await mkdir(dir);const binary=path.join(dir,'binary');await writeFile(binary,'complete');
 assert.equal(await validBuildOutput(dir,'key',['binary']),false);await publishBuildOutput(dir,'key',['binary']);assert.equal(await validBuildOutput(dir,'key',['binary']),true);
 await damage(binary);assert.equal(await validBuildOutput(dir,'key',['binary']),false);await writeFile(binary,'complete');assert.equal(await validBuildOutput(dir,'key',['binary']),false);await publishBuildOutput(dir,'key',['binary']);assert.equal(await validBuildOutput(dir,'key',['binary']),true);
 await chmod(binary,0o755);assert.equal(await validBuildOutput(dir,'key',['binary']),false);await publishBuildOutput(dir,'key',['binary']);assert.equal(await validBuildOutput(dir,'other',['binary']),false);assert.equal(await validBuildOutput(dir,'key',['binary','missing']),false);
 await rm(binary);assert.equal(await validBuildOutput(dir,'key',['binary']),false);await writeFile(path.join(root,'outside'),'complete');await symlink(path.join(root,'outside'),binary);await assert.rejects(publishBuildOutput(dir,'key',['binary']),/escaped/);
 await assert.rejects(publishBuildOutput(dir,'key',['../outside']),/Invalid/);
 const manifest=path.join(dir,'.cautest-build-manifest.json');const data=JSON.parse(await readFile(manifest,'utf8'));data.outputs[0].path='../outside';await writeFile(manifest,JSON.stringify(data));assert.equal(await validBuildOutput(dir,'key',['../outside']),false);
});
test('real Guest ELF uses Make for changed sources and missing outputs',async t=>{
 const {root,context}=await setup(t);await writeFile(path.join(root,'main.c'),'int main(void){return 0;}\n');const input={name:'guest',sources:['main.c']};
 const first=await buildGuestProgram(input,context);assert.equal(first.cacheHit,false);assert.equal((await buildGuestProgram(input,context)).cacheHit,true);
 await writeFile(path.join(root,'main.c'),'int main(void){return 1;}\n');assert.equal((await buildGuestProgram(input,context)).cacheHit,false);
 await rm(first.path);assert.equal((await buildGuestProgram(input,context)).cacheHit,false);
});
test('real Driver CTP Guest rebuilds when output is missing',async t=>{
 const {root,context}=await setup(t);await writeFile(path.join(root,'test.c'),'#include <cautest/cautest.h>\nCAUTEST_CASE(passes) {CAUTEST_ASSERT_EQ_INT(1,1);}\nCAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(passes));\n');
 const input={name:'guest',tests:['test.c'],suites:['sample']};const first=await buildDriverGuestCTest('unit.sample',input,context);assert.equal(first.cacheHit,false);assert.equal((await buildDriverGuestCTest('unit.sample',input,context)).cacheHit,true);await rm(first.path);assert.equal((await buildDriverGuestCTest('unit.sample',input,context)).cacheHit,false);
});
test('real cpio and Agent cache: missing output, same-ID payload changes, endpoint and install-path changes cannot reuse an image',async t=>{
 const {root,context}=await setup(t);await writeFile(path.join(root,'main.c'),'int main(void){return 0;}\n');const guest=await buildGuestProgram({name:'guest',sources:['main.c']},context);const module=path.join(root,'module.ko');await writeFile(module,'fixture-not-a-real-module');
 const input={name:'image',environment:{kernel:{sourceDir:'unused'},busybox:{sourceDir:'unused'}},kernelOutput:root,busybox:{path:'/usr/bin/busybox',buildId:'busybox',cacheHit:false},modules:[{name:'sample',module,symbols:module,modulesOrder:module,cacheKey:'same-claimed-id',cacheHit:false}],programs:[guest]};
 const first=await buildRootfs(input,context);assert.equal(first.cacheHit,false);assert.equal((await buildRootfs(input,context)).cacheHit,true);await damage(first.rootfsPath);assert.equal((await buildRootfs(input,context)).cacheHit,false);
 const agentRoot=path.join(root,'cache/uml-agent'),agentKey=(await readdir(agentRoot))[0],agent=path.join(agentRoot,agentKey,'agent');const original=await readFile(agent);await rm(agent);await buildRootfs(input,context);assert.deepEqual(await readFile(agent),original);
 await damage(module);const changed=await buildRootfs(input,context);assert.notEqual(changed.buildId,first.buildId);assert.equal(changed.cacheHit,false);
 const endpoint=await buildRootfs({...input,programs:[{...guest,endpoint:'other'}]},context);assert.notEqual(endpoint.buildId,changed.buildId);
 const install=await buildRootfs({...input,programs:[{...guest,installPath:'/opt/cautest/elsewhere'}]},context);assert.notEqual(install.buildId,changed.buildId);
});
