import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {hashFile} from '../dist/cache/fingerprint.js';import {loadManifest} from '../dist/adapters/xmake/load.js';import {executeWorkflow} from '../dist/config/index.js';

test('MCU owned/borrowed flash/reset/open failures and timeouts preserve cleanup and close late transports',{skip:process.platform!=='linux'},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-mcu-failures-'));t.after(()=>rm(root,{recursive:true,force:true}));const binary=path.join(root,'firmware');await writeFile(binary,'artifact');
 const buildContext={projectRoot:root,plat:'linux',arch:'x86_64',mode:'release',buildDir:path.join(root,'build')};
 const receipt={schemaVersion:1,kind:'cautest.artifact-receipt',target:'firmware',context:buildContext,protocolBuildId:'identity',outputs:[{role:'primary',path:binary,size:8,sha256:await hashFile(binary)}]};
 for(const ownership of ['owned','borrowed'])for(const mode of ['flash','reset','open','flash-timeout','reset-timeout','open-timeout','invalid','cleanup-fail']){
  const prefix=ownership+'-'+mode,log=path.join(root,prefix+'.log'),module=path.join(root,prefix+'.mjs');
  await writeFile(module,`import {appendFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';const log=v=>appendFileSync(${JSON.stringify(log)},v+'\\n');
const mode=${JSON.stringify(mode)};export function create(){log('factory');const close=()=>{log('board-close');if(mode==='cleanup-fail')throw new Error('injected cleanup failure');};if(mode==='invalid')return {close};
return {async flash(){log('flash');if(mode==='flash'||mode==='cleanup-fail')throw new Error('injected flash failure');if(mode==='flash-timeout')await delay(900);},async reset(){log('reset');if(mode==='reset')throw new Error('injected reset failure');if(mode==='reset-timeout')await delay(900);return 'boot';},async openTransport(){log('open');if(mode==='open')throw new Error('injected open failure');if(mode==='open-timeout'){await delay(900);log('transport-created');return {open(){log('transport-open');},close(){log('transport-close');},read(){throw new Error('must not read');},write(){throw new Error('must not write');}};}throw new Error('unexpected transport');},close};}`);
  const origin={file:path.join(root,'ctest.lua'),declaration:1,includeChain:[]};const manifest={schemaVersion:1,kind:'cautest.xmake-manifest',projectRoot:root,xmake:'/unused',buildContext,project:{},jobs:[{kind:'mcu',id:'unit.failure',target:'firmware',board:'board',origin}],boards:[{kind:'board',id:'board',resourceId:'failure:'+root,ownership,provider:{module,export:'create'},origin}],environments:[],sources:[]};
  const file=path.join(root,prefix+'.json');await writeFile(file,JSON.stringify(manifest));const loaded=await loadManifest(file,{provider:{async build(){return receipt;}}});
  const result=await executeWorkflow(loaded.config.jobs[0],{defaultStepTimeoutMs:400,project:{configDir:root,resultDir:root,cacheDir:root,workDir:root,generatedDir:root}});
  assert.equal(result.status,'ERROR',prefix);await delay(mode.endsWith('timeout')?1000:25);
  const events=(await readFile(log,'utf8')).trim().split('\n');assert.equal(events.filter(e=>e==='board-close').length,ownership==='owned'?1:0,prefix+' '+events.join(','));
  assert.equal(result.resources.find(r=>r.kind==='physical-lock').state,'closed',prefix);assert.equal(result.cleanup.at(-1).status,'SUCCESS',prefix);
  if(mode==='flash'||mode==='flash-timeout'||mode==='invalid'||mode==='cleanup-fail')assert.ok(!events.includes('reset'),prefix);
  if(mode==='reset'||mode==='reset-timeout')assert.ok(!events.includes('open'),prefix);
  if(mode==='open-timeout'){assert.ok(events.includes('transport-created'));assert.equal(events.filter(e=>e==='transport-close').length,1,prefix);assert.ok(!events.includes('transport-open'));}
  if(mode==='cleanup-fail'&&ownership==='owned')assert.ok(result.cleanup.some(c=>c.status==='ERROR'));
 }
});
