import type {CTestRunInput, StepExecutionContext, UmlKernelEnvironmentInput, WorkflowStep} from "../config/schema/index.js";
import {CautestError} from "../model/error.js";
import {effectiveWorkflowCTestRun, workflowSessionResult} from "../protocol/workflow-session.js";
import {collectUml, runUmlEndpoint, startUml, type UmlImageArtifact} from "../uml/runtime.js";
import {defineStep} from "../workflow/step.js";

/** Shared by standalone builders and external-artifact Kernel/Driver jobs. */
export function umlRuntimeSteps(input: {
  readonly name: string;
  readonly environment: Readonly<UmlKernelEnvironmentInput>;
  readonly endpoint: string;
  readonly label: string;
  readonly run?: CTestRunInput;
  readonly allowEmpty?: boolean;
  readonly transportDetail?: boolean;
  readonly coverageDir?: (context: StepExecutionContext) => string;
}): {readonly start: WorkflowStep; readonly run: WorkflowStep; readonly collect: WorkflowStep} {
  const {name, environment} = input;
  function image(context: StepExecutionContext, code: "provision_error" | "transport_error"): UmlImageArtifact {
    const value = context.state.get(`image:${name}`) as UmlImageArtifact | undefined;
    if (value === undefined) throw new CautestError("UML Image Artifact 不存在", {code});
    return value;
  }
  const start = defineStep({
    kind: "umlStart", name, phase: "provision", details: {...environment.machine},
    ...(environment.machine?.startTimeoutMs === undefined ? {} : {timeoutMs: environment.machine.startTimeoutMs}),
    async execute(context) {
      const resource = await startUml(name, image(context, "provision_error"), environment, context, input.coverageDir?.(context));
      return {diagnostics: [{code: "uml_ready", message: `pid=${resource.child.pid}`}]};
    },
  });
  const run = defineStep({
    kind: "cTestRun", name, phase: "run",
    details: {...(input.transportDetail ? {transport: "uml"} : {}), endpoint: input.endpoint, selection: input.run ?? {}},
    ...(input.run?.stepTimeoutMs === undefined ? {} : {timeoutMs: input.run.stepTimeoutMs}),
    async execute(context) {
      const effectiveRun = effectiveWorkflowCTestRun(context, input.run ?? {}, name);
      const session = await runUmlEndpoint(name, input.endpoint, image(context, "transport_error"), effectiveRun, context);
      return workflowSessionResult(session, {label: input.label, allowEmpty: input.allowEmpty === true});
    },
  });
  const collect = defineStep({
    kind: "umlLogs", name, phase: "collect", runWhen: "always", details: {},
    ...(environment.machine?.collectTimeoutMs === undefined ? {} : {timeoutMs: environment.machine.collectTimeoutMs}),
    async execute(context) { return {diagnostics: await collectUml(name, context)}; },
  });
  return {start, run, collect};
}
