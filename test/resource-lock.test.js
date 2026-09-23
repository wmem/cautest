import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import {acquirePhysicalResource,physicalResourceStep} from '../dist/integration/resource-lock.js';
import {testJob,defineStep,executeWorkflow} from '../dist/config/index.js';
const enabled=process.platform==='linux';
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'ct-physical-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('real flock serializes physical aliases, times out busy, cancels wait and never unlinks a held inode',{skip:!enabled},()=>fixture(async directory=>{
 const base={resourceId:'probe:shared-serial',signal:new AbortController().signal,directory};const first=await acquirePhysicalResource(base);
 try{await assert.rejects(acquirePhysicalResource({...base,timeoutMs:80}),/resource busy/);const controller=new AbortController();const wait=acquirePhysicalResource({...base,signal:controller.signal,timeoutMs:5000});setTimeout(()=>controller.abort(new Error('cancel lock wait')),40);await assert.rejects(wait,/cancel lock wait/);assert.equal((await readdir(directory)).length,1);}finally{await first.release();}
 const next=await acquirePhysicalResource(base);await next.release();await next.release();assert.equal((await readdir(directory)).length,1);
}));
test('OS lock is released when owner process is killed, without unsafe stale-PID deletion',{skip:!enabled},()=>fixture(async directory=>{
 const script=path.join(directory,'owner.mjs');await writeFile(script,`import {acquirePhysicalResource} from ${JSON.stringify(new URL('../dist/integration/resource-lock.js',import.meta.url).href)};await acquirePhysicalResource({resourceId:'probe:death',directory:${JSON.stringify(directory)},signal:new AbortController().signal});console.log('READY');setInterval(()=>{},1000);`);
 const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);try{for(let i=0;i<100&&!out.includes('READY');i++)await delay(20);assert.match(out,/READY/);child.kill('SIGKILL');const recovered=await acquirePhysicalResource({resourceId:'probe:death',directory,signal:new AbortController().signal,timeoutMs:2000});await recovered.release();}finally{child.kill('SIGKILL');}
}));
test('physical lock cleanup is last and survives a failing adapter cleanup',{skip:!enabled},()=>fixture(async root=>{
 const order=[];const resourceId=`probe:lifo:${root}`;const job=testJob({id:'unit.lock',level:'unit',workflow:[physicalResourceStep({name:'board',resourceId}),defineStep({kind:'board',phase:'provision',execute(ctx){ctx.defer(()=>{order.push('board');throw new Error('cleanup failure');},'board-close');throw new Error('flash failure');}})]});
 const r=await executeWorkflow(job,{project:{configDir:root,workDir:root,cacheDir:root,resultDir:root,generatedDir:root}});assert.equal(r.status,'ERROR');assert.deepEqual(order,['board']);assert.equal(r.cleanup.at(-1).status,'SUCCESS');assert.match(r.cleanup.at(-1).name,/release-physical-lock/);assert.equal(r.resources.find(r=>r.kind==='physical-lock').state,'closed');const reacquired=await acquirePhysicalResource({resourceId,signal:new AbortController().signal,timeoutMs:300});await reacquired.release();
}));
