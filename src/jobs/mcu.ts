import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McuBoardAdapter, McuCTestJobInput, TestJob } from "../config/schema/index.js";
import { expandFilePatterns } from "../config/file-pattern.js";
import { testJob } from "../config/define.js";
import { CautestError } from "../model/error.js";
import { runCtpSession, runNativeSession } from "../protocol/native-session.js";
import { runCommand } from "../runtime/process.js";
import { defineStep } from "../workflow/step.js";

const kitRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const kitSources = ["core/cautest.c", "protocol/ctp3.c", "platform/freestanding/cautest_freestanding.c", "target/mcu-reference/mcu_reference.c", "target/mcu-reference/mcu_sim_target.c"];
interface FirmwareArtifact { readonly path: string; readonly buildId: string }
interface BoardState { readonly kind: "simulated" | "external"; readonly bootId: string; readonly adapter?: McuBoardAdapter }

async function firmware(input: McuCTestJobInput, context: Parameters<Parameters<typeof defineStep>[0]["execute"]>[0]): Promise<FirmwareArtifact> {
  const specification = input.firmware;
  let output: string;
  if (specification.kind === "existing") output = path.resolve(context.project.configDir, specification.file);
  else if (specification.kind === "command") {
    output = path.resolve(context.project.configDir, specification.output);
    const result = await runCommand({ program: specification.program, args: specification.args ?? [], cwd: path.resolve(context.project.configDir, specification.cwd ?? "."), env: { ...process.env, ...input.env, ...specification.env }, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`MCU Firmware 命令失败 (exit ${result.exitCode})`, { code: "build_error" });
  } else {
    output = path.resolve(context.project.configDir, specification.output);
    const sources = await expandFilePatterns(specification.sources, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.sources` });
    const headers = specification.headers === undefined ? [] : await expandFilePatterns(specification.headers, { baseDir: context.project.configDir, label: `jobs.${input.id}.firmware.headers` });
    const bytes = await Promise.all([...sources, ...headers].map((file) => readFile(path.join(context.project.configDir, file))));
    const compiler = specification.compiler ?? "cc";
    const version = await runCommand({ program: compiler, args: ["--version"], cwd: context.project.configDir, env: { ...process.env, ...input.env, ...specification.env }, signal: context.signal });
    const buildId = createHash("sha256").update(version.stdout).update(Buffer.concat(bytes)).update(JSON.stringify(specification.cflags ?? [])).digest("hex").slice(0, 24);
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(context.project.workDir, { recursive: true });
    const includeDirs = [...new Set(headers.map((header) => path.dirname(path.join(context.project.configDir, header))))];
    const result = await runCommand({ program: compiler, args: ["-std=c99", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", `-I${path.join(kitRoot, "include")}`, `-I${path.join(kitRoot, "platform/freestanding")}`, `-I${path.join(kitRoot, "target/mcu-reference")}`, ...includeDirs.map((directory) => `-I${directory}`), `-DCAUTEST_MCU_BUILD_ID=\"${buildId}\"`, ...(specification.cflags ?? []), ...sources.map((source) => path.join(context.project.configDir, source)), ...kitSources.map((source) => path.join(kitRoot, source)), "-o", output], cwd: context.project.workDir, env: { ...process.env, ...input.env, ...specification.env }, signal: context.signal, onOutput: context.output });
    if (result.exitCode !== 0) throw new CautestError(`Host MCU Firmware 编译失败 (exit ${result.exitCode})`, { code: "build_error" });
    await chmod(output, 0o755);
    return Object.freeze({ path: output, buildId });
  }
  const contents = await readFile(output);
  const fingerprintInputs = specification.fingerprintInputs ?? {};
  return Object.freeze({ path: output, buildId: createHash("sha256").update(contents).update(JSON.stringify(fingerprintInputs)).digest("hex").slice(0, 24) });
}

/** 构建/加载 Firmware，显式准备 Board，再执行 CTP3 MCU Test。 */
export function mcuCTestJob(input: McuCTestJobInput): TestJob {
  if (typeof input.firmware !== "object" || input.firmware === null || !["existing", "host-simulated", "command"].includes(input.firmware.kind)) throw new CautestError("MCU firmware.kind 无效", { code: "config_error" });
  const firmwareName = input.firmwareName ?? "firmware";
  const boardName = input.boardName ?? "board";
  const build = defineStep({ kind: "mcuFirmwareBuild", name: firmwareName, phase: "build", details: { ...input.firmware }, ...(("timeoutMs" in input.firmware && input.firmware.timeoutMs !== undefined) ? { timeoutMs: input.firmware.timeoutMs } : {}), async execute(context) { const artifact = await firmware(input, context); context.state.set(`firmware:${firmwareName}`, artifact); return { diagnostics: [{ code: "firmware_ready", message: artifact.path }] }; } });
  const board = defineStep({ kind: "mcuBoardStart", name: boardName, phase: "provision", details: { kind: input.board?.kind ?? "simulated" }, async execute(context) { const artifact = context.state.get(`firmware:${firmwareName}`) as FirmwareArtifact | undefined; if (artifact === undefined) throw new CautestError("Firmware Artifact 不存在", { code: "provision_error" }); if (input.board?.kind === "external") { await input.board.adapter.flash(artifact); const bootId = await input.board.adapter.reset(); context.state.set(`board:${boardName}`, Object.freeze({ kind: "external", bootId, adapter: input.board.adapter }) satisfies BoardState); } else context.state.set(`board:${boardName}`, Object.freeze({ kind: "simulated", bootId: `sim-${Date.now()}` }) satisfies BoardState); return { diagnostics: [{ code: "board_ready", message: boardName }] }; } });
  const run = defineStep({ kind: "mcuCTestRun", name: boardName, phase: "run", details: { selection: input.run ?? {} }, ...(input.run?.stepTimeoutMs === undefined ? {} : { timeoutMs: input.run.stepTimeoutMs }), async execute(context) { const artifact = context.state.get(`firmware:${firmwareName}`) as FirmwareArtifact | undefined; const state = context.state.get(`board:${boardName}`) as BoardState | undefined; if (artifact === undefined || state === undefined) throw new CautestError("Firmware/Board 未准备", { code: "provision_error" }); const results = state.kind === "external" ? await runCtpSession({ transport: await state.adapter!.openTransport(input.serial?.options), expectedBuildId: artifact.buildId, run: input.run ?? {}, signal: context.signal }) : await runNativeSession({ program: artifact.path, args: [state.bootId], cwd: path.resolve(context.project.configDir, input.serial?.cwd ?? "."), env: { ...process.env, ...input.env, ...input.serial?.env }, expectedBuildId: artifact.buildId, run: input.run ?? {}, signal: context.signal }); const cases = results.flatMap((suite) => suite.cases); return { outcome: cases.some((item) => item.status === "FAIL" || item.status === "ERROR") ? "FAIL" : "SUCCESS", testResults: results }; } });
  const collect = defineStep({ kind: "mcuLogs", name: boardName, phase: "collect", runWhen: "always", details: { files: input.logFiles ?? [] }, async execute(context) { try { const diagnostics = []; if ((input.logFiles?.length ?? 0) > 0) { const files = await expandFilePatterns(input.logFiles ?? [], { baseDir: context.project.configDir, label: `jobs.${input.id}.logFiles` }); const root = path.join(context.project.resultDir, "mcu", boardName); for (const file of files) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(context.project.configDir, file), target); diagnostics.push({ code: "mcu_log", message: target }); } } return { diagnostics }; } finally { if (input.board?.kind === "external" && input.board.ownership !== "borrowed") await input.board.adapter.close?.(); } } });
  return testJob({ id: input.id, level: input.level ?? "component", tags: input.tags ?? ["component", "mcu"], workflow: [build, board, run, collect], ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.env === undefined ? {} : { env: input.env }), ...(input.policy === undefined ? {} : { policy: input.policy }) });
}
