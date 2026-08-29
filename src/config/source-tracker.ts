import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, type MessagePort } from "node:worker_threads";

interface SnapshotReply {
  readonly kind: "snapshot";
  readonly id: number;
  readonly sources: readonly string[];
}

interface TrackerState {
  readonly port: MessagePort;
  readonly pending: Map<number, (sources: readonly string[]) => void>;
  activeRequests: number;
  nextRequestId: number;
}

const implementationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let state: TrackerState | undefined;

function isSnapshotReply(value: unknown): value is SnapshotReply {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "snapshot"
    && "id" in value
    && typeof value.id === "number"
    && "sources" in value
    && Array.isArray(value.sources)
    && value.sources.every((source) => typeof source === "string");
}

function createTracker(): TrackerState {
  const { port1, port2 } = new MessageChannel();
  const tracker: TrackerState = { port: port1, pending: new Map(), activeRequests: 0, nextRequestId: 1 };
  port1.on("message", (message: unknown) => {
    if (!isSnapshotReply(message)) return;
    const resolve = tracker.pending.get(message.id);
    if (resolve === undefined) return;
    tracker.pending.delete(message.id);
    resolve(message.sources);
  });
  port1.unref();
  register("./source-hook.js", {
    parentURL: import.meta.url,
    data: { port: port2 },
    transferList: [port2],
  });
  return tracker;
}

function trackerState(): TrackerState {
  state ??= createTracker();
  return state;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isDependencyDirectory(sourcePath: string): boolean {
  return sourcePath.split(path.sep).includes("node_modules");
}

function localConfigSources(urls: readonly string[], rootPath: string): readonly string[] {
  const sources = new Set<string>([rootPath]);
  for (const source of urls) {
    let sourcePath: string;
    try {
      const url = new URL(source);
      if (url.protocol !== "file:") continue;
      sourcePath = fileURLToPath(url);
    } catch {
      continue;
    }
    if (sourcePath !== rootPath && (isWithin(implementationRoot, sourcePath) || isDependencyDirectory(sourcePath))) continue;
    sources.add(sourcePath);
  }
  return [...sources];
}

/** 必须在导入根配置前调用，使 Loader 能记录完整的本地模块依赖图。 */
export function enableConfigSourceTracking(): void {
  trackerState();
}

/** 返回从根配置实际可达的本地模块；Cautest 运行库与 node_modules 不属于项目配置来源。 */
export async function collectConfigSources(rootUrl: string, rootPath: string): Promise<readonly string[]> {
  const tracker = trackerState();
  const id = tracker.nextRequestId;
  tracker.nextRequestId += 1;
  tracker.activeRequests += 1;
  tracker.port.ref();
  try {
    const urls = await new Promise<readonly string[]>((resolve) => {
      tracker.pending.set(id, resolve);
      tracker.port.postMessage({ kind: "snapshot", id, root: rootUrl });
    });
    return localConfigSources(urls, rootPath);
  } finally {
    tracker.activeRequests -= 1;
    if (tracker.activeRequests === 0) tracker.port.unref();
  }
}
