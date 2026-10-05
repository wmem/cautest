import path from "node:path";
import { stat } from "node:fs/promises";
import type { StepExecutionContext, WorkflowStep } from "../config/schema/common.js";
import { stableSerialize } from "../cache/fingerprint.js";
import { CautestError } from "../model/error.js";
import { defineStep } from "../workflow/step.js";

import { CAUTEST_VERSIONS } from "../config/versions.js";
export const ARTIFACT_RECEIPT_VERSION = CAUTEST_VERSIONS.schemas.artifactReceipt;
export interface ArtifactRef { readonly target: string; readonly output?: string }
export interface BuildContext {
  readonly projectRoot: string;
  readonly plat: string;
  readonly arch: string;
  readonly mode: string;
  readonly buildDir: string;
}
export interface ArtifactOutput { readonly role: string; readonly path: string; readonly size: number; }
export interface ArtifactReceipt {
  readonly schemaVersion: 2;
  readonly kind: "cautest.artifact-receipt";
  readonly target: string;
  readonly context: BuildContext;
  readonly protocolBuildId?: string;
  readonly outputs: readonly ArtifactOutput[];
}
export interface BuildProvider {
  /** Called only in a build Step. A provider may share a same-context build within one run. */
  build(ref: ArtifactRef, context: StepExecutionContext): Promise<ArtifactReceipt>;
}
export interface ResolvedArtifact { readonly path: string; readonly buildId: string; readonly receipt: ArtifactReceipt; readonly output: ArtifactOutput }
function fail(message: string): never { throw new CautestError(message, { code: "build_error" }); }
export function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  const invalid = Object.keys(value).filter((key) => !fields.includes(key));
  if (invalid.length) fail(`${label}: unknown fields: ${invalid.join(", ")}`);
  return value as Record<string, unknown>;
}
export function validateBuildContext(value: unknown): asserts value is BuildContext {
  const v = object(value, ["projectRoot", "plat", "arch", "mode", "buildDir"], "BuildContext");
  for (const key of ["projectRoot", "plat", "arch", "mode", "buildDir"]) if (typeof v[key] !== "string" || !(v[key] as string).length) fail(`BuildContext.${key} must be a nonempty string`);
  if (!path.isAbsolute(v.projectRoot as string) || !path.isAbsolute(v.buildDir as string)) fail("BuildContext paths must be absolute");
}
export function validateArtifactRef(value: unknown): asserts value is ArtifactRef {
  const v = object(value, ["target", "output"], "ArtifactRef");
  if (typeof v.target !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.:+-]*$/u.test(v.target)) fail("ArtifactRef.target must be an explicit Xmake target name");
  if (v.output !== undefined && (typeof v.output !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(v.output))) fail("ArtifactRef.output must be a role name");
}
export function assertCompatibleContext(expected: BuildContext, actual: BuildContext): void {
  validateBuildContext(expected); validateBuildContext(actual);
  for (const key of ["projectRoot", "plat", "arch", "mode", "buildDir"] as const) if (actual[key] !== expected[key]) fail(`Build context mismatch (${key}): expected ${expected[key]}, received ${actual[key]}`);
}
/** 校验产物角色、构建上下文和文件存在性；不读取二进制内容。 */
export async function resolveArtifact(value: unknown, ref: ArtifactRef, expected?: BuildContext, protocolRequired = true): Promise<ResolvedArtifact> {
  validateArtifactRef(ref);
  const v = object(value, ["schemaVersion", "kind", "target", "context", "protocolBuildId", "outputs"], "ArtifactReceipt");
  if (v.schemaVersion !== ARTIFACT_RECEIPT_VERSION || v.kind !== "cautest.artifact-receipt") fail("Unsupported ArtifactReceipt schema/kind");
  if (v.target !== ref.target) fail(`Receipt target mismatch: ${String(v.target)} != ${ref.target}`);
  validateBuildContext(v.context);
  if (expected !== undefined) assertCompatibleContext(expected, v.context);
  if (v.protocolBuildId !== undefined && (typeof v.protocolBuildId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(v.protocolBuildId))) fail("Invalid protocolBuildId");
  if (protocolRequired && v.protocolBuildId === undefined) fail("CTP Artifact requires protocolBuildId; a file hash is NOT a HELLO identity");
  if (!Array.isArray(v.outputs) || v.outputs.length === 0) fail("Receipt outputs must be a nonempty array");
  const roles = new Set<string>();
  for (const candidate of v.outputs) {
    const output = object(candidate, ["role", "path", "size"], "ArtifactOutput");
    if (typeof output.role !== "string" || !output.role.length || roles.has(output.role)) fail("Duplicate or missing output role");
    roles.add(output.role);
    if (typeof output.path !== "string" || !path.isAbsolute(output.path)) fail("Artifact output path must be absolute");
    if (!Number.isSafeInteger(output.size) || (output.size as number) < 0) fail("Invalid artifact size");
    try {
      const info = await stat(output.path);
      if (!info.isFile()) fail(`Artifact missing: ${output.path}`);
    } catch (cause) { if (cause instanceof CautestError) throw cause; throw new CautestError(`Artifact inaccessible: ${output.path}`, { code: "build_error", cause }); }
  }
  const receipt = value as ArtifactReceipt;
  const output = receipt.outputs.find((item) => item.role === (ref.output ?? "primary"));
  if (output === undefined) fail(`Missing output role ${ref.output ?? "primary"} on ${ref.target}`);
  return Object.freeze({ path: output.path, buildId: receipt.protocolBuildId ?? "", receipt, output });
}
const slot = (name: string) => `cautest:artifact:${name}`;
export function getArtifact(context: StepExecutionContext, name: string): ResolvedArtifact {
  const artifact = context.state.get(slot(name)) as ResolvedArtifact | undefined;
  if (artifact === undefined) fail(`Artifact has not been built/resolved: ${name}`);
  return artifact;
}
export function artifactBuildStep(input: { readonly name: string; readonly ref: ArtifactRef; readonly provider: BuildProvider; readonly context?: BuildContext; readonly timeoutMs?: number; readonly protocolRequired?: boolean }): WorkflowStep {
  validateArtifactRef(input.ref);
  return defineStep({
    kind: "artifactBuild", name: input.name, phase: "build",
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    details: { provider: "xmake", artifact: input.ref, ...(input.context === undefined ? {} : { context: input.context }) },
    async execute(context) {
      const receipt = await input.provider.build(input.ref, context);
      const artifact = await resolveArtifact(receipt, input.ref, input.context, input.protocolRequired ?? true);
      context.state.set(slot(input.name), artifact);
      context.artifacts.publish({ kind: "build-artifact", name: input.name, path: artifact.path, ...(artifact.buildId ? { buildId: artifact.buildId } : {}), metadata: { receipt } });
      return { diagnostics: [{ code: "artifact_ready", message: artifact.path, context: stableSerialize(receipt.context) }] };
    },
  });
}
