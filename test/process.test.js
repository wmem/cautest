import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runCommand} from '../dist/runtime/process.js';
const delay = (ms) => new Promise(r=>setTimeout(r,ms));
test('command abort kills a POSIX process group, including TERM-resistant grandchildren', {skip:process.platform!=='linux'}, async()=>{
 const controller=new AbortController(); let pid; let output='';
 const script=`const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)`;
 const result=runCommand({program:process.execPath,args:['-e',script],cwd:process.cwd(),signal:controller.signal,onOutput:(_c,s)=>{output+=s;pid=Number(output.trim());}});
 for(let i=0;i<100 && !pid;i++)await delay(10);
 assert.ok(pid); await delay(60); controller.abort(new Error('cancel-tree'));
 await assert.rejects(result,/cancel-tree/);
 let alive=true;
 for(let i=0;i<100 && alive;i++){
  try { const text=await readFile(`/proc/${pid}/stat`,'utf8'); alive=!/\) Z /.test(text); }catch{alive=false;}
  if(alive)await delay(10);
 }
 assert.equal(alive,false,'descendant must not keep running');
});
test('already aborted commands never start; spawn failure and nonzero exits are preserved',async()=>{
 const c=new AbortController();c.abort(new Error('preabort'));
 await assert.rejects(runCommand({program:process.execPath,args:[],cwd:process.cwd(),signal:c.signal}),/preabort/);
 await assert.rejects(runCommand({program:'/not/a/command',args:[],cwd:process.cwd(),signal:new AbortController().signal}),/ENOENT/);
 const r=await runCommand({program:process.execPath,args:['-e','process.exit(17)'],cwd:process.cwd(),signal:new AbortController().signal});assert.equal(r.exitCode,17);
});
