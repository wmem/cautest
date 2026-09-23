import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {hashFile} from '../dist/cache/fingerprint.js';
import {resolveArtifact} from '../dist/artifacts/index.js';
import {nativeCTestJob,mcuCTestJob,nativeArtifactJob,mcuArtifactJob,executeWorkflow} from '../dist/config/index.js';
const root=fileURLToPath(new URL('..',import.meta.url));
async function receipt(target,file,buildId,projectRoot=root){return {schemaVersion:1,kind:'cautest.artifact-receipt',target,context:{projectRoot,plat:'linux',arch:'x86_64',mode:'release',buildDir:path.join(projectRoot,'build')},...(buildId===undefined?{}:{protocolBuildId:buildId}),outputs:[{role:'primary',path:file,size:(await stat(file)).size,sha256:await hashFile(file)}]};}
const project=(dir)=>({configDir:root,workDir:path.join(dir,'work'),resultDir:path.join(dir,'results'),cacheDir:path.join(dir,'cache'),generatedDir:path.join(dir,'generated')});
test('receipt strictly validates version/target/output/context/bytes and separates protocol identity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-receipt-'));
 try {
 const file=path.join(dir,'artifact');await writeFile(file,'hello');const r=await receipt('test.foo',file,'hello-id');const ref={target:'test.foo'};
 assert.equal((await resolveArtifact(r,ref)).buildId,'hello-id');
 for(const invalid of [{...r,schemaVersion:2},{...r,unknown:true},{...r,target:'other'},{...r,protocolBuildId:undefined},{...r,outputs:[...r.outputs,...r.outputs]},{...r,outputs:[{...r.outputs[0],path:'relative'}]}])await assert.rejects(resolveArtifact(invalid,ref));
 await assert.rejects(resolveArtifact(r,{target:'test.foo',output:'firmware-bin'}),/role/);
 await assert.rejects(resolveArtifact(r,ref,{...r.context,arch:'arm64'}),/context mismatch/);
 await writeFile(file,'other');await assert.rejects(resolveArtifact(r,ref),/stale\/corrupt/);
 await rm(file);await assert.rejects(resolveArtifact(r,ref),/inaccessible/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Native artifact provider and legacy compiler use identical real CTP runtime and case results',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-artifact-native-'));
 try {
 const base=nativeCTestJob({id:'unit.parity',tests:['test/fixtures/native/smoke_test.c'],suites:['smoke'],run:{include:['smoke/passes']}});
 const old=await executeWorkflow(base,{project:project(dir)});
 assert.equal(old.status,'SUCCESS',JSON.stringify(old.errors));
 const art=old.artifacts.find(a=>a.kind==='native-test');const r=await receipt('test.parity',art.path,art.buildId);
 let builds=0;const provider={async build(){builds++;return r;}};
 const fresh=await executeWorkflow(nativeArtifactJob({id:'unit.parity',artifact:{target:'test.parity'},provider,run:{include:['smoke/passes']}}),{project:project(path.join(dir,'new'))});
 assert.equal(fresh.status,old.status,JSON.stringify(fresh.errors));assert.equal(builds,1);
 assert.deepEqual(fresh.groups.map(g=>g.cases.map(c=>[c.name,c.status])),old.groups.map(g=>g.cases.map(c=>[c.name,c.status])));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('provider errors and missing CTP identities block every downstream Native run',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-artifact-error-'));
 try{
 const fail=await executeWorkflow(nativeArtifactJob({id:'unit.failed',artifact:{target:'test.failed'},provider:{async build(){throw new Error('build deliberately failed');}}}),{project:project(dir)});
 assert.equal(fail.status,'ERROR');assert.equal(fail.steps[0].status,'ERROR');assert.notEqual(fail.steps[1]?.status,'SUCCESS');
 const file=path.join(dir,'not-executable');await writeFile(file,'not executed');const r=await receipt('test.noid',file);
 const noid=await executeWorkflow(nativeArtifactJob({id:'unit.noid',artifact:{target:'test.noid'},provider:{async build(){return r;}}}),{project:project(dir)});
 assert.equal(noid.status,'ERROR');assert.match(JSON.stringify(noid.errors),/protocolBuildId/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('MCU registers owned cleanup before flash/reset; borrowed boards remain untouched',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-board-cleanup-'));
 try{
 const file=path.join(dir,'firmware');await writeFile(file,'firmware');
 for(const stage of ['flash','reset'])for(const ownership of ['owned','borrowed']){
 let closed=0;
 const adapter={flash(){if(stage==='flash')throw new Error('flash failed');},reset(){throw new Error('reset failed');},openTransport(){throw new Error('must not open');},close(){closed++;}};
 const result=await executeWorkflow(mcuCTestJob({id:'component.cleanup',firmware:{kind:'existing',file},board:{kind:'external',adapter,ownership}}),{project:project(dir)});
 assert.equal(result.status,'ERROR');assert.equal(closed,ownership==='owned'?1:0);
 }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('MCU artifact provider consumes the same real simulated firmware and runtime as legacy builder',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-artifact-mcu-'));
 try{
 const old=await executeWorkflow(mcuCTestJob({id:'component.parity',firmware:{kind:'host-simulated',output:path.join(dir,'firmware'),sources:['test/fixtures/mcu/firmware.c']}}),{project:project(dir)});
 assert.equal(old.status,'SUCCESS',JSON.stringify(old.errors));const a=old.artifacts.find(a=>a.kind==='mcu-firmware');const r=await receipt('firmware',a.path,a.buildId);
 const fresh=await executeWorkflow(mcuArtifactJob({id:'component.parity',artifact:{target:'firmware'},provider:{async build(){return r;}}}),{project:project(path.join(dir,'new'))});
 assert.equal(fresh.status,old.status,JSON.stringify(fresh.errors));assert.deepEqual(fresh.groups.map(g=>g.cases.map(c=>c.status)),old.groups.map(g=>g.cases.map(c=>c.status)));
 }finally{await rm(dir,{recursive:true,force:true});}
});
