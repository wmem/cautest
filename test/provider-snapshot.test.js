import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {staticProviderSources} from '../dist/config/static-sources.js';
import {loadManifest} from '../dist/adapters/xmake/load.js';
import {executeWorkflow} from '../dist/config/index.js';
import {hashFile} from '../dist/cache/fingerprint.js';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'ct snapshot 中文 '));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('static ESM snapshot follows imports/re-exports/cycles without evaluating any top-level provider code',async t=>{
 const root=await fixture(t);await mkdir(path.join(root,'sub'));
 await writeFile(path.join(root,'board.mjs'),`import 'node:fs';export {value} from './sub/shared.mjs';import '@cautest/config';throw new Error('must not execute');`);
 await writeFile(path.join(root,'sub/shared.mjs'),`import '../board.mjs';export const value=3;throw new Error('dependency also must not execute');`);
 const files=await staticProviderSources(path.join(root,'board.mjs'));assert.deepEqual(files,[path.join(root,'board.mjs'),path.join(root,'sub/shared.mjs')]);
});
test('lazy Board snapshot includes transitive ESM and explicit dynamic data; source files are provenance only; Board factories remain lazy',async t=>{
 const root=await fixture(t),module=path.join(root,'board.mjs'),dependency=path.join(root,'shared.mjs'),input=path.join(root,'settings.json');
 await writeFile(dependency,'export const value=1;\n');await writeFile(input,'{"speed":1}\n');
 await writeFile(module,`import {value} from './shared.mjs';import {appendFileSync} from 'node:fs';export function create(){appendFileSync(${JSON.stringify(path.join(root,'events'))},'factory');return {flash(){},reset(){return 'boot';},openTransport(){throw new Error('not needed');},close(){}};}`);
 const binary=path.join(root,'firmware');await writeFile(binary,'fixture');const context={projectRoot:root,plat:'linux',arch:'x86_64',mode:'release',buildDir:path.join(root,'build')};
 const origin={file:path.join(root,'ctest.lua'),declaration:1,includeChain:[]};
 const manifest={schemaVersion:1,kind:'cautest.xmake-manifest',projectRoot:root,xmake:'/unused',buildContext:context,project:{},jobs:[{kind:'mcu',id:'unit.snapshot',target:'firmware',board:'board',origin}],boards:[{kind:'board',id:'board',resourceId:'snapshot:'+root,provider:{module,export:'create',inputs:[input]},origin}],environments:[],sources:[]};
 const file=path.join(root,'manifest.json');await writeFile(file,JSON.stringify(manifest));
 const provider={async build(){return {schemaVersion:2,kind:'cautest.artifact-receipt',target:'firmware',context,protocolBuildId:'identity',outputs:[{role:'primary',path:binary,size:7}]};}};
 let previous;
 for(const changed of [dependency,input]){
  const loaded=await loadManifest(file,{provider});for(const source of [module,dependency,input])assert.ok(loaded.sources.includes(source));await assert.rejects(stat(path.join(root,'events')));
  if(previous)assert.equal(loaded.hash,previous);previous=loaded.hash;
  await writeFile(changed,changed===dependency?'export const value=2;\n':'{"speed":2}\n');
  const result=await executeWorkflow(loaded.config.jobs[0],{project:{configDir:root,resultDir:root,cacheDir:root,workDir:root,generatedDir:root}});
  assert.equal(result.status,'ERROR');assert.match(JSON.stringify(result),/not needed/);assert.doesNotMatch(JSON.stringify(result),/Definition changed during run/);assert.equal(await readFile(path.join(root,'events'),'utf8'),'factory');await rm(path.join(root,'events'));
  assert.equal(result.resources.find(r=>r.kind==='physical-lock').state,'closed');
 }
});
