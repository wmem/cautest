import {withBuildLock} from "../../cache/build-lock.js";
import path from "node:path";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { stableSerialize } from "../../cache/fingerprint.js";
import { assertCompatibleContext, object, resolveArtifact, validateBuildContext, type ArtifactReceipt, type ArtifactRef, type BuildContext, type BuildProvider } from "../../artifacts/index.js";
import type { StepExecutionContext } from "../../config/schema/common.js";
import {CAUTEST_VERSIONS} from "../../config/versions.js";
import { CautestError } from "../../model/error.js";
import { effectiveEnvironment } from "../../runtime/environment.js";
import { runCommand } from "../../runtime/process.js";

async function atomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive:true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value,null,2)}\n`);
  await rename(temporary,file);
}
/** A run-scoped build session, not a replacement for Xmake's incremental compiler cache. */
export class XmakeBuildProvider implements BuildProvider {
  readonly #builds = new Map<string, Promise<ArtifactReceipt>>();
  readonly #environments = new Map<string,string>();
  readonly #outputs = new Map<string,{target:string;gcovNote:boolean}>();
  #context: BuildContext;
  readonly program: string;
  readonly #testConfig: string | undefined;
  readonly #workingDirectory: string;
  constructor(program: string, context: BuildContext) {
    this.program=program; this.#context=context;
    this.#testConfig=process.env.CAUTEST_XMAKE_CONFIG;
    this.#workingDirectory=process.env.CAUTEST_XMAKE_WORKINGDIR??context.projectRoot;
  }
  async build(ref: ArtifactRef, context: StepExecutionContext): Promise<ArtifactReceipt> {
    context.signal.throwIfAborted();
    const environment=stableSerialize(context.job.env);
    const previous=this.#environments.get(ref.target);
    if(previous!==undefined&&previous!==environment) throw new CautestError(`Conflicting build env for target ${ref.target}; use explicitly isolated Xmake targets/configurations`,{code:"build_error"});
    this.#environments.set(ref.target,environment);
    const key=ref.target; // one fixed Xmake configuration per session; output role does not rebuild a target
    let pending=this.#builds.get(key);
    if(pending===undefined){pending=this.#build(ref,context);this.#builds.set(key,pending);}
    const receipt=await pending;
    await resolveArtifact(receipt,ref,this.#context,false);
    return receipt;
  }
  async #build(ref: ArtifactRef, context: StepExecutionContext): Promise<ArtifactReceipt> {
    // Other hosts retain the existing behavior; only Linux has a verified
    // cross-process transaction contract. Do not silently claim host parity.
    if (process.platform !== "linux") return await this.#buildLocked(ref, context);
    return await withBuildLock(path.join(this.#context.projectRoot, ".cautest/xmake/session"), context.signal, () => this.#buildLocked(ref, context));
  }
  async #buildLocked(ref: ArtifactRef, context: StepExecutionContext): Promise<ArtifactReceipt> {
    const directory=path.join(context.project.resultDir,context.job.id);
    await mkdir(directory,{recursive:true});
    const name=ref.target.replace(/[^A-Za-z0-9_.-]/gu,"-");
    const log=path.join(directory,`xmake-${name}.log`);
    const description=path.join(directory,`xmake-${name}-${randomUUID()}.json`);
    const chunks:string[]=[];
    const command=async(args:readonly string[])=>{
      // Xmake 从子目录启动时可能选择父工程，cwd 不能替代显式 -P。
      // 构建和查询必须读取同一配置，Job/Profile 的环境不能改变配置选择。
      const environment=effectiveEnvironment(context);
      if(this.#testConfig!==undefined)environment.CAUTEST_XMAKE_CONFIG=this.#testConfig;
      else delete environment.CAUTEST_XMAKE_CONFIG;
      // -P 支持独立工作目录；子进程保留父 Xmake 的配置目录和构建目录语义。
      environment.CAUTEST_XMAKE_WORKINGDIR=this.#workingDirectory;
      const result=await runCommand({program:this.program,args:[args[0]!,"-P",this.#context.projectRoot,...args.slice(1)],cwd:this.#workingDirectory,env:environment,signal:context.signal,
        onOutput(channel,text){chunks.push(`[${channel}] ${text}`);context.output(channel,text);}});
      if(result.exitCode!==0) throw new CautestError(`Xmake ${args[0]} failed (exit ${result.exitCode}) for ${ref.target}\n${result.stderr || result.stdout}`,{code:"build_error"});
    };
    try{
      await command(["build","-y",ref.target]);
      context.signal.throwIfAborted();
      await command(["cautest-artifact",`--target=${ref.target}`,`--output-file=${description}`]);
      const raw=object(JSON.parse(await readFile(description,"utf8")),["schemaVersion","kind","target","context","protocolBuildId","outputs"],"Artifact description");
      if(raw.schemaVersion!==1||raw.kind!=="cautest.artifact-description"||raw.target!==ref.target)throw new CautestError("Invalid Xmake artifact description",{code:"build_error"});
      validateBuildContext(raw.context);assertCompatibleContext(this.#context,raw.context);
      this.#context=raw.context;
      if(!Array.isArray(raw.outputs)||raw.outputs.length===0)throw new CautestError("Missing Xmake outputs",{code:"build_error"});
      const outputs=[];
      for(const candidate of raw.outputs){
        const item=object(candidate,["role","path"],"Output description");
        if(typeof item.role!=="string"||typeof item.path!=="string"||!path.isAbsolute(item.path))throw new CautestError("Invalid Xmake output path/role",{code:"build_error"});
        const owner=this.#outputs.get(item.path);
        const gcovNote=/^gcov-note-[0-9]+$/u.test(item.role)&&item.path.endsWith(".gcno");
        // 已插桩的共享库 gcno 可被多个消费者只读引用；可执行文件等其他输出仍禁止冲突。
        if(owner!==undefined&&owner.target!==ref.target&&!(owner.gcovNote&&gcovNote))throw new CautestError(`Xmake targets ${owner.target} and ${ref.target} collide at ${item.path}`,{code:"build_error"});
        this.#outputs.set(item.path,{target:ref.target,gcovNote});
        const info=await stat(item.path);
        if(!info.isFile())throw new CautestError(`Xmake output is not a file: ${item.path}`,{code:"build_error"});
        outputs.push({role:item.role,path:item.path,size:info.size});
      }
      const receipt:ArtifactReceipt={schemaVersion:CAUTEST_VERSIONS.schemas.artifactReceipt,kind:"cautest.artifact-receipt",target:ref.target,context:this.#context,outputs,
        ...(raw.protocolBuildId===undefined?{}:{protocolBuildId:raw.protocolBuildId as string})};
      await resolveArtifact(receipt,ref,this.#context,false);
      await atomic(path.join(directory,`receipt-${name}.json`),receipt);
      return receipt;
    }catch(cause){
      if(cause instanceof CautestError)throw cause;
      throw new CautestError(`Xmake artifact build failed: ${ref.target}: ${cause instanceof Error?cause.message:String(cause)}`,{code:"build_error",cause});
    }finally{
      await writeFile(log,chunks.join(""));
      context.artifacts.publish({kind:"log",name:`xmake-${name}`,path:log});
    }
  }
}
