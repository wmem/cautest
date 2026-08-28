import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { planConfig } from "../config/plan.js";
import { CautestError } from "../model/error.js";

interface BuildInfo {
  readonly version: string;
  readonly commit: string;
  readonly dirty: boolean;
}

interface Streams {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
}

const usage = `用法: cautest <命令>

命令:
  --version              显示版本和构建 Commit
  --help                 显示帮助
  list                   列出 Test Job
  plan [Job ID...]       打印最终线性 Workflow

全局选项:
  --config <文件>        显式指定配置文件
`;

async function loadBuildInfo(): Promise<BuildInfo> {
  const value: unknown = JSON.parse(await readFile(new URL("../../build-info.json", import.meta.url), "utf8"));
  if (typeof value !== "object" || value === null) throw new Error("build-info.json 无效");
  const info = value as Partial<BuildInfo>;
  if (typeof info.version !== "string" || typeof info.commit !== "string" || typeof info.dirty !== "boolean") {
    throw new Error("build-info.json 字段不完整");
  }
  return info as BuildInfo;
}

export async function runCli(
  args: readonly string[],
  streams: Streams = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  try {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      streams.stdout.write(usage);
      return 0;
    }
    if (args[0] === "--version") {
      const info = await loadBuildInfo();
      streams.stdout.write(`Cautest ${info.version} (commit ${info.commit}${info.dirty ? ", dirty" : ""})\n`);
      return 0;
    }
    const mutable = [...args];
    let configPath: string | undefined;
    const configIndex = mutable.indexOf("--config");
    if (configIndex >= 0) {
      configPath = mutable[configIndex + 1];
      if (configPath === undefined) throw new CautestError("--config 缺少文件路径", { code: "config_error" });
      mutable.splice(configIndex, 2);
    }
    const command = mutable.shift();
    if (command === "list") {
      const loaded = await loadConfig(configPath);
      for (const job of loaded.config.jobs) {
        streams.stdout.write(`${job.id}\t${job.level}\t${job.enabled ? "enabled" : "disabled"}\t${job.tags.join(",")}\n`);
      }
      return 0;
    }
    if (command === "plan") {
      const loaded = await loadConfig(configPath);
      for (const job of planConfig(loaded.config, mutable)) {
        streams.stdout.write(`Job ${job.id} (${job.level})${job.enabled ? "" : " [disabled]"}\n`);
        if (job.origin !== undefined) streams.stdout.write(`  Source ${job.origin.source} ${job.origin.configPath}\n`);
        for (const step of job.workflow) {
          streams.stdout.write(`  ${step.id}\t${step.runWhen}\n`);
        }
      }
      return 0;
    }
    streams.stderr.write(usage);
    return 2;
  } catch (error) {
    streams.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof CautestError && error.code === "selection_error" ? 4 : 3;
  }
}
