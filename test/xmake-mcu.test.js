import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,symlink,mkdir,readFile,writeFile,appendFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url));const xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'cautest mcu 中文 '));try{await cp(path.join(kit,'examples/xmake/mcu-simulated'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');await fn(root);}finally{if(!process.env.CAUTEST_KEEP_FIXTURE)await rm(root,{recursive:true,force:true});else console.log(root);}}
function json(root,args=[],code=0){const r=spawnSync(xmake,['ct','--json',...args],{cwd:root,env,encoding:'utf8',timeout:25000,maxBuffer:16*1024*1024});assert.equal(r.status,code,r.stdout+'\n'+r.stderr);return JSON.parse(r.stdout);}
async function result(root,args=[],code=0){return JSON.parse(await readFile(json(root,args,code).resultPath,'utf8'));}
const when={skip:!xmake};
test('real Xmake MCU firmware artifact, split serial CTP, shared build and physical alias identity',when,()=>fixture(async root=>{
 json(root,['--list']);json(root,['--plan']);await assert.rejects(stat(path.join(root,'build')));
 await appendFile(path.join(root,'ctest.lua'),'\nctest.board {id="alias",resourceId="cautest.example.simulated-board",provider={module="board.mjs",export="create"},options={maxReadSize=2,maxWriteSize=1,disconnectOnce=4}}\nctest.mcu {id="integration.alias",target="firmware.simulated",board="alias",reconnects=1}\n');
 const r=await result(root,['--reporter=json,junit']);assert.equal(r.status,'SUCCESS');assert.equal(r.jobs.length,2);
 assert.equal(r.jobs.flatMap(j=>j.artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-firmware.simulated')).length,1);
 for(const j of r.jobs){assert.equal(j.groups[0].cases[0].status,'PASS');const a=j.artifacts.find(a=>a.kind==='build-artifact');assert.match(a.buildId,/^[0-9a-f]{24}$/);assert.notEqual(a.buildId,a.fingerprint);assert.equal(j.resources.find(r=>r.kind==='physical-lock').state,'closed');assert.equal(j.resources.find(r=>r.kind==='mcu-board').state,'closed');assert.match(j.cleanup.at(-1).name,/release-physical-lock/);}
 const second=await result(root,['integration.mcu']);assert.equal(second.status,'SUCCESS');
}));
test('MCU factories are lazy, owned/borrowed failure cleanup is respected, wrong HELLO build identity fails',when,()=>fixture(async root=>{
 await writeFile(path.join(root,'board.mjs'),`import {SimulatedMcuBoard} from '@cautest/config';import {appendFileSync} from 'node:fs';import path from 'node:path';\nexport function create({options,projectRoot}){const log=s=>appendFileSync(path.join(projectRoot,'lifecycle.log'),s+'\\n');log('factory');const board=new SimulatedMcuBoard();return {flash(a){log('flash');if(options.flashFail)throw new Error('injected flash failure');return board.flash(options.stale ? {...a,path:path.join(projectRoot,'stale.bin')} : a);},reset(){log('reset');const id=board.reset();return options.wrongBoot?'wrong-boot':id;},openTransport(o){log('open');return board.openTransport(o);},close(){log('close');return board.close();}};}\n`);
 const cfg=path.join(root,'ctest.lua');const base=await readFile(cfg,'utf8');
 json(root,['--list']);json(root,['--plan']);json(root,['--doctor']);await assert.rejects(stat(path.join(root,'lifecycle.log')));
 const good=await result(root);await cp(good.jobs[0].artifacts.find(a=>a.kind==='build-artifact').path,path.join(root,'stale.bin'));await writeFile(path.join(root,'lifecycle.log'),'');
 await writeFile(cfg,base.replace('maxReadSize = 2, maxWriteSize = 1','flashFail = true'));
 const failed=await result(root,[],2);assert.match(JSON.stringify(failed),/injected flash failure/);assert.equal(await readFile(path.join(root,'lifecycle.log'),'utf8'),'factory\nflash\nclose\n');assert.equal(failed.jobs[0].cleanup.at(-1).status,'SUCCESS');
 await writeFile(path.join(root,'lifecycle.log'),'');await writeFile(cfg,base.replace('ownership = "owned"','ownership = "borrowed"').replace('maxReadSize = 2, maxWriteSize = 1','flashFail = true'));
 await result(root,[],2);assert.equal(await readFile(path.join(root,'lifecycle.log'),'utf8'),'factory\nflash\n');
 await appendFile(path.join(root,'firmware.c'),'\n/* new firmware must not accept old board image */\n');
 await writeFile(cfg,base.replace('maxReadSize = 2, maxWriteSize = 1','stale = true'));
 const wrong=await result(root,[],2);assert.match(wrong.jobs[0].steps.find(s=>s.kind==='mcuCTestRun').error.message,/Build ID 不匹配/);assert.equal(wrong.jobs[0].resources.find(r=>r.kind==='physical-lock').state,'closed');
 await writeFile(cfg,base.replace('maxReadSize = 2, maxWriteSize = 1','wrongBoot = true'));
 const boot=await result(root,[],2);assert.match(boot.jobs[0].steps.find(s=>s.kind==='mcuCTestRun').error.message,/Boot ID 不匹配/);
}));
