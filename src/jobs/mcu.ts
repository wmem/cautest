import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McuBoardAdapter, McuCTestJobInput, TestJob, StepExecutionContext, WorkflowStep } from "../config/schema/index.js";
import { CAUTEST_CACHE_VERSIONS } from "../config/versions.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { runCtpSession } from "../protocol/native-session.js";
import { effectiveWorkflowCTestRun, workflowSessionEventSink, workflowSessionResult } from "../protocol/workflow-session.js";
import { SimulatedMcuBoard } from "../integration/mcu-simulated.js";
import { declaredEnvironment, effectiveEnvironment } from "../runtime/environment.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const kitSources = ["core/cautest.c", "protocol/ctp3.c", "platform/freestanding/cautest_freestanding.c", "target/mcu-reference/mcu_reference.c", "target/mcu-reference/mcu_sim_target.c"];
export interface FirmwareArtifact { readonly path: string; readonly buildId: string }
interface BoardState { readonly kind: "simulated" | "external"; readonly bootId: string; readonly adapter: McuBoardAdapter }

async function boardSession(options: {
  readonly state: BoardState;
  readonly artifact: FirmwareArtifact;
  readonly run: NonNullable<McuCTestJobInput["run"]>;
  readonly serial?: Readonly<Record<string, unknown>>;
  readonly reconnects: number;
  readonly recoverTimeouts: boolean;
  readonly context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0];
  readonly callbacks: Pick<Parameters<typeof runCtpSession>[0], "onEvent" | "onLog">;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.reconnects; attempt += 1) {
    try {
      return await runCtpSession({ transport: await options.state.adapter.openTransport(options.serial), expectedBuildId: options.artifact.buildId, expectedBootId: options.state.bootId, run: options.run, signal: options.context.signal, ...options.callbacks });
    } catch (error) {
      lastError = error;
      const recoverable = error instanceof CautestError && (error.code === "transport_error" || (options.recoverTimeouts && error.code === "timeout_error"));
      if (!recoverable || attempt >= options.reconnects) throw error;
      options.context.events.emit("MCU_RECONNECT", { jobId: options.context.job.id, attempt: attempt + 1, reason: error.code, bootId: options.state.bootId });
    }
  }
  throw lastError;
}

async function firmware(input: McuCTestJobInput, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0]): Promise<FirmwareArtifact> {
  const specification = input.firmware;
  let output: string;
  if (specification.kind === "existing") output = path.resolve(context.project.configDir, specification.file);
  else if (specification.kind === "command") {
    output = path.resolve(context.project.configDir, specification.output);
    const result = await runCommand({ program: specification.program, args: specification.args ?? [], cwd: path.resolve(context.project.configDir, specification.cwd ?? "."), env: effectiveEnvironment(context, specification.env), signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`MCU Firmware 命令失败 (exit ${result.exitCode})`, { code: "build_error" });
  } else {
    output = path.resolve(context.project.configDir, specification.output);
    const sources = await expandFilePatterns(specification.sources, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.sources` });
    const headers = specification.headers === undefined ? [] : await expandFilePatterns(specification.headers, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.headers` });
    const bytes = await Promise.all([
      ...[...sources, ...headers].map((file) => readFile(path.join(context.project.configDir, file))),
      readFile(path.join(kitRoot, "include/cautest/version.h")),
      ...kitSources.map((file) => readFile(path.join(kitRoot, file))),
    ]);
    const compiler = specification.compiler ?? "cc";
    const environment = effectiveEnvironment(context, specification.env);
    const version = await runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: environment, signal: context.signal });
    const buildId = createHash("sha256").update(version.stdout).update(Buffer.concat(bytes)).update(JSON.stringify({ schema: CAUTEST_CACHE_VERSIONS.mcuFingerprint, cflags: specification.cflags ?? [], environment: declaredEnvironment(context, specification.env) })).digest("hex").slice(0, 24);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(context.project.workDir, { recursive: true });
    const includeDirs = [...new Set(headers.map((header) => path.dirname(path.join(context.project.configDir, header))))];
    const result = await runCommand({ program: compiler, args: ["-std=c99", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/freestanding")}`, `-I${path.join(kitRoot, "target/mcu-reference")}`, ...includeDirs.map((directory) => `-I${directory}`), `-DCAUTEST_MCU_BUILD_ID=\"${buildId}\"`, ...(specification.cflags ?? []), ...sources.map((source) => path.join(context.project.configDir, source)), ...kitSources.map((source) => path.join(kitRoot, source)), "-o", output], cwd: context.project.workDir, env: environment, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`Host MCU Firmware 编译失败 (exit ${result.exitCode})`, { code: "build_error" });
    await chmod(output, 0o755);
    return Object.freeze({ path: output, buildId });
  }
  const contents = await readFile(output);
  const fingerprintInputs = specification.fingerprintInputs ?? {};
  return Object.freeze({ path: output, buildId: createHash("sha256").update(contents).update(JSON.stringify({ schema: CAUTEST_CACHE_VERSIONS.mcuFingerprint, fingerprintInputs })).digest("hex").slice(0, 24) });
}

/** Existing and external artifact builds share these exact Board/CTP/cleanup steps. */
export function mcuRuntimeSteps(input: Omit<McuCTestJobInput, "firmware">, options: {
  readonly artifact: (context: StepExecutionContext) => FirmwareArtifact | undefined;
}): readonly WorkflowStep[] {
  const firmwareName = input.firmwareName ?? "firmware";
  const boardName = input.boardName ?? "board";
  const board = defineStep({
    kind: "mcuBoardStart", name: boardName, phase: "provision", details: { kind: input.board?.kind ?? "simulated" },
    async execute(context) {
      const artifact = options.artifact(context);
      if (artifact === undefined) throw new CautestError("Firmware Artifact 不存在", { code: "provision_error" });
      const boardInput = input.board;
      const kind = boardInput?.kind ?? "simulated";
      const adapter = boardInput?.kind === "external" ? boardInput.adapter : new SimulatedMcuBoard(boardInput?.kind === "simulated" ? boardInput : {});
      const ownership = boardInput?.kind === "external" ? boardInput.ownership ?? "owned" : "owned";
      if (ownership !== "borrowed") context.defer(async () => await adapter.close?.(), `close-mcu-board:${boardName}`);
      await adapter.flash(artifact);
      const bootId = await adapter.reset();
      if (typeof bootId !== "string" || bootId.length === 0) throw new CautestError("MCU Reset 必须返回非空 Boot ID", { code: "provision_error" });
      context.state.set(`board:${boardName}`, Object.freeze({ kind, bootId, adapter }) satisfies BoardState);
      context.resources.publish({ kind: "mcu-board", name: boardName, handle: adapter, metadata: { kind, bootId, ownership } });
      return { diagnostics: [{ code: "board_ready", message: boardName }] };
    },
  });
  const run = defineStep({
    kind: "mcuCTestRun", name: boardName, phase: "run", details: { selection: input.run ?? {} }, ...(input.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: input.run.stepTimeoutMs }),
    async execute(context) {
      const artifact = options.artifact(context);
      const state = context.state.get(`board:${boardName}`) as BoardState | undefined;
      if (artifact === undefined || state === undefined) throw new CautestError("Firmware/Board 未准备", { code: "provision_error" });
      const logDir = path.join(context.project.resultDir, "mcu", boardName);
      const targetFile = path.join(logDir, `${boardName}.target.log`);
      const stdoutFile = path.join(logDir, `${boardName}.stdout.log`);
      const stderrFile = path.join(logDir, `${boardName}.stderr.log`);
      const targetLogs: string[] = [];
      const effectiveRun = effectiveWorkflowCTestRun(context, input.run ?? {}, boardName);
      await mkdir(logDir, { recursive: true });
      const callbacks = {
        onEvent: workflowSessionEventSink(context.events, context.job.id),
        onLog(log: Parameters<NonNullable<Parameters<typeof runCtpSession>[0]["onLog"]>>[0]) { targetLogs.push(`[${log.level}] ${log.scope}: ${log.message}`); return `${targetFile}:${targetLogs.length}`; },
      };
      try {
        const serialOptions = state.kind === "simulated"
          ? { ...(input.serial?.options ?? {}), cwd: path.resolve(context.project.configDir, input.serial?.cwd ?? "."), env: effectiveEnvironment(context, input.serial?.env) }
          : input.serial?.options;
        const session = await boardSession({ state, artifact, run: effectiveRun, ...(serialOptions === undefined ? {} : { serial: serialOptions }), reconnects: input.reconnects ?? 0, recoverTimeouts: input.recoverTimeouts ?? false, context, callbacks });
        return workflowSessionResult(session, { label: "MCU C Test", allowEmpty: input.policy?.allowEmpty === true });
      } finally {
        if (state.kind === "simulated" && state.adapter instanceof SimulatedMcuBoard) {
          await Promise.all([
            writeFile(stdoutFile, state.adapter.logs.filter((item) => item.channel === "stdout").map((item) => item.text).join("")),
            writeFile(stderrFile, state.adapter.logs.filter((item) => item.channel === "stderr").map((item) => item.text).join("")),
          ]);
        }
        await writeFile(targetFile, `${targetLogs.join("\n")}${targetLogs.length === 0 ? "" : "\n"}`);
        if (!context.artifacts.has("log", `${boardName}-target`)) context.artifacts.publish({ kind: "log", name: `${boardName}-target`, path: targetFile, metadata: { source: "ctp-target", board: state.kind } });
        if (state.kind === "simulated") {
          if (!context.artifacts.has("log", `${boardName}-stdout`)) context.artifacts.publish({ kind: "log", name: `${boardName}-stdout`, path: stdoutFile, metadata: { source: "process-stdout" } });
          if (!context.artifacts.has("log", `${boardName}-stderr`)) context.artifacts.publish({ kind: "log", name: `${boardName}-stderr`, path: stderrFile, metadata: { source: "process-stderr" } });
        }
      }
    },
  });
  const collect = defineStep({ kind: "mcuLogs", name: boardName, phase: "collect", runWhen: "always", details: { files: input.logFiles ?? [] }, async execute(context) { const diagnostics = []; if ((input.logFiles?.length ?? 0) > 0) { const files = await expandFilePatterns(input.logFiles ?? [], { baseDir: context.project.configDir, label: `jobs.${input.id}.logFiles` }); const root = path.join(context.project.resultDir, "mcu", boardName); for (const file of files) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(context.project.configDir, file), target); context.artifacts.publish({ kind: "log", name: `${boardName}-${file.replace(/[^A-Za-z0-9_-]/gu, "-")}`, path: target, metadata: { source: file } }); diagnostics.push({ code: "mcu_log", message: target }); } } return { diagnostics }; } });
  return [board, run, collect];
}

/** 构建/加载 Firmware，显式准备 Board，再执行 CTP3 MCU Test。 */
export function mcuCTestJob(input: McuCTestJobInput): TestJob {
  if (typeof input.firmware !== "object" || input.firmware === null || !["existing", "host-simulated", "command"].includes(input.firmware.kind)) throw new CautestError("MCU firmware.kind 无效", { code: "config_error" });
  if (input.reconnects !== undefined && (!Number.isInteger(input.reconnects) || input.reconnects < 0)) throw new CautestError("MCU reconnects 必须是非负整数", { code: "config_error" });
  const firmwareName = input.firmwareName ?? "firmware";
  const boardName = input.boardName ?? "board";
  const build = defineStep({ kind: "mcuFirmwareBuild", name: firmwareName, phase: "build", details: { ...input.firmware }, ...(("timeoutMs" in input.firmware && input.firmware.timeoutMs !== undefined) ? { timeoutMs: input.firmware.timeoutMs } : {}), async execute(context) { const artifact = await firmware(input, context); context.state.set(`firmware:${firmwareName}`, artifact); context.artifacts.publish({ kind: "mcu-firmware", name: firmwareName, path: artifact.path, fingerprint: artifact.buildId, buildId: artifact.buildId, metadata: { source: input.firmware.kind } }); return { diagnostics: [{ code: "firmware_ready", message: artifact.path }] }; } });
  const runtime = mcuRuntimeSteps(input, { artifact: (context) => context.state.get(`firmware:${firmwareName}`) as FirmwareArtifact | undefined });
  return testJob({ id: input.id, level: input.level ?? "component", tags: input.tags ?? ["component", "mcu"], workflow: [build, ...runtime], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}
