import {spawn} from "node:child_process";
import {mkdir,open} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {CautestError} from "../model/error.js";
import {defineStep} from "../workflow/step.js";
import type {StepExecutionContext,WorkflowStep} from "../config/schema/common.js";
export interface PhysicalResourceLock {readonly resourceId:string;readonly file:string;release():Promise<void>}
/** Linux flock owns the lock, not a stale PID file. Never unlink lockfiles. */
export async function acquirePhysicalResource(options:{readonly resourceId:string;readonly signal:AbortSignal;readonly directory?:string;readonly timeoutMs?:number;readonly flock?:string}):Promise<PhysicalResourceLock>{
 if(process.platform!=="linux")throw new CautestError("Physical resource locks currently require Linux flock",{code:"tooling_error"});
 if(!options.resourceId||!Number.isFinite(options.timeoutMs??30000)||(options.timeoutMs??30000)<=0)throw new CautestError("Invalid physical resource ID/lock timeout",{code:"config_error"});
 options.signal.throwIfAborted();
 const directory=path.resolve(options.directory??process.env.CAUTEST_LOCK_DIR??path.join(os.tmpdir(),`cautest-resource-locks-${process.getuid?.()??"user"}`));
 await mkdir(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,`${createHash("sha256").update(options.resourceId).digest("hex")}.lock`);
 const fd=await open(file,"a",0o600);await fd.close();options.signal.throwIfAborted();
 const child=spawn(options.flock??"flock",["--exclusive",`--wait=${(options.timeoutMs??30000)/1000}`,"--conflict-exit-code=73",file,process.execPath,"-e","process.stdin.resume();process.stdout.write('LOCKED\\n');"],{stdio:["pipe","pipe","pipe"],detached:true});
 let stdout="",stderr="",acquired=false,released=false,spawnError:Error|undefined;
 const kill=()=>{if(child.pid!==undefined)try{process.kill(-child.pid,"SIGKILL");}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;}};
 const abort=()=>kill();
 const ended=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>{child.once("error",error=>{spawnError=error;});child.once("close",(code,signal)=>resolve({code,signal}));});
 child.stdin.on("error",()=>{});child.stderr.on("data",buffer=>{stderr+=String(buffer);});
 const ready=new Promise<void>((resolve,reject)=>{
  child.stdout.on("data",buffer=>{stdout+=String(buffer);if(stdout.includes("LOCKED\n")&&!acquired){acquired=true;options.signal.removeEventListener("abort",abort);resolve();}});
  void ended.then(({code})=>{options.signal.removeEventListener("abort",abort);if(!acquired)reject(options.signal.aborted?options.signal.reason:new CautestError(code===73?`Physical resource busy: ${options.resourceId}; lock wait expired after ${options.timeoutMs??30000}ms`:`Cannot acquire physical resource ${options.resourceId}: ${spawnError?.message??stderr??code}`,{code:"provision_error"}));});
 });
 options.signal.addEventListener("abort",abort,{once:true});if(options.signal.aborted)abort();await ready;
 const lock=Object.freeze({resourceId:options.resourceId,file,async release(){
  if(released)return;released=true;child.stdin.end();let timer:ReturnType<typeof setTimeout>|undefined;
  try{const outcome=await Promise.race([ended,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{kill();reject(new CautestError(`Physical resource lock release timed out: ${options.resourceId}`,{code:"provision_error"}));},2000);})]);if(outcome.code!==0)throw new CautestError(`Physical resource lock ended unexpectedly: ${options.resourceId} (${outcome.code??outcome.signal})`,{code:"provision_error"});}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }});
 if(options.signal.aborted){await lock.release();options.signal.throwIfAborted();}
 return lock;
}
export function physicalResourceStep(options:{readonly name:string;readonly resourceId:string;readonly timeoutMs?:number;readonly onAcquired?:(context:StepExecutionContext)=>void}):WorkflowStep{
 return defineStep({kind:"physicalResourceLock",name:options.name,phase:"provision",details:{resourceId:options.resourceId,tool:"flock"},...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs+1000}),async execute(context){
  const lock=await acquirePhysicalResource({resourceId:options.resourceId,signal:context.signal,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})});
  context.defer(async()=>{try{await lock.release();}finally{context.resources.close("physical-lock",options.name);}},`release-physical-lock:${options.name}`);
  context.resources.publish({kind:"physical-lock",name:options.name,metadata:{resourceId:options.resourceId,lockFile:lock.file}});options.onAcquired?.(context);
  return {diagnostics:[{code:"physical_resource_locked",resourceId:options.resourceId}]};
 }});
}
