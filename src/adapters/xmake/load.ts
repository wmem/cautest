import {staticProviderSources} from "../../config/static-sources.js";
import {expandFilePatterns} from "../../config/file-pattern.js";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {validateManifest,type ManifestJob,type ManifestResource,type ProviderReference,type XmakeManifest} from "./manifest.js";
import {physicalResourceStep} from "../../integration/resource-lock.js";
import {XmakeBuildProvider} from "./build.js";
import {testConfig,testJob} from "../../config/define.js";
import {setJobOrigin} from "../../config/provenance.js";
import {nativeArtifactJob,mcuArtifactJob} from "../../jobs/artifact.js";
import {artifactBuildStep,getArtifact,type BuildProvider} from "../../artifacts/index.js";
import {kernelArtifactJob,driverArtifactJob} from "../../jobs/kernel-artifact.js";
import {environmentValue} from "../../jobs/kernel.js";
import {flattenWorkflow} from "../../workflow/fragment.js";
import {CautestError} from "../../model/error.js";
import {hashBytes,stableSerialize} from "../../cache/fingerprint.js";
import type {LoadedConfig} from "../../config/load.js";
import type {McuBoardAdapter,TestJobCommonInput,WorkflowFragment,WorkflowStep,StepExecutionContext,TestJob,UmlKernelEnvironment} from "../../config/schema/index.js";
import {enableConfigSourceTracking,collectConfigSources} from "../../config/source-tracker.js";

function common(job:ManifestJob):TestJobCommonInput{
 const keys=["id","level","description","tags","enabled","timeoutMs","env","policy"] as const;
 return Object.fromEntries(keys.filter(k=>job[k]!==undefined).map(k=>[k,job[k]])) as unknown as TestJobCommonInput;
}
async function factory(ref:ProviderReference,args:unknown,origin:string):Promise<unknown>{
 try{
  const module=await import(pathToFileURL(ref.module).href) as Record<string,unknown>;
  const create=module[ref.export];if(typeof create!=="function")throw new Error(`export ${ref.export} is not a function`);
  return await create(args);
 }catch(cause){throw new CautestError(`${origin}: provider ${ref.module}#${ref.export}: ${cause instanceof Error?cause.message:String(cause)}`,{code:"config_error",cause});}
}
function lazyBoard(resource:ManifestResource,manifest:XmakeManifest,signal:()=>AbortSignal|undefined):McuBoardAdapter{
 let adapter:McuBoardAdapter|undefined;
 const close=async()=>{const current=adapter;adapter=undefined;await current?.close?.();};
 const loaded=()=>{if(!adapter)throw new CautestError("Board was not initialized",{code:"provision_error"});return adapter;};
 return {
  async flash(artifact){
   const created=await factory(resource.provider,{projectRoot:manifest.projectRoot,options:resource.options??{},origin:resource.origin,signal:signal()},resource.origin.file);
   if(typeof created!=="object"||created===null||!["flash","reset","openTransport"].every(k=>typeof (created as Record<string,unknown>)[k]==="function")){
    if(resource.ownership!=="borrowed"&&typeof created==="object"&&created!==null&&"close" in created&&typeof created.close==="function")await created.close();
    throw new CautestError(`${resource.origin.file}: Board provider must implement flash/reset/openTransport`,{code:"config_error"});
   }
   adapter=created as McuBoardAdapter;
   if(signal()?.aborted){if(resource.ownership!=="borrowed")await close();signal()?.throwIfAborted();}
   signal()?.throwIfAborted();
   await adapter.flash(artifact);
  },
  async reset(){return await loaded().reset();},
  async openTransport(options){return await loaded().openTransport(options);},
  close,
 };
}
/** Construct real Jobs, never deserialize CLI plan JSON or function source. */
export async function loadManifest(file:string,options:{readonly provider?:BuildProvider}={}):Promise<LoadedConfig>{
 const resolved=path.resolve(file);
 let value:unknown;
 try{value=JSON.parse(await readFile(resolved,"utf8"));}catch(cause){throw new CautestError(`Cannot read Xmake manifest ${resolved}`,{code:"config_error",cause});}
 validateManifest(value);const manifest=value;
 const sourceSet=new Set(manifest.sources);
 const provider=options.provider??new XmakeBuildProvider(manifest.xmake,manifest.buildContext);
 const jobs:TestJob[]=[];enableConfigSourceTracking();
 const snapshots=new Map<string,Promise<readonly string[]>>();
 const snapshot=async(ref:ProviderReference)=>{
  let sources=snapshots.get(ref.module);
  if(!sources){sources=staticProviderSources(ref.module);snapshots.set(ref.module,sources);}
  for(const source of await sources)sourceSet.add(source);
  if(ref.inputs?.length)for(const source of await expandFilePatterns(ref.inputs.map(input=>path.relative(manifest.projectRoot,input)),{baseDir:manifest.projectRoot,label:`${ref.module}: provider.inputs`}))sourceSet.add(path.resolve(manifest.projectRoot,source));
 };
 const environmentCache=new Map<string,Promise<UmlKernelEnvironment>>();
 const environment=async(id:string):Promise<UmlKernelEnvironment>=>{
  const resource=manifest.environments.find(r=>r.id===id);if(!resource)throw new Error(`Unknown environment ${id}`);
  let value=environmentCache.get(id);
  if(!value){value=(async()=>{
   await snapshot(resource.provider);
   const created=await factory(resource.provider,{projectRoot:manifest.projectRoot,options:resource.options??{},origin:resource.origin},resource.origin.file);
   // Environment providers are declarative factories, never booted resources.
   environmentValue(created as UmlKernelEnvironment);
   for(const source of await collectConfigSources(pathToFileURL(resource.provider.module).href,resource.provider.module))sourceSet.add(source);
   return created as UmlKernelEnvironment;
  })();environmentCache.set(id,value);}
  return await value;
 };
 for(const declaration of manifest.jobs){
  try{
   const base=common(declaration);
   const shared={...base,provider,context:manifest.buildContext,...(declaration.buildTimeoutMs===undefined?{}:{buildTimeoutMs:declaration.buildTimeoutMs}),...(declaration.run===undefined?{}:{run:declaration.run})};
   let job:TestJob;
   if(declaration.kind==="native")job=nativeArtifactJob({...shared,...(declaration.coverage===undefined?{}:{coverage:declaration.coverage}),artifact:{target:declaration.target!,...(declaration.output===undefined?{}:{output:declaration.output})}});
   else if(declaration.kind==="mcu"){
    const board=manifest.boards.find(r=>r.id===declaration.board);if(!board)throw new Error(`Unknown board ${declaration.board}`);
    await snapshot(board.provider);
    let activeContext:StepExecutionContext|undefined;
    job=mcuArtifactJob({...shared,boardName:declaration.id,artifact:{target:declaration.target!,...(declaration.output===undefined?{}:{output:declaration.output})},board:{kind:"external",adapter:lazyBoard(board,manifest,()=>activeContext?.signal),ownership:board.ownership??"owned"},
     ...(declaration.reconnects===undefined?{}:{reconnects:declaration.reconnects}),...(declaration.recoverTimeouts===undefined?{}:{recoverTimeouts:declaration.recoverTimeouts})},{onProvision(context){activeContext=context;}});
    const lock=physicalResourceStep({name:declaration.id,resourceId:board.resourceId!,...(board.lockTimeoutMs===undefined?{}:{timeoutMs:board.lockTimeoutMs})});
    job=testJob({...job,workflow:[job.workflow[0]!,lock,...job.workflow.slice(1)]});
   }else if(declaration.kind==="workflow"){
    await snapshot(declaration.provider!);
    const raw=await factory(declaration.provider!,{projectRoot:manifest.projectRoot,origin:declaration.origin,options:declaration.options??{},artifacts:declaration.artifacts??{},getArtifact:(context:StepExecutionContext,name:string)=>getArtifact(context,name)},declaration.origin.file);
    const elements=flattenWorkflow((Array.isArray(raw)?raw:[raw]) as readonly (WorkflowStep|WorkflowFragment)[]);
    const builds=Object.entries(declaration.artifacts??{}).map(([name,ref])=>artifactBuildStep({name,ref,provider,context:manifest.buildContext,protocolRequired:false,...(declaration.buildTimeoutMs===undefined?{}:{timeoutMs:declaration.buildTimeoutMs})}));
    const first=elements.findIndex(step=>step.phase!=="prepare");const boundary=first<0?elements.length:first;
    job=testJob({...base,level:declaration.level??"integration",tags:declaration.tags??[declaration.level??"integration"],workflow:[...elements.slice(0,boundary),...builds,...elements.slice(boundary)]});
    for(const source of await collectConfigSources(pathToFileURL(declaration.provider!.module).href,declaration.provider!.module))sourceSet.add(source);
   }else if(declaration.kind==="kernel"){
    job=kernelArtifactJob({...shared,environment:await environment(declaration.environment!),artifact:{target:declaration.target!,...(declaration.output===undefined?{}:{output:declaration.output})}});
   }else{
    job=driverArtifactJob({...shared,environment:await environment(declaration.environment!),drivers:declaration.drivers!,guest:declaration.guest!});
   }
   setJobOrigin(job,{source:declaration.origin.file,configPath:`jobs.${declaration.id} [declaration ${declaration.origin.declaration}; includes: ${declaration.origin.includeChain.join(" -> ")}]`});jobs.push(job);
  }catch(cause){throw new CautestError(`${declaration.origin.file}: jobs.${declaration.id}: ${cause instanceof Error?cause.message:String(cause)}`,{code:"config_error",cause});}
 }
 const config=testConfig({...manifest.project,jobs});
 const hash=hashBytes(stableSerialize({manifest}));
 return {config,path:resolved,dir:manifest.projectRoot,hash,sources:[...sourceSet]};
}
