import path from "node:path";
import type { SerializedError } from "../model/error.js";
import { CautestError, serializeError } from "../model/error.js";
import type { TestSuiteResult } from "../config/schema/common.js";

export interface ArtifactInput {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly fingerprint?: string;
  readonly buildId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Artifact extends ArtifactInput {
  readonly metadata: Readonly<Record<string, unknown>>;
}

function key(kindOrKey: string, name?: string): string {
  return name === undefined ? kindOrKey : `${kindOrKey}:${name}`;
}

/** Job 内发布和查找构建产物的唯一 Store。 */
export class ArtifactStore {
  readonly #items = new Map<string, Artifact>();
  readonly #onPublish: ((artifact: Artifact) => void) | undefined;

  constructor(options: { readonly onPublish?: (artifact: Artifact) => void } = {}) {
    this.#onPublish = options.onPublish;
  }

  publish(input: ArtifactInput): Artifact {
    if (typeof input?.kind !== "string" || typeof input.name !== "string" || typeof input.path !== "string") {
      throw new CautestError("Artifact 必须包含 kind/name/path", { code: "tooling_error" });
    }
    const identity = key(input.kind, input.name);
    if (this.#items.has(identity)) throw new CautestError(`Artifact 已存在: ${identity}`, { code: "tooling_error" });
    const artifact = Object.freeze({
      kind: input.kind,
      name: input.name,
      path: path.resolve(input.path),
      ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
      ...(input.buildId === undefined ? {} : { buildId: input.buildId }),
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    });
    this.#items.set(identity, artifact);
    this.#onPublish?.(artifact);
    return artifact;
  }

  get(kindOrKey: string, name?: string): Artifact {
    const identity = key(kindOrKey, name);
    const artifact = this.#items.get(identity);
    if (artifact === undefined) throw new CautestError(`Artifact 不存在: ${identity}`, { code: "tooling_error" });
    return artifact;
  }

  has(kindOrKey: string, name?: string): boolean {
    return this.#items.has(key(kindOrKey, name));
  }

  list(): readonly Artifact[] {
    return Object.freeze([...this.#items.values()]);
  }
}

export type ResourceState = "starting" | "ready" | "failed" | "closed";

export interface ResourceInput {
  readonly kind: string;
  readonly name: string;
  readonly state?: "starting" | "ready";
  readonly owner?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly handle?: unknown;
}

export interface Resource {
  readonly kind: string;
  readonly name: string;
  state: ResourceState;
  readonly owner: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  failure?: Readonly<Record<string, unknown>>;
  readonly handle?: unknown;
}

interface ResourceCallbacks {
  readonly onPublish?: (resource: Resource) => void;
  readonly onState?: (resource: Resource) => void;
  readonly onClose?: (resource: Resource) => void;
}

/** 管理 Job 所拥有的长生命周期资源及其状态转换。 */
export class ResourceStore {
  readonly #items = new Map<string, Resource>();
  readonly #owner: string;
  readonly #callbacks: ResourceCallbacks;

  constructor(owner = "job", callbacks: ResourceCallbacks = {}) {
    this.#owner = owner;
    this.#callbacks = callbacks;
  }

  publish(input: ResourceInput): Resource {
    if (typeof input?.kind !== "string" || typeof input.name !== "string") {
      throw new CautestError("Resource 必须包含 kind/name", { code: "provision_error" });
    }
    const identity = key(input.kind, input.name);
    if (this.#items.has(identity)) throw new CautestError(`Resource 已存在: ${identity}`, { code: "provision_error" });
    const resource: Resource = {
      kind: input.kind,
      name: input.name,
      state: input.state ?? "ready",
      owner: input.owner ?? this.#owner,
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
      ...(input.handle === undefined ? {} : { handle: input.handle }),
    };
    this.#items.set(identity, resource);
    this.#callbacks.onPublish?.(resource);
    return resource;
  }

  get(kindOrKey: string, name?: string): Resource {
    const identity = key(kindOrKey, name);
    const resource = this.#items.get(identity);
    if (resource === undefined) throw new CautestError(`Resource 不存在: ${identity}`, { code: "provision_error" });
    return resource;
  }

  has(kindOrKey: string, name?: string): boolean {
    return this.#items.has(key(kindOrKey, name));
  }

  attach(identity: string, expectedOwner = this.#owner): Resource {
    const resource = this.get(identity);
    if (resource.owner !== expectedOwner) throw new CautestError(`Resource ${identity} 不属于 ${expectedOwner}`, { code: "provision_error" });
    if (resource.state !== "ready") throw new CautestError(`Resource ${identity} 尚未 ready: ${resource.state}`, { code: "provision_error" });
    return resource;
  }

  ready(kindOrKey: string, name?: string): Resource {
    const resource = this.get(kindOrKey, name);
    if (resource.state !== "starting") throw new CautestError(`Resource 不能从 ${resource.state} 进入 ready`, { code: "provision_error" });
    resource.state = "ready";
    this.#callbacks.onState?.(resource);
    return resource;
  }

  fail(kindOrKey: string, nameOrFailure?: string | Readonly<Record<string, unknown>>, maybeFailure?: Readonly<Record<string, unknown>>): Resource {
    const hasName = typeof nameOrFailure === "string";
    const resource = this.get(kindOrKey, hasName ? nameOrFailure : undefined);
    if (resource.state !== "starting" && resource.state !== "ready") {
      throw new CautestError(`Resource 不能从 ${resource.state} 进入 failed`, { code: "provision_error" });
    }
    resource.state = "failed";
    resource.failure = Object.freeze({ ...((hasName ? maybeFailure : nameOrFailure) ?? {}) });
    this.#callbacks.onState?.(resource);
    return resource;
  }

  close(kindOrKey: string, name?: string): Resource {
    const resource = this.get(kindOrKey, name);
    if (resource.state !== "closed") {
      resource.state = "closed";
      this.#callbacks.onClose?.(resource);
    }
    return resource;
  }

  list(): readonly Resource[] {
    return Object.freeze([...this.#items.values()]);
  }
}

export interface CleanupOutcome {
  readonly name: string;
  readonly status: "SUCCESS" | "ERROR";
  readonly error?: SerializedError;
}

/** 按注册的逆序执行、且只执行一次的 Cleanup Stack。 */
export class CleanupStack {
  readonly #entries: Array<{ readonly name: string; readonly callback: () => unknown | Promise<unknown> }> = [];
  readonly #outcomes: CleanupOutcome[] = [];
  #done = false;

  defer(callback: () => unknown | Promise<unknown>, name = `cleanup-${this.#entries.length + 1}`): void {
    if (this.#done) throw new CautestError("Cleanup 已开始，不能继续注册", { code: "cleanup_error" });
    if (typeof callback !== "function") throw new TypeError("cleanup callback 必须是函数");
    this.#entries.push({ name, callback });
  }

  async run(): Promise<readonly CleanupOutcome[]> {
    if (this.#done) return Object.freeze([...this.#outcomes]);
    this.#done = true;
    for (const entry of this.#entries.reverse()) {
      try {
        await entry.callback();
        this.#outcomes.push(Object.freeze({ name: entry.name, status: "SUCCESS" }));
      } catch (error) {
        this.#outcomes.push(Object.freeze({ name: entry.name, status: "ERROR", error: serializeError(error, "cleanup_error") }));
      }
    }
    return Object.freeze([...this.#outcomes]);
  }
}

/** 汇总由多个 Step 产生的结构化 Suite Result。 */
export class ResultRecorder {
  readonly #groups: TestSuiteResult[] = [];

  addGroup(group: TestSuiteResult): TestSuiteResult {
    const stored = Object.freeze({ ...group, cases: Object.freeze(group.cases.map((item) => Object.freeze({ ...item }))) });
    this.#groups.push(stored);
    return stored;
  }

  list(): readonly TestSuiteResult[] {
    return Object.freeze([...this.#groups]);
  }
}
