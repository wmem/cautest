import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, mkdir, symlink, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPortableTree, readBuildInfo, verifyPortableTree} from '../dist/portable.js';

const kit=fileURLToPath(new URL('..',import.meta.url)),xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function command(program,args,options={}) {
 const r=spawnSync(program,args,{env,encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024,...options});
 assert.equal(r.status,0,r.stdout+r.stderr+String(r.error??''));return r;
}

test('source and relocated portable Board providers resolve a project npm package and a real N-API native addon lazily', {skip:!xmake}, async t=>{
 const base=await mkdtemp(path.join(tmpdir(),'ct-native-addon-中文-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const headers=process.env.CAUTEST_NODE_INCLUDE??path.resolve(process.execPath,'../../include/node');
 await stat(path.join(headers,'node_api.h')); // Required precondition; no synthetic PASS when unavailable.
 for(const portable of [false,true]) {
  const root=path.join(base,portable?'relocated portable':'source');
  await cp(path.join(kit,'examples/xmake/mcu-simulated'),root,{recursive:true});
  await mkdir(path.join(root,'tools'));
  if(portable){await createPortableTree(path.join(root,'tools/cautest'),await readBuildInfo());await assert.rejects(stat(path.join(root,'tools/cautest/dist')));await assert.rejects(stat(path.join(root,'tools/cautest/node_modules')));}
  else await symlink(kit,path.join(root,'tools/cautest'),'dir');
  const addon=path.join(root,'node_modules/fixture-addon');await mkdir(addon,{recursive:true});
  await writeFile(path.join(addon,'package.json'),JSON.stringify({name:'fixture-addon',version:'1.0.0',main:'index.cjs'}));
  await writeFile(path.join(addon,'index.cjs'),`const native=require('./binding.node');module.exports=()=>native.answer();\n`);
  await writeFile(path.join(root,'binding.c'),`#define NAPI_VERSION 1
#include <node_api.h>
static napi_value answer(napi_env env,napi_callback_info info){napi_value v;(void)info;if(napi_create_int32(env,42,&v)!=napi_ok)return 0;return v;}
static napi_value init(napi_env env,napi_value exports){napi_value fn;if(napi_create_function(env,"answer",NAPI_AUTO_LENGTH,answer,0,&fn)!=napi_ok)return 0;if(napi_set_named_property(env,exports,"answer",fn)!=napi_ok)return 0;return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
`);
  command('cc',['-shared','-fPIC','-I',headers,'-o',path.join(addon,'binding.node'),path.join(root,'binding.c')]);
  await writeFile(path.join(root,'board.mjs'),`import value from 'fixture-addon';import {SimulatedMcuBoard} from '@cautest/config';import {appendFileSync} from 'node:fs';import path from 'node:path';export function create({options,projectRoot}){const n=value();if(n!==42)throw new Error('N-API value mismatch');appendFileSync(path.join(projectRoot,'native-events'),'native:'+n+'\\n');return new SimulatedMcuBoard(options);}\n`);
  const cfg=path.join(root,'ctest.lua');await writeFile(cfg,(await readFile(cfg,'utf8')).replace('export = "create"','export = "create", inputs = {"node_modules/fixture-addon/*.cjs", "node_modules/fixture-addon/*.node"}'));
  for(const action of ['list','plan','doctor'])command(xmake,['ct',`--${action}`,'--json'],{cwd:root});
  await assert.rejects(stat(path.join(root,'native-events')));await assert.rejects(stat(path.join(root,'build')));
  const summary=JSON.parse(command(xmake,['ct','--json','--reporter=json,junit'],{cwd:root}).stdout);
  const result=JSON.parse(await readFile(summary.resultPath,'utf8'));assert.equal(result.status,'SUCCESS');assert.equal(result.jobs[0].groups[0].cases[0].status,'PASS');
  assert.equal(await readFile(path.join(root,'native-events'),'utf8'),'native:42\n');
  assert.equal(result.jobs[0].resources.find(r=>r.kind==='mcu-board').state,'closed');
  if(portable)await verifyPortableTree(path.join(root,'tools/cautest'));
 }
});
