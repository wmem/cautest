import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {validateManifest} from '../dist/adapters/xmake/manifest.js';
import {loadManifest} from '../dist/adapters/xmake/load.js';
const root=process.cwd();
const origin={file:path.join(root,'ctest.lua'),declaration:1,includeChain:[path.join(root,'ctest.lua')]};
const manifest=()=>({schemaVersion:1,kind:'cautest.xmake-manifest',projectRoot:root,xmake:'/bin/xmake',buildContext:{projectRoot:root,plat:'linux',arch:'x86_64',mode:'release',buildDir:path.join(root,'build')},project:{},jobs:[{kind:'native',id:'unit.ok',target:'test.ok',origin}],boards:[],environments:[],sources:[]});
test('Xmake manifest rejects plan JSON, unsupported versions, unknown and incomplete fields',()=>{
 const good=manifest();assert.doesNotThrow(()=>validateManifest(good));
 const bad=[{...good,kind:'plan'},{...good,schemaVersion:99},{...good,extra:true},{...good,buildContext:{...good.buildContext,arch:undefined}},{...good,jobs:[{...good.jobs[0],macroScan:true}]},{...good,jobs:[{...good.jobs[0],target:undefined}]},{...good,jobs:[{...good.jobs[0],run:{session:{typo:100}}}]}];
 for(const value of bad)assert.throws(()=>validateManifest(value));
});
test('Xmake Manifest v3 validates Native coverage and still reads legacy v1 without building',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-manifest-gcov-'));
 try{const good={...manifest(),schemaVersion:3};good.jobs=[{...good.jobs[0],coverage:{tool:'gcov',timeoutMs:30000}}];assert.doesNotThrow(()=>validateManifest(good));
 for(const coverage of [true,null,{tool:''},{timeoutMs:0},{unexpected:true}])assert.throws(()=>validateManifest({...good,jobs:[{...good.jobs[0],coverage}]}),/coverage/);
 assert.throws(()=>validateManifest({...good,schemaVersion:1}),/Manifest v3/);
 const file=path.join(dir,'manifest.json');await writeFile(file,JSON.stringify(good));const loaded=await loadManifest(file,{provider:{async build(){throw new Error('must not build while loading');}}});
 assert.deepEqual(loaded.config.jobs[0].workflow.map(s=>s.kind),['artifactBuild','cTestRun','nativeCoverage']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Xmake manifest duplicates identify both origins; driver outputs are explicit references',()=>{
 const good=manifest();assert.throws(()=>validateManifest({...good,jobs:[good.jobs[0],{...good.jobs[0],origin:{...origin,file:'/other/test.lua'}}]}),/ctest.lua.*other\/test.lua/);
 const driver={kind:'driver',id:'integration.driver',environment:'uml',drivers:[{target:'driver.spi',output:'ko'}],guest:{target:'guest.spi'},origin};
 assert.doesNotThrow(()=>validateManifest({...good,jobs:[driver]}));
 assert.throws(()=>validateManifest({...good,jobs:[{...driver,guest:undefined}]}));
});
test('Xmake loader constructs existing workflows, preserves Lua provenance and does not build during load',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-manifest-'));
 try{const file=path.join(dir,'manifest.json');await writeFile(file,JSON.stringify(manifest()));let builds=0;
 const loaded=await loadManifest(file,{provider:{async build(){builds++;throw new Error('must not build during load');}}});
 assert.equal(builds,0);assert.equal(loaded.dir,root);assert.deepEqual(loaded.config.jobs[0].workflow.map(s=>s.kind),['artifactBuild','cTestRun']);
 const {getJobOrigin}=await import('../dist/config/provenance.js');assert.match(getJobOrigin(loaded.config.jobs[0]).source,/ctest.lua$/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('MCU board factories stay lazy for list/plan and validate named resources',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ct-lazy-board-'));
 try{const module=path.join(dir,'board.mjs');await writeFile(module,'throw new Error("MUST_NOT_IMPORT_BOARD_WHILE_LISTING");');const file=path.join(dir,'manifest.json');const value=manifest();value.jobs=[{kind:'mcu',id:'component.spi',target:'fw',board:'board',origin}];value.boards=[{kind:'board',id:'board',resourceId:'fixture-probe',provider:{module,export:'create'},origin}];await writeFile(file,JSON.stringify(value));assert.equal((await loadManifest(file)).config.jobs[0].id,'component.spi');value.boards=[];await writeFile(file,JSON.stringify(value));await assert.rejects(loadManifest(file),/Unknown board/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
