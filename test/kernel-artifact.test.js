import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,copyFile} from 'node:fs/promises';
import {hashFile} from '../dist/cache/fingerprint.js';
import {resolveArtifact} from '../dist/artifacts/index.js';
import {captureKernelContext,assertKernelContext,consumeKernelModule,consumeDriverGuest} from '../dist/kernel/artifact-context.js';
import {driverArtifactJob,kernelArtifactJob,umlKernelEnvironment,testJob,defineStep,executeWorkflow} from '../dist/config/index.js';
import {loadManifest} from '../dist/adapters/xmake/load.js';

const kit=fileURLToPath(new URL('..',import.meta.url));
function cc(root,args){const r=spawnSync('cc',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);}
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'ct-kernel-artifact-'));try{
 const kernel=path.join(root,'kernel');await mkdir(path.join(kernel,'include/config'),{recursive:true});
 await writeFile(path.join(kernel,'.config'),'CONFIG_UML=y\nCONFIG_64BIT=y\n');await writeFile(path.join(kernel,'Module.symvers'),'fixture-symbols\n');await writeFile(path.join(kernel,'include/config/kernel.release'),'unit-release\n');await copyFile('/bin/true',path.join(kernel,'linux'));
 const identity=await captureKernelContext(kernel);
 await writeFile(path.join(root,'kernel-context.json'),JSON.stringify(identity));
 await writeFile(path.join(root,'module.c'),'__attribute__((section(".modinfo"))) const char version[]="vermagic=unit-release SMP ";\nint fixture(void){return 7;}\n');cc(root,['-c','module.c','-o','fixture.ko']);
 await writeFile(path.join(root,'Module.symvers'),'fixture-symbol\n');await writeFile(path.join(root,'modules.order'),'fixture.ko\n');
 await writeFile(path.join(root,'guest.c'),'int main(void){return 0;}\n');cc(root,['-static','guest.c','-o','guest']);cc(root,['guest.c','-o','dynamic']);
 const buildContext={projectRoot:root,buildDir:path.join(root,'build'),plat:'linux',arch:'x86_64',mode:'release'};
 async function receipt(target,outputs,protocolBuildId){return {schemaVersion:2,kind:'cautest.artifact-receipt',target,context:buildContext,...(protocolBuildId?{protocolBuildId}:{}),outputs:await Promise.all(Object.entries(outputs).map(async([role,file])=>{const absolute=path.join(root,file);return {role,path:absolute,size:(await stat(absolute)).size};}))};}
 const moduleReceipt=await receipt('driver',{ko:'fixture.ko',symbols:'Module.symvers',order:'modules.order','kernel-context':'kernel-context.json'});
 const guestReceipt=await receipt('guest',{primary:'guest'},'fixture-ctp-id');
 await fn({root,kernel,identity,buildContext,receipt,moduleReceipt,guestReceipt});
 }finally{await rm(root,{recursive:true,force:true});}}

test('Kernel context and explicit module roles reject mismatched configurations, releases and executable masquerades',()=>fixture(async f=>{
 const artifact=await resolveArtifact(f.moduleReceipt,{target:'driver',output:'ko'},f.buildContext,false);
 assert.equal((await consumeKernelModule(artifact,f.identity,'driver-1')).module,artifact.path);
 assert.throws(()=>assertKernelContext({...f.identity,configState:{...f.identity.configState,mtimeNs:'0'}},f.identity),/context mismatch/);
 assert.throws(()=>assertKernelContext(f.identity,{...f.identity,schemaVersion:1}),/schema/);
 for(const role of ['symbols','order','kernel-context'])await assert.rejects(consumeKernelModule({...artifact,receipt:{...artifact.receipt,outputs:artifact.receipt.outputs.filter(x=>x.role!==role)}},f.identity,'driver-1'),/missing output role/);
 await writeFile(path.join(f.root,'kernel-context.json'),JSON.stringify({...f.identity,release:'other-release'}));
 await assert.rejects(consumeKernelModule(artifact,f.identity,'driver-1'),/context mismatch/);
 await writeFile(path.join(f.root,'kernel-context.json'),JSON.stringify(f.identity));
 const wrong={...f.identity,release:'other-release'};await writeFile(path.join(f.root,'kernel-context.json'),JSON.stringify(wrong));
 await assert.rejects(consumeKernelModule(artifact,wrong,'driver-1'),/vermagic/);
 await writeFile(path.join(f.root,'kernel-context.json'),JSON.stringify(f.identity));
 await copyFile(path.join(f.root,'guest'),path.join(f.root,'fixture.ko'));
 await assert.rejects(consumeKernelModule(artifact,f.identity,'driver-1'),/ET_REL/);
}));

test('Driver Guest validation accepts a real static ELF and rejects dynamic executables, modules and malformed headers',()=>fixture(async f=>{
 const artifact=await resolveArtifact(f.guestReceipt,{target:'guest'},f.buildContext,true);
 assert.equal((await consumeDriverGuest(artifact,'driver-guest')).buildId,'fixture-ctp-id');
 await assert.rejects(consumeDriverGuest({...artifact,path:path.join(f.root,'dynamic')},'guest'),/statically linked/);
 await assert.rejects(consumeDriverGuest({...artifact,path:path.join(f.root,'fixture.ko')},'guest'),/executable/);
 await assert.rejects(consumeDriverGuest({...artifact,buildId:''},'guest'),/protocolBuildId/);
 const bytes=await readFile(artifact.path);bytes.writeBigUInt64LE(0xffffffffffffffffn,32);await writeFile(path.join(f.root,'broken'),bytes);
 await assert.rejects(consumeDriverGuest({...artifact,path:path.join(f.root,'broken')},'guest'),/program headers/);
}));

test('Artifact Driver build phases consume separate refs, inject one Kernel context and build real cpio without booting a mock Kernel',()=>fixture(async f=>{
 const calls=[];const provider={async build(ref,context){calls.push({ref,env:context.job.env});return ref.target==='driver'?f.moduleReceipt:f.guestReceipt;}};
 const environment=umlKernelEnvironment({kernel:{sourceDir:f.kernel},busybox:{sourceDir:'not-used'}});
 const job=driverArtifactJob({id:'integration.artifact',environment,provider,context:f.buildContext,drivers:[{target:'driver',output:'ko'}],guest:{target:'guest'},policy:{allowEmpty:true}});
 const seed=defineStep({kind:'fixtureSeed',phase:'build',execute(context){context.state.set('kernelOutput',f.kernel);context.state.set('busybox',{path:'/usr/bin/busybox',buildId:'fixture-busybox',cacheHit:false});return {};}});
 // These are artifact/Rootfs contract tests. The synthetic Kernel is deliberately NEVER booted.
 const result=await executeWorkflow(testJob({...job,workflow:[seed,...job.workflow.slice(2,8)]}),{project:{configDir:f.root}});
 assert.equal(result.status,'SKIP',JSON.stringify(result));assert.ok(result.steps.every(s=>s.status==='SUCCESS'));
 assert.equal(calls[0].env.CAUTEST_KERNEL_BUILD,f.kernel);assert.equal(calls[0].env.CAUTEST_KERNEL_ARCH,'um');assert.equal(calls[1].env.CAUTEST_KERNEL_BUILD,undefined);
 assert.equal(result.artifacts.filter(a=>a.kind==='kernel-module').length,1);assert.equal(result.artifacts.filter(a=>a.kind==='guest-program').length,1);assert.ok(result.artifacts.some(a=>a.kind==='uml-image'));
 assert.deepEqual(job.workflow.slice(-3).map(s=>s.kind),['umlStart','cTestRun','umlLogs']);
 const kernelJob=kernelArtifactJob({id:'unit.artifact',environment,provider,artifact:{target:'driver'}});assert.ok(kernelJob.workflow.some(s=>s.name==='cautest_kernel'));assert.equal(kernelJob.workflow.find(s=>s.kind==='cTestRun').details.endpoint,'kernel');
 assert.throws(()=>driverArtifactJob({id:'bad',environment,provider,drivers:[{target:'driver'},{target:'driver',output:'ko'}],guest:{target:'guest'}}),/Duplicate/);
}));

test('Artifact failure stops before rootfs/provision and a conflicting Kernel env cannot override the shared Environment',()=>fixture(async f=>{
 const environment=umlKernelEnvironment({kernel:{sourceDir:f.kernel},busybox:{sourceDir:'unused'}});let calls=0;
 const provider={async build(){calls++;throw new Error('injected-module-failure');}};
 const seed=defineStep({kind:'fixtureSeed',phase:'build',execute(context){context.state.set('kernelOutput',f.kernel);context.state.set('busybox',{path:'/usr/bin/busybox',buildId:'fixture',cacheHit:false});return {};}});
 for(const env of [{},{CAUTEST_KERNEL_BUILD:'/wrong'}]){
  const job=driverArtifactJob({id:'integration.failure',environment,provider,drivers:[{target:'driver'}],guest:{target:'guest'},env});
  const result=await executeWorkflow(testJob({...job,workflow:[seed,...job.workflow.slice(2)]}),{project:{configDir:f.root}});
  assert.equal(result.status,'ERROR');assert.equal(result.steps.find(s=>s.kind==='umlStart').status,'SKIPPED');assert.equal(result.steps.at(-1).status,'SUCCESS');
  assert.match(JSON.stringify(result),env.CAUTEST_KERNEL_BUILD?/Reserved environment variable/:/injected-module-failure/);
 }
 assert.equal(calls,1);
}));

test('Named Environment factory is declarative, reused once, source-tracked and validated with Lua provenance',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-env-loader-'));try{
  const factory=path.join(root,'environment.mjs'),dependency=path.join(root,'settings.mjs');
  await writeFile(dependency,'export const machine={memory:"128M"};\n');
  await writeFile(factory,`import {umlKernelEnvironment} from ${JSON.stringify(path.join(kit,'dist/config/index.js'))};\nimport {machine} from './settings.mjs';export let calls=0;export function create({projectRoot}){calls++;return umlKernelEnvironment({kernel:{sourceDir:projectRoot+'/linux'},busybox:{sourceDir:projectRoot+'/busybox'},machine});}\n`);
  const origin={file:path.join(root,'ctest.lua'),declaration:1,includeChain:[]};await writeFile(origin.file,'-- declarations\n');
  const manifest={schemaVersion:1,kind:'cautest.xmake-manifest',projectRoot:root,xmake:'/bin/xmake',buildContext:{projectRoot:root,buildDir:path.join(root,'build'),plat:'linux',arch:'x86_64',mode:'release'},project:{},sources:[origin.file],boards:[],environments:[{kind:'environment',id:'uml',provider:{module:factory,export:'create'},origin}],jobs:[{kind:'kernel',id:'unit.kernel',target:'kernel-test',environment:'uml',origin},{kind:'driver',id:'integration.driver',drivers:[{target:'driver',output:'ko'}],guest:{target:'guest'},environment:'uml',origin}]};
  const file=path.join(root,'manifest.json');await writeFile(file,JSON.stringify(manifest));let builds=0;
  const loaded=await loadManifest(file,{provider:{async build(){builds++;throw new Error('unexpected build');}}});
  assert.equal(builds,0);assert.equal((await import(factory)).calls,1);assert.ok(loaded.sources.includes(dependency));assert.ok(loaded.config.jobs.every(j=>j.workflow.some(s=>s.kind==='umlStart')));
  assert.ok(!loaded.config.jobs.some(j=>j.workflow.some(s=>s.kind==='xmakeUnsupported')));
  manifest.environments[0].provider.export='missing';await writeFile(file,JSON.stringify(manifest));await assert.rejects(loadManifest(file),/ctest.lua.*provider.*missing/);
 }finally{await rm(root,{recursive:true,force:true});}
});
