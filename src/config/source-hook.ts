import type { MessagePort } from "node:worker_threads";

interface InitializeData {
  readonly port: MessagePort;
}

interface ResolveContext {
  readonly parentURL?: string;
}

interface ResolveResult {
  readonly url: string;
  readonly [key: string]: unknown;
}

interface SnapshotRequest {
  readonly kind: "snapshot";
  readonly id: number;
  readonly root: string;
}

const dependencies = new Map<string, Set<string>>();
let communicationPort: MessagePort | undefined;

function addDependency(parent: string, child: string): void {
  let children = dependencies.get(parent);
  if (children === undefined) {
    children = new Set<string>();
    dependencies.set(parent, children);
  }
  children.add(child);
}

function isSnapshotRequest(value: unknown): value is SnapshotRequest {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "snapshot"
    && "id" in value
    && typeof value.id === "number"
    && "root" in value
    && typeof value.root === "string";
}

function snapshot(root: string): readonly string[] {
  const visited = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const child of dependencies.get(current) ?? []) pending.push(child);
  }
  return [...visited];
}

export function initialize(data: InitializeData): void {
  communicationPort = data.port;
  communicationPort.on("message", (message: unknown) => {
    if (!isSnapshotRequest(message)) return;
    communicationPort?.postMessage({ kind: "snapshot", id: message.id, sources: snapshot(message.root) });
  });
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: (specifier: string, context: ResolveContext) => Promise<ResolveResult>,
): Promise<ResolveResult> {
  const result = await nextResolve(specifier, context);
  if (context.parentURL !== undefined) addDependency(context.parentURL, result.url);
  try {
    const absoluteSpecifier = new URL(specifier);
    addDependency(absoluteSpecifier.href, result.url);
  } catch {
    // 相对和 bare specifier 由 parentURL 边覆盖。
  }
  return result;
}
