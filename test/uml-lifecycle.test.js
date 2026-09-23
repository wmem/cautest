import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Duplex} from 'node:stream';
import {startUml,collectUml} from '../dist/uml/runtime.js';
import {UmlControlChannel} from '../dist/uml/control.js';
import {defineStep} from '../dist/workflow/step.js';
import {testJob} from '../dist/config/define.js';
import {executeWorkflow} from '../dist/workflow/engine.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopped(pid){for(let i=0;i<100;i++){try{if(/\) Z /.test(await readFile(`/proc/${pid}/stat`,'utf8')))return true;}catch{return true;}await delay(10);}return false;}
// These are real OS-process lifecycle tests with an explicit Agent emulator, NOT UML acceptance.
for(const mode of ['abort','timeout','wrong-id','early-exit'])test(`UML-owned process lifecycle ${mode}: TERM-resistant descendants are reaped and logs retained`,{skip:process.platform!=='linux'},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-uml-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const script=path.join(root,'agent-emulator.mjs'),pidFile=path.join(root,'child.pid');
 // A shell fixture avoids timing two Node startups against the Ready deadline.
 // The real child ignores TERM and owns its pipes; the test still verifies group cleanup.
 await writeFile(script,`#!/bin/sh
/bin/sh -c 'trap "" TERM; echo "$$" > "${pidFile}"; echo descendant-ready; while :; do sleep 1000; done' &
child=$!
while [ ! -s "${pidFile}" ]; do sleep 0.01; done
${mode==='wrong-id'?"printf 'CAUTEST_AGENT_READY 1 wrong-image boot-1\\n' >&3":''}
${mode==='early-exit'?'exit 29':''}
wait "$child"
`);await chmod(script,0o755);
 const controller=new AbortController();const image={kernelPath:script,rootfsPath:path.join(root,'not-used.cpio'),buildId:'expected',endpoints:new Map(),cacheHit:false};
 const env={kernel:{sourceDir:'not-used'},busybox:{sourceDir:'not-used'},machine:{readyTimeoutMs:mode==='timeout'?1000:3000}};
 const start=defineStep({kind:'umlStart',name:'emulator',phase:'provision',timeoutMs:5000,async execute(context){await startUml('emulator',image,env,context);}});
 const collect=defineStep({kind:'umlLogs',name:'emulator',phase:'collect',runWhen:'always',async execute(context){return {diagnostics:await collectUml('emulator',context)};}});
 const before=Date.now();const result=await executeWorkflow(testJob({id:`unit.${mode}`,level:'unit',policy:{allowEmpty:true},workflow:[start,collect]}),{signal:controller.signal,project:{configDir:root,resultDir:path.join(root,'results')},onOutput(event){if(mode==='abort'&&event.text.includes('descendant-ready'))controller.abort(new Error('cancel-agent'));}});
 assert.equal(result.status,'ERROR',JSON.stringify(result));assert.equal(result.resources[0].state,'closed');assert.ok(result.cleanup.every(item=>item.status==='SUCCESS'));assert.equal(result.artifacts.filter(item=>item.kind==='log').length,2);assert.ok(Date.now()-before<6000,'Cancellation must not wait for the full Ready timeout');
 const pid=Number(await readFile(pidFile,'utf8'));assert.ok(await stopped(pid),'owned descendant must not continue running');
 if(mode==='wrong-id')assert.match(JSON.stringify(result.errors),/Build ID/);if(mode==='abort')assert.match(JSON.stringify(result.errors),/cancel-agent/);
});
test('UML spawn errors are collected without unhandled errors; pre-aborted start spawns nothing',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-uml-spawn-'));t.after(()=>rm(root,{recursive:true,force:true}));const image={kernelPath:path.join(root,'missing'),rootfsPath:'unused',buildId:'image',endpoints:new Map(),cacheHit:false},env={kernel:{sourceDir:'unused'},busybox:{sourceDir:'unused'}};
 const start=defineStep({kind:'umlStart',phase:'provision',async execute(context){await startUml('missing',image,env,context);}}), collect=defineStep({kind:'umlLogs',phase:'collect',runWhen:'always',async execute(context){return{diagnostics:await collectUml('missing',context)};}});
 const result=await executeWorkflow(testJob({id:'unit.spawn',level:'unit',workflow:[start,collect]}),{project:{configDir:root,resultDir:path.join(root,'results')}});assert.equal(result.status,'ERROR');assert.match(JSON.stringify(result.errors),/ENOENT/);assert.equal(result.resources[0].state,'closed');assert.ok(result.cleanup.every(item=>item.status==='SUCCESS'));
 const c=new AbortController();c.abort(new Error('already-aborted'));await assert.rejects(startUml('missing',image,env,{signal:c.signal}),/already-aborted/);
});
test('expired or cancelled control waiters cannot consume a later command response',async()=>{
 const stream=new Duplex({read(){},write(_data,_encoding,callback){callback();}}),control=new UmlControlChannel(stream);
 stream.push('CAUTEST_AGENT_READY 1 image boot\n');await control.waitReady(100);
 await assert.rejects(control.waitLine(line=>line==='VALUE',10),/超时/);
 const current=control.waitLine(line=>line==='VALUE',100);stream.push('VALUE\n');assert.equal(await current,'VALUE');
 const c=new AbortController();const pending=control.command('QUERY',line=>line==='ANSWER',100,c.signal);c.abort(new Error('cancel-command'));await assert.rejects(pending,/cancel-command/);
 const next=control.waitLine(line=>line==='ANSWER',100);stream.push('ANSWER\n');assert.equal(await next,'ANSWER');await control.close();
});

test('UML early loader failure retains host stderr even if the control pipe closes first', async t => {
 const root=await mkdtemp(path.join(tmpdir(),'ct-uml-loader-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const script=path.join(root,'loader-failure.sh');
 await writeFile(script,"#!/bin/sh\nprintf 'loader: required GLIBC_fixture not found\\n' >&2\nexit 1\n");await chmod(script,0o755);
 const image={kernelPath:script,rootfsPath:'unused',buildId:'image',endpoints:new Map(),cacheHit:false};
 const start=defineStep({kind:'umlStart',phase:'provision',async execute(context){await startUml('loader',image,{kernel:{sourceDir:'unused'},busybox:{sourceDir:'unused'}},context);}});
 const collect=defineStep({kind:'umlLogs',phase:'collect',runWhen:'always',async execute(context){return{diagnostics:await collectUml('loader',context)};}});
 const result=await executeWorkflow(testJob({id:'unit.loader',level:'unit',workflow:[start,collect]}),{project:{configDir:root,resultDir:path.join(root,'results')}});
 assert.equal(result.status,'ERROR');assert.match(result.errors[0].message,/required GLIBC_fixture not found/);
 assert.equal(result.resources[0].state,'closed');assert.ok(result.cleanup.every(item=>item.status==='SUCCESS'));
 const log=result.artifacts.find(a=>a.kind==='log'&&a.name==='loader-host-stderr');
 assert.match(await readFile(log.path,'utf8'),/required GLIBC_fixture not found/);
});
