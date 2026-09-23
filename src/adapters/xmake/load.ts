import {readFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {validateManifest,type ManifestJob,type ManifestResource,type ProviderReference,type XmakeManifest} from "./manifest.js";
import {XmakeBuildProvider} from "./build.js";
import {testConfig,testJob} from "../../config/define.js";
import {setJobOrigin} from "../../config/provenance.js";
import {nativeArtifactJob,mcuArtifactJob} from "../../jobs/artifact.js";
import {artifactBuildStep,getArtifact,type BuildProvider} from "../../artifacts/index.js";
import {defineStep} from "../../workflow/step.js";
import {flattenWorkflow} from "../../workflow/fragment.js";
import {CautestError} from "../../model/error.js";
import {hashFile,hashBytes,stableSerialize} from "../../cache/fingerprint.js";
import type {LoadedConfig} from "../../config/load.js";
import type {McuBoardAdapter,TestJobCommonInput,WorkflowFragment,WorkflowStep,StepExecutionContext,TestJob} from "../../config/schema/index.js";
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
function lazyBoard(resource:ManifestResource,manifest:XmakeManifest):McuBoardAdapter{
 let adapter:McuBoardAdapter|undefined;
 const loaded=()=>{if(!adapter)throw new CautestError("Board was not initialized",{code:"provision_error"});return adapter;};
 return {
  async flash(artifact){
   const created=await factory(resource.provider,{projectRoot:manifest.projectRoot,options:resource.options??{},origin:resource.origin},resource.origin.file);
   if(typeof created!=="object"||created===null||!["flash","reset","openTransport"].every(k=>typeof (created as Record<string,unknown>)[k]==="function"))throw new CautestError(`${resource.origin.file}: Board provider must implement flash/reset/openTransport`,{code:"config_error"});
   adapter=created as McuBoardAdapter;await adapter.flash(artifact);
  },
  async reset(){return await loaded().reset();},
  async openTransport(options){return await loaded().openTransport(options);},
  async close(){await adapter?.close?.();adapter=undefined;},
 };
}
/** Construct real Jobs, never deserialize CLI plan JSON or function source. */
export async function loadManifest(file:string,options:{readonly provider?:BuildProvider}={}):Promise<LoadedConfig>{
 const resolved=path.resolve(file);
 let value:unknown;
 try{value=JSON.parse(await readFile(resolved,"utf8"));}catch(cause){throw new CautestError(`Cannot read Xmake manifest ${resolved}`,{code:"config_error",cause});}
 validateManifest(value);const manifest=value;
 const sourceSet=new Set(manifest.sources);
 const sourceHashes=new Map<string,string>();
 for(const source of [...sourceSet].sort())sourceHashes.set(source,await hashFile(source));
 const provider=options.provider??new XmakeBuildProvider(manifest.xmake,manifest.buildContext,sourceHashes);
 const jobs:TestJob[]=[];enableConfigSourceTracking();
 for(const declaration of manifest.jobs){
  try{
   const base=common(declaration);
   const shared={...base,provider,context:manifest.buildContext,...(declaration.buildTimeoutMs===undefined?{}:{buildTimeoutMs:declaration.buildTimeoutMs}),...(declaration.run===undefined?{}:{run:declaration.run})};
   let job:TestJob;
   if(declaration.kind==="native")job=nativeArtifactJob({...shared,artifact:{target:declaration.target!,...(declaration.output===undefined?{}:{output:declaration.output})}});
   else if(declaration.kind==="mcu"){
    const board=manifest.boards.find(r=>r.id===declaration.board);if(!board)throw new Error(`Unknown board ${declaration.board}`);
    sourceSet.add(board.provider.module);
    job=mcuArtifactJob({...shared,artifact:{target:declaration.target!,...(declaration.output===undefined?{}:{output:declaration.output})},board:{kind:"external",adapter:lazyBoard(board,manifest),ownership:board.ownership??"owned"},
     ...(declaration.reconnects===undefined?{}:{reconnects:declaration.reconnects}),...(declaration.recoverTimeouts===undefined?{}:{recoverTimeouts:declaration.recoverTimeouts})});
   }else if(declaration.kind==="workflow"){
    const raw=await factory(declaration.provider!,{projectRoot:manifest.projectRoot,origin:declaration.origin,options:declaration.options??{},artifacts:declaration.artifacts??{},getArtifact:(context:StepExecutionContext,name:string)=>getArtifact(context,name)},declaration.origin.file);
    const elements=flattenWorkflow((Array.isArray(raw)?raw:[raw]) as readonly (WorkflowStep|WorkflowFragment)[]);
    const builds=Object.entries(declaration.artifacts??{}).map(([name,ref])=>artifactBuildStep({name,ref,provider,context:manifest.buildContext,protocolRequired:false,...(declaration.buildTimeoutMs===undefined?{}:{timeoutMs:declaration.buildTimeoutMs})}));
    const first=elements.findIndex(step=>step.phase!=="prepare");const boundary=first<0?elements.length:first;
    job=testJob({...base,level:declaration.level??"integration",tags:declaration.tags??[declaration.level??"integration"],workflow:[...elements.slice(0,boundary),...builds,...elements.slice(boundary)]});
    for(const source of await collectConfigSources(pathToFileURL(declaration.provider!.module).href,declaration.provider!.module))sourceSet.add(source);
   }else{
    // An explicit unsupported Step keeps list/selection useful in mixed projects.
    // It never claims a platform is implemented and never launches a .ko as a process.
    if(!manifest.environments.some(r=>r.id===declaration.environment))throw new Error(`Unknown environment ${declaration.environment}`);
    job=testJob({...base,level:declaration.level??(declaration.kind==="kernel"?"unit":"integration"),tags:declaration.tags??[declaration.kind],workflow:[defineStep({kind:"xmakeUnsupported",name:declaration.id,phase:"build",details:{platform:declaration.kind,supported:false},execute(){throw new CautestError(`Xmake ${declaration.kind} artifact runtime is not implemented; use the existing standalone JS helper`,{code:"tooling_error"});}})]});
   }
   setJobOrigin(job,{source:declaration.origin.file,configPath:`jobs.${declaration.id} [declaration ${declaration.origin.declaration}; includes: ${declaration.origin.includeChain.join(" -> ")}]`});jobs.push(job);
  }catch(cause){throw new CautestError(`${declaration.origin.file}: jobs.${declaration.id}: ${cause instanceof Error?cause.message:String(cause)}`,{code:"config_error",cause});}
 }
 const config=testConfig({...manifest.project,jobs});
 for(const source of [...sourceSet].sort())if(!sourceHashes.has(source))sourceHashes.set(source,await hashFile(source));
 const hash=hashBytes(stableSerialize({manifest,sources:[...sourceHashes]}));
 return {config,path:resolved,dir:manifest.projectRoot,hash,sources:[...sourceHashes.keys()]};
}
