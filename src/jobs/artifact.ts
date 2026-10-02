import type { CTestRunInput, StepExecutionContext, McuCTestJobInput, NativeCoverageInput, TestJob, TestJobCommonInput } from "../config/schema/index.js";
import { testJob } from "../config/define.js";
import { artifactBuildStep, getArtifact, type ArtifactRef, type BuildContext, type BuildProvider } from "../artifacts/index.js";
import { nativeRuntimeStep } from "./native.js";
import { mcuRuntimeSteps } from "./mcu.js";
import { nativeCoverageStep, validateNativeCoverage } from "./native-coverage.js";

export interface ArtifactJobInput extends TestJobCommonInput {
  readonly artifact: ArtifactRef;
  readonly provider: BuildProvider;
  readonly context?: BuildContext;
  readonly buildTimeoutMs?: number;
  readonly run?: CTestRunInput;
}
function build(input: ArtifactJobInput, name: string) {
  return artifactBuildStep({name, ref: input.artifact, provider: input.provider,
    ...(input.context === undefined ? {} : {context:input.context}),
    ...(input.buildTimeoutMs === undefined ? {} : {timeoutMs:input.buildTimeoutMs})});
}
export interface NativeArtifactJobInput extends ArtifactJobInput { readonly coverage?: NativeCoverageInput }
export function nativeArtifactJob(input: NativeArtifactJobInput): TestJob {
  const {artifact:_artifact,provider:_provider,context:_context,buildTimeoutMs:_timeout,run,coverage,...common}=input;
  if (coverage !== undefined) validateNativeCoverage(coverage);
  const name = input.id;
  return testJob({...common,level:input.level??"unit",tags:input.tags??[input.level??"unit"],workflow:[build(input,name),
    nativeRuntimeStep({name,...(run===undefined?{}:{run}),allowEmpty:input.policy?.allowEmpty===true,
      artifact:(ctx)=>({...getArtifact(ctx,name),coverage:coverage!==undefined})}),
    ...(coverage===undefined?[]:[nativeCoverageStep({name,coverage,async notes(ctx){
      let artifact;
      try { artifact=getArtifact(ctx,name); } catch { return undefined; }
      return artifact.receipt.outputs.filter(output=>output.role.startsWith("gcov-note-")).map(output=>({path:output.path,sha256:output.sha256}));
    }})])]});
}
export function mcuArtifactJob(input: ArtifactJobInput & Omit<McuCTestJobInput, "firmware">, options: {readonly onProvision?:(context:StepExecutionContext)=>void} = {}): TestJob {
  const name = input.firmwareName ?? "firmware";
  const common: TestJobCommonInput = {id:input.id,...(input.description===undefined?{}:{description:input.description}),...(input.enabled===undefined?{}:{enabled:input.enabled}),...(input.timeoutMs===undefined?{}:{timeoutMs:input.timeoutMs}),...(input.env===undefined?{}:{env:input.env}),...(input.policy===undefined?{}:{policy:input.policy})};
  return testJob({...common,level:input.level??"component",tags:input.tags??["component","mcu"],workflow:[build(input,name),...mcuRuntimeSteps(input,{...options,artifact:(ctx)=>getArtifact(ctx,name)})]});
}
