import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { CAUTEST_EVENT_SCHEMA_VERSION } from "../config/versions.js";

export interface WorkflowEvent {
  readonly version: typeof CAUTEST_EVENT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

/** 同时支持内存查询与 JSONL 流式落盘的运行事件记录器。 */
export class EventRecorder {
  readonly #events: WorkflowEvent[] = [];
  #sequence = 0;
  readonly #stream?: WriteStream;
  #streamError?: Error;

  constructor(options: { readonly file?: string } = {}) {
    if (options.file !== undefined) {
      mkdirSync(path.dirname(options.file), { recursive: true });
      this.#stream = createWriteStream(options.file, { flags: "w" });
      this.#stream.once("error", (error) => { this.#streamError = error; });
    }
  }

  emit(type: string, payload: Readonly<Record<string, unknown>> = {}): WorkflowEvent {
    const event = Object.freeze({ version: CAUTEST_EVENT_SCHEMA_VERSION, sequence: ++this.#sequence, timestamp: new Date().toISOString(), type, ...payload });
    this.#events.push(event);
    this.#stream?.write(`${JSON.stringify(event)}\n`);
    return event;
  }

  async emitTransient(type: string, payload: Readonly<Record<string, unknown>> = {}): Promise<WorkflowEvent> {
    const event = Object.freeze({ version: CAUTEST_EVENT_SCHEMA_VERSION, sequence: ++this.#sequence, timestamp: new Date().toISOString(), type, ...payload });
    if (this.#stream !== undefined && !this.#stream.write(`${JSON.stringify(event)}\n`)) await once(this.#stream, "drain");
    if (this.#streamError !== undefined) throw this.#streamError;
    return event;
  }

  list(): readonly WorkflowEvent[] {
    return Object.freeze([...this.#events]);
  }

  async close(): Promise<void> {
    if (this.#stream === undefined) return;
    if (this.#streamError !== undefined) throw this.#streamError;
    await new Promise<void>((resolve, reject) => {
      this.#stream?.once("error", reject);
      this.#stream?.end(resolve);
    });
    if (this.#streamError !== undefined) throw this.#streamError;
  }
}
