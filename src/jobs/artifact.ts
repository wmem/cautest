import type { CTestRunInput, StepExecutionContext, McuCTestJobInput, TestJob, TestJobCommonInput } from "../config/schema/index.js";
import { testJob } from "../config/define.js";
import { artifactBuildStep, getArtifact, type ArtifactRef, type BuildContext, type BuildProvider } from "../artifacts/index.js";
import { nativeRuntimeStep } from "./native.js";
import { mcuRuntimeSteps } from "./mcu.js";

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
export function nativeArtifactJob(input: ArtifactJobInput): TestJob {
  const {artifact:_artifact,provider:_provider,context:_context,buildTimeoutMs:_timeout,run,...common}=input;
  const name = input.id;
  return testJob({...common,level:input.level??"unit",tags:input.tags??[input.level??"unit"],workflow:[build(input,name),
    nativeRuntimeStep({name,...(run===undefined?{}:{run}),allowEmpty:input.policy?.allowEmpty===true,artifact:(ctx)=>getArtifact(ctx,name)})]});
}
export function mcuArtifactJob(input: ArtifactJobInput & Omit<McuCTestJobInput, "firmware">, options: {readonly onProvision?:(context:StepExecutionContext)=>void} = {}): TestJob {
  const name = input.firmwareName ?? "firmware";
  const common: TestJobCommonInput = {id:input.id,...(input.description===undefined?{}:{description:input.description}),...(input.enabled===undefined?{}:{enabled:input.enabled}),...(input.timeoutMs===undefined?{}:{timeoutMs:input.timeoutMs}),...(input.env===undefined?{}:{env:input.env}),...(input.policy===undefined?{}:{policy:input.policy})};
  return testJob({...common,level:input.level??"component",tags:input.tags??["component","mcu"],workflow:[build(input,name),...mcuRuntimeSteps(input,{...options,artifact:(ctx)=>getArtifact(ctx,name)})]});
}
