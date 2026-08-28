import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  config-smoke <配置>    验证便携 Loader 可以加载 @cautest/config
`;

async function loadBuildInfo(): Promise<BuildInfo> {
  const value: unknown = JSON.parse(await readFile(new URL("./build-info.json", import.meta.url), "utf8"));
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
    if (args[0] === "config-smoke" && args.length === 2) {
      const location = path.resolve(args[1] ?? "");
      const loaded = await import(pathToFileURL(location).href);
      streams.stdout.write(`${JSON.stringify({ default: loaded.default })}\n`);
      return 0;
    }
    streams.stderr.write(usage);
    return 2;
  } catch (error) {
    streams.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
