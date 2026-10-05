import path from "node:path";
import { CAUTEST_VERSIONS } from "../../config/versions.js";
import { CautestError } from "../../model/error.js";
import { validateArtifactRef, validateBuildContext, type BuildContext } from "../../artifacts/index.js";
import type { CTestRunInput, TestConfigDefaultsInput, TestProfileInput, TestJobCommonInput } from "../../config/schema/common.js";
import type { NativeCoverageInput } from "../../config/schema/native.js";
import { validateNativeCoverage } from "../../jobs/native-coverage.js";
export const XMAKE_MANIFEST_VERSION=CAUTEST_VERSIONS.schemas.xmakeManifest;
export interface ProviderReference {readonly module:string;readonly export:string;readonly inputs?:readonly string[]}
export interface Origin {readonly file:string;readonly declaration:number;readonly includeChain:readonly string[]}
export interface ManifestJob extends TestJobCommonInput {
 readonly kind:"native"|"mcu"|"kernel"|"driver"|"workflow";
 readonly origin:Origin;
 readonly target?:string;readonly output?:string;readonly run?:CTestRunInput;readonly buildTimeoutMs?:number;
 readonly coverage?:NativeCoverageInput;
 readonly provider?:ProviderReference;readonly options?:Readonly<Record<string,unknown>>;
 readonly artifacts?:Readonly<Record<string,{readonly target:string;readonly output?:string}>>;
 readonly board?:string;readonly environment?:string;readonly drivers?:readonly {readonly target:string;readonly output?:string}[];
 readonly guest?:{readonly target:string;readonly output?:string};
 readonly reconnects?:number;readonly recoverTimeouts?:boolean;
}
export interface ManifestResource {readonly kind:"board"|"environment";readonly id:string;readonly provider:ProviderReference;readonly options?:Readonly<Record<string,unknown>>;readonly origin:Origin;readonly ownership?:"owned"|"borrowed";readonly resourceId?:string;readonly lockTimeoutMs?:number}
export interface XmakeManifest {
 readonly schemaVersion:1|3;readonly kind:"cautest.xmake-manifest";readonly projectRoot:string;readonly xmake:string;readonly buildContext:BuildContext;
 readonly project:{readonly defaults?:TestConfigDefaultsInput;readonly profiles?:readonly TestProfileInput[]};
 readonly jobs:readonly ManifestJob[];readonly boards:readonly ManifestResource[];readonly environments:readonly ManifestResource[];readonly sources:readonly string[];
}
export function record(value:unknown,fields:readonly string[]|undefined,label:string):Record<string,unknown>{
 if(typeof value!=="object"||value===null||Array.isArray(value))throw new CautestError(`${label} must be an object`,{code:"config_error"});
 if(fields){const invalid=Object.keys(value).filter(k=>!fields.includes(k));if(invalid.length)throw new CautestError(`${label}: unknown fields: ${invalid.join(", ")}`,{code:"config_error"});}
 return value as Record<string,unknown>;
}
function fail(message:string):never{throw new CautestError(message,{code:"config_error"});}
function absolute(value:unknown,label:string):asserts value is string{if(typeof value!=="string"||!path.isAbsolute(value))fail(`${label} must be absolute`);}
function strings(value:unknown,label:string):asserts value is readonly string[]{if(!Array.isArray(value)||value.some(x=>typeof x!=="string"||!x.length))fail(`${label} must be a string array`);}
function origin(value:unknown):asserts value is Origin{const v=record(value,["file","declaration","includeChain"],"origin");absolute(v.file,"origin.file");if(!Number.isInteger(v.declaration)||(v.declaration as number)<1)fail("origin.declaration must be positive");strings(v.includeChain,"origin.includeChain");}
function provider(value:unknown,label:string):asserts value is ProviderReference{const v=record(value,["module","export","inputs"],label);if(v.inputs!==undefined){strings(v.inputs,`${label}.inputs`);for(const input of v.inputs)absolute(input,`${label}.inputs`);}absolute(v.module,`${label}.module`);if(typeof v.export!=="string"||!v.export.length)fail(`${label}.export is required`);}
export function validateRun(value:unknown,label:string):asserts value is CTestRunInput{
 const v=record(value,["include","exclude","suite","case","parameter","caseTimeoutMs","runTimeoutMs","session","suitePolicy","expectedBuildId","stepTimeoutMs"],label);
 for(const key of ["include","exclude","suite","case","parameter"]){if(v[key]===undefined)continue;if(["suite","case","parameter"].includes(key)&&typeof v[key]==="string"&&v[key])continue;strings(v[key],`${label}.${key}`);}
 for(const key of ["caseTimeoutMs","runTimeoutMs","stepTimeoutMs"]){if(v[key]!==undefined&&(typeof v[key]!=="number"||!Number.isFinite(v[key])||v[key]<=0))fail(`${label}.${key} must be positive`);}
 if(v.session!==undefined){const s=record(v.session,["connect","handshake","discovery","run","drain","close"],`${label}.session`);for(const n of Object.values(s))if(typeof n!=="number"||!Number.isFinite(n)||n<=0)fail(`${label}.session values must be positive`);}
 if(v.suitePolicy!==undefined&&!["CONTINUE","STOP_ON_FAIL","STOP_ON_ERROR"].includes(v.suitePolicy as string))fail(`${label}.suitePolicy is invalid`);
 if(v.expectedBuildId!==undefined&&(typeof v.expectedBuildId!=="string"||!v.expectedBuildId.length))fail(`${label}.expectedBuildId is invalid`);
}
export function validateManifest(value:unknown):asserts value is XmakeManifest{
 const v=record(value,["schemaVersion","kind","projectRoot","xmake","buildContext","project","jobs","boards","environments","sources"],"Xmake manifest");
 if((v.schemaVersion!==XMAKE_MANIFEST_VERSION&&v.schemaVersion!==1)||v.kind!=="cautest.xmake-manifest")fail("Unsupported Xmake execution manifest; CLI plan JSON is not executable input");
 absolute(v.projectRoot,"projectRoot");absolute(v.xmake,"xmake");
 try{validateBuildContext(v.buildContext);}catch(e){fail(`Invalid buildContext: ${e instanceof Error?e.message:String(e)}`);}
 if(v.buildContext.projectRoot!==v.projectRoot)fail("buildContext projectRoot mismatch");
 record(v.project,["defaults","profiles"],"project");strings(v.sources,"sources");for(const file of v.sources)absolute(file,"source");
 if(!Array.isArray(v.jobs))fail("jobs must be an array");
 const common=["kind","origin","id","level","description","tags","enabled","timeoutMs","env","policy","run","buildTimeoutMs"];
 const kinds:Record<string,readonly string[]>={native:["target","output","coverage"],mcu:["target","output","board","reconnects","recoverTimeouts"],kernel:["target","output","environment"],driver:["drivers","guest","environment"],workflow:["provider","options","artifacts"]};
 const ids=new Map<string,string>();
 for(const raw of v.jobs){
  const first=record(raw,undefined,"job");origin(first.origin);const label=`${first.origin.file}: jobs.${String(first.id)}`;
  if(typeof first.kind!=="string"||kinds[first.kind]===undefined)fail(`${label}: unknown job kind`);
  const job=record(raw,[...common,...kinds[first.kind]!],label);
  if(typeof job.id!=="string"||!job.id.length)fail(`${label}: id is required`);
  if(ids.has(job.id))fail(`Duplicate Job ID ${job.id}: ${ids.get(job.id)} and ${label}`);ids.set(job.id,label);
  if(job.run!==undefined)validateRun(job.run,`${label}.run`);
  if(job.coverage!==undefined){if(v.schemaVersion===1)fail(`${label}: coverage requires Xmake Manifest v3`);try{validateNativeCoverage(job.coverage);}catch(e){fail(`${label}: ${e instanceof Error?e.message:String(e)}`);}}
  if(job.buildTimeoutMs!==undefined&&(typeof job.buildTimeoutMs!=="number"||!Number.isFinite(job.buildTimeoutMs)||job.buildTimeoutMs<=0))fail(`${label}.buildTimeoutMs must be positive`);
  try{
   if(["native","mcu","kernel"].includes(first.kind))validateArtifactRef({target:job.target,...(job.output===undefined?{}:{output:job.output})});
   if(first.kind==="driver"){if(!Array.isArray(job.drivers)||!job.drivers.length)fail(`${label}.drivers must be nonempty`);for(const ref of job.drivers)validateArtifactRef(ref);validateArtifactRef(job.guest);}
   if(first.kind==="workflow"){provider(job.provider,`${label}.provider`);if(job.options!==undefined)record(job.options,undefined,`${label}.options`);if(job.artifacts!==undefined){for(const ref of Object.values(record(job.artifacts,undefined,`${label}.artifacts`)))validateArtifactRef(ref);}}
  }catch(e){fail(`${label}: ${e instanceof Error?e.message:String(e)}`);}
  for(const key of ["board","environment"]){if((["mcu"].includes(first.kind)&&key==="board")||(["kernel","driver"].includes(first.kind)&&key==="environment")){if(typeof job[key]!=="string"||!job[key])fail(`${label}.${key} is required`);}}
  if(job.reconnects!==undefined&&(!Number.isInteger(job.reconnects)||(job.reconnects as number)<0))fail(`${label}.reconnects is invalid`);
  if(job.recoverTimeouts!==undefined&&typeof job.recoverTimeouts!=="boolean")fail(`${label}.recoverTimeouts is invalid`);
 }
 for(const [key,kind] of [["boards","board"],["environments","environment"]] as const){
  if(!Array.isArray(v[key]))fail(`${key} must be an array`);const names=new Set<string>();
  for(const raw of v[key]){const r=record(raw,["id","kind","provider","options","origin","ownership","resourceId","lockTimeoutMs"],kind);origin(r.origin);if(r.kind!==kind||typeof r.id!=="string"||!r.id.length||names.has(r.id))fail(`Invalid/duplicate ${kind} ID`);names.add(r.id);provider(r.provider,`${r.origin.file}: ${kind}.${r.id}`);if(r.options!==undefined)record(r.options,undefined,`${kind}.options`);if(r.ownership!==undefined&&r.ownership!=="owned"&&r.ownership!=="borrowed")fail("Invalid resource ownership");if(kind==="board"&&r.resourceId===undefined)fail("board.resourceId is required: aliases must share the same physical ID");if(r.lockTimeoutMs!==undefined&&(typeof r.lockTimeoutMs!=="number"||!Number.isFinite(r.lockTimeoutMs)||r.lockTimeoutMs<=0))fail("Invalid lockTimeoutMs");if(r.resourceId!==undefined&&(typeof r.resourceId!=="string"||!r.resourceId.length))fail("Invalid resourceId");}
 }
}
