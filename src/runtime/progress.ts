import { stripVTControlCharacters } from "node:util";
import type { TestJob } from "../config/schema/common.js";
import type { RunExecutionOptions } from "../result/run.js";
import type { WorkflowEvent } from "../workflow/events.js";

type Writer = { write(text: string): unknown; readonly isTTY?: boolean; readonly columns?: number };
type Counts = Record<"PASS" | "FAIL" | "ERROR" | "SKIP", number>;
type DisplayJob = Pick<TestJob, "id" | "description"> & Partial<Pick<TestJob, "policy" | "workflow">>;
const stepCounts = () => ({SUCCESS: 0, FAIL: 0, ERROR: 0, SKIPPED: 0});
const counts = (): Counts => ({ PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 });
const total = (value: Counts): number => Object.values(value).reduce((sum, count) => sum + count, 0);
const summary = (value: Counts): string => `PASS ${value.PASS}  FAIL ${value.FAIL}  ERROR ${value.ERROR}  SKIP ${value.SKIP}`;
const block = (value: unknown): string => stripVTControlCharacters(String(value ?? "")).replace(/\r\n?/gu, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "");
const clean = (value: unknown): string => block(value).replace(/[\n\t]/gu, " ");
const seconds = (started: number): string => `${((performance.now() - started) / 1000).toFixed(1)}s`;
function clock(started: number): string {
  const elapsed = Math.max(0, Math.floor((performance.now() - started) / 1000));
  return [...(elapsed >= 3600 ? [Math.floor(elapsed / 3600)] : []), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}
function cellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (/\p{Mark}/u.test(char) || code === 0x200d || code === 0xfe0f) return 0;
  if (/\p{Extended_Pictographic}/u.test(char)) return 2;
  return code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f
    || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff
    || code >= 0xfe10 && code <= 0xfe19 || code >= 0xfe30 && code <= 0xfe6f
    || code >= 0xff00 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6
    || code >= 0x20000 && code <= 0x3fffd) ? 2 : 1;
}
const textWidth = (text: string): number => [...text].reduce((width, char) => width + cellWidth(char), 0);
const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - textWidth(text)));
function evidence(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return clean(text).slice(0, 400);
}
function clip(text: string, columns: number): string {
  if (textWidth(text) < columns) return text;
  let width = 0, output = "";
  for (const char of text) {
    const size = cellWidth(char);
    if (width + size > columns - 2) return `${output}…`;
    width += size; output += char;
  }
  return output;
}

/** A bounded live dashboard; only failures and explicit verbose logs become history. */
export class TerminalProgress {
  readonly #writer: Writer;
  readonly #jobs: readonly DisplayJob[];
  readonly #verbose: boolean;
  readonly #color: boolean;
  #index = 0;
  #completed = 0;
  readonly #jobCounts = { SUCCESS: 0, FAIL: 0, ERROR: 0, SKIP: 0 };
  readonly #started = performance.now();
  #phaseStarted = performance.now();
  #job = "";
  #phase = "";
  #stepLabel = "";
  #step = "";
  #current = "";
  #knownTotal: number | undefined;
  #counts = counts();
  #resultMode: "cases" | "steps" = "cases";
  #caseEvents = false;
  #totalSteps = 0;
  #stepCounts = stepCounts();
  #lastResult = "";
  #rows = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pulse: ReturnType<typeof setInterval> | undefined;
  #outputTail = "";
  readonly #reportedErrors = new Set<string>();
  readonly #reportedCases = new Set<string>();
  readonly #reportedDetails = new Set<string>();
  readonly #active = new Map<string, { name: string; failure: string }>();
  readonly #ended = new Set<string>();

  constructor(writer: Writer, jobs: readonly DisplayJob[], verbose = false) {
    this.#writer = writer; this.#jobs = jobs; this.#verbose = verbose;
    this.#color = writer.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  }

  #prefix(): string { return this.#jobs.some(job => job.id === this.#job) ? `[Job ${this.#index}/${this.#jobs.length}] ${clean(this.#job)}` : `[收集] ${clean(this.#job)}`; }
  #usesSteps(): boolean { return this.#resultMode === "steps" && !this.#caseEvents; }
  #progressText(): string {
    if (this.#usesSteps()) return ` | 步骤 ${Object.values(this.#stepCounts).reduce((sum, count) => sum + count, 0)}/${this.#totalSteps} | SUCCESS ${this.#stepCounts.SUCCESS}  FAIL ${this.#stepCounts.FAIL}  ERROR ${this.#stepCounts.ERROR}  SKIP ${this.#stepCounts.SKIPPED}`;
    return this.#step ? ` | 用例 ${total(this.#counts)}/${this.#knownTotal ?? "?"} | ${summary(this.#counts)}` : "";
  }
  #state(): string {
    const progress = this.#progressText();
    return `${this.#prefix()} | ${this.#phase}${progress}${this.#current ? ` | 正在测试 ${this.#current}` : ""}${this.#lastResult ? ` | ${this.#lastResult}` : ""}`;
  }
  #clear(): void {
    if (!this.#rows) return;
    this.#writer.write(`\r\u001b[2K${"\u001b[1A\r\u001b[2K".repeat(this.#rows - 1)}`);
    this.#rows = 0;
  }
  #render(): void {
    if (!this.#writer.isTTY || !this.#job) return;
    const width = Math.max(20, this.#writer.columns || 120);
    const percent = this.#jobs.length ? Math.floor(this.#completed / this.#jobs.length * 100) : 0;
    const jobRatio = `${this.#completed}/${this.#jobs.length}`;
    const usesSteps = this.#usesSteps();
    const completedSteps = Object.values(this.#stepCounts).reduce((sum, count) => sum + count, 0);
    const currentCount = usesSteps ? completedSteps : total(this.#counts);
    const currentTotal = usesSteps ? this.#totalSteps : this.#knownTotal;
    const caseRatio = `${currentCount}/${currentTotal ?? "?"}`;
    const ratioWidth = Math.max(7, jobRatio.length, caseRatio.length);
    const digits = Math.max(2, String(Math.max(this.#jobs.length, currentTotal ?? 0, currentCount)).length);
    const stats = (entries: readonly (readonly [string, number])[]): string => entries.map(([name, count]) =>
      width >= 72 ? `${pad(name, 5)} ${String(count).padStart(digits)}` : `${name} ${count}`).join("  ");
    const jobStats = stats([["成功", this.#jobCounts.SUCCESS], ["失败", this.#jobCounts.FAIL], ["错误", this.#jobCounts.ERROR], ["跳过", this.#jobCounts.SKIP]]);
    const caseStats = stats(usesSteps ? [["成功", this.#stepCounts.SUCCESS], ["失败", this.#stepCounts.FAIL], ["错误", this.#stepCounts.ERROR], ["跳过", this.#stepCounts.SKIPPED]] : Object.entries(this.#counts));
    // Both progress rows share the same columns. Drop the bar before hiding counts.
    const room = width - 1 - (8 + ratioWidth + 8 + Math.max(textWidth(jobStats), textWidth(caseStats)));
    const barSize = room >= 12 ? Math.min(18, room - 4) : 0;
    const progress = (ratio: string, percentage: number | undefined, status: string): string => {
      const fill = percentage === undefined ? 0 : Math.floor(barSize * Math.min(100, percentage) / 100);
      const bar = !barSize ? "" : `[${percentage === undefined ? "·".repeat(barSize) : "━".repeat(fill) + "─".repeat(barSize - fill)}]  `;
      return `${bar}${ratio.padStart(ratioWidth)}  ${(percentage === undefined ? "--" : `${percentage}%`).padStart(4)}  ${status}`;
    };
    const row = (label: string, text: string): string => `  ${label}  ${text}`;
    const current = this.#current || this.#lastResult || this.#stepLabel;
    const hasCases = usesSteps || this.#step || total(this.#counts) > 0;
    const lines = [
      row("总览", progress(jobRatio, percent, jobStats)),
      row(usesSteps ? "步骤" : "用例", hasCases ? progress(caseRatio, currentTotal ? Math.floor(currentCount / currentTotal * 100) : undefined, caseStats) : "—"),
      row("任务", clean(this.#job)),
      row("状态", `${pad(this.#phase, 8)}  阶段 ${clock(this.#phaseStarted)}  ·  总计 ${clock(this.#started)}`),
      row("当前", current || "—"),
    ];
    this.#clear();
    this.#writer.write(lines.map(line => this.#decorate(clip(line, width))).join("\n"));
    this.#rows = lines.length;
  }
  #decorate(line: string): string {
    if (!this.#color) return line;
    return line.replace(/^(  \S+  )/u, "\u001b[2m$1\u001b[22m")
      .replace(/━+/gu, "\u001b[36m$&\u001b[39m").replace(/[─·]+/gu, "\u001b[2m$&\u001b[22m")
      .replace(/(?:失败|错误|FAIL|ERROR)\s+[1-9]\d*/gu, "\u001b[31m$&\u001b[39m")
      .replace(/(?:成功|PASS)\s+[1-9]\d*/gu, "\u001b[32m$&\u001b[39m");
  }
  #update(force = false): void {
    if (!this.#writer.isTTY) return;
    if (!this.#pulse) {
      this.#pulse = setInterval(() => this.#render(), 200);
      this.#pulse.unref();
    }
    if (force) { if (this.#timer) clearTimeout(this.#timer); this.#timer = undefined; this.#render(); }
    else if (!this.#timer) {
      this.#timer = setTimeout(() => { this.#timer = undefined; this.#render(); }, 80);
      this.#timer.unref();
    }
  }
  #log(text: string): void { this.#clear(); this.#writer.write(`${block(text)}\n`); }
  #record(text: string): void { if (!this.#writer.isTTY || this.#verbose) this.#log(text); }
  #error(message: string): void {
    if (this.#reportedErrors.has(message)) return;
    this.#reportedErrors.add(message); this.#log(message);
  }
  #key(event: WorkflowEvent): string {
    return event.executionId === undefined ? String(event.case) : `${event.executionId}/${event.suiteId}/${event.caseId}/${event.paramId}`;
  }

  readonly callbacks: Pick<RunExecutionOptions, "onJob" | "onStep" | "onOutput" | "onEvent"> = {
    onJob: event => {
      if (event.type === "START") {
        this.#index++; this.#job = event.jobId; this.#phase = "准备中"; this.#phaseStarted = performance.now(); this.#step = ""; this.#stepLabel = "";
        this.#counts = counts(); this.#knownTotal = undefined; this.#current = ""; this.#lastResult = "";
        const configured = this.#jobs.find(job => job.id === event.jobId);
        this.#resultMode = configured?.policy?.resultMode ?? "cases";
        this.#totalSteps = configured?.workflow?.length ?? 0;
        this.#stepCounts = stepCounts(); this.#caseEvents = false;
        this.#active.clear(); this.#ended.clear(); this.#reportedErrors.clear(); this.#reportedCases.clear(); this.#reportedDetails.clear();
        const description = this.#jobs.find(job => job.id === event.jobId)?.description;
        this.#record(`${this.#prefix()} START Job ${event.jobId}${description ? ` | ${description}` : ""}`);
        this.#update(true);
      } else {
        this.#completed++;
        if (event.status) this.#jobCounts[event.status]++;
        const final = counts();
        if (event.result?.steps) {
          this.#stepCounts = stepCounts();
          for (const step of event.result.steps) this.#stepCounts[step.status]++;
          this.#totalSteps = event.result.steps.length;
        }
        for (const group of event.result?.groups ?? []) for (const item of group.cases) {
          final[item.status]++;
          if ((item.status === "FAIL" || item.status === "ERROR") && !this.#reportedDetails.has(`${group.name}/${item.name}`) && !this.#reportedDetails.has(item.name)) {
            if (!this.#reportedCases.has(`${group.name}/${item.name}`) && !this.#reportedCases.has(item.name)) this.#log(`${this.#prefix()} ${item.status} ${group.name}/${item.name}`);
            for (const assertion of item.assertions.filter(value => value.status === "FAIL" || value.status === "ERROR")) {
              this.#log(`  ${assertion.expression}${assertion.file ? ` at ${assertion.file}:${assertion.line}` : ""} expected=${evidence(assertion.expected)} actual=${evidence(assertion.actual)}`);
            }
            const diagnostic = item.diagnostics[0] ?? item.failures?.[0] ?? item.error;
            if (diagnostic !== undefined) this.#log(`  ${typeof diagnostic === "object" && diagnostic !== null && "message" in diagnostic ? block(diagnostic.message) : evidence(diagnostic)}`);
          }
        }
        for (const error of event.result?.errors ?? []) this.#error(`  ERROR [${error.code}] ${error.message}`);
        this.#phase = event.status ?? ""; this.#current = "";
        const detail = this.#usesSteps() ? this.#progressText() : ` | 已完成 ${total(final)} | ${summary(final)}`;
        this.#record(`${this.#prefix()} END Job ${event.jobId} ${event.status} ${Math.round(event.durationMs ?? 0)}ms${detail}`);
        this.#update(true);
      }
    },
    onStep: event => {
      this.#job = event.jobId;
      if (event.type === "START") {
        this.#phase = ({prepare: "准备中", build: "构建中", provision: "部署中", run: "运行中", collect: "收集中"})[event.step.phase];
        this.#stepLabel = clean(event.step.name); this.#phaseStarted = performance.now(); this.#outputTail = "";
        this.#caseEvents = false;
        this.#step = event.step.phase === "run" ? event.step.name : "";
        this.#current = ""; this.#lastResult = ""; this.#counts = counts(); this.#knownTotal = undefined;
        this.#active.clear(); this.#ended.clear();
        this.#record(`${this.#prefix()} START Step ${event.jobId}/${event.step.phase}/${event.step.kind}:${event.step.name}`);
        this.#update(true);
      } else if (event.type === "HEARTBEAT") {
        this.#phaseStarted = performance.now() - (event.durationMs ?? 0);
        if (this.#writer.isTTY) this.#update(true);
        else this.#log(`HEARTBEAT Step ${event.jobId}/${event.step.kind}:${event.step.name} | ${this.#state()} | 已等待 ${seconds(this.#phaseStarted)}`);
      } else {
        if (event.status) this.#stepCounts[event.status]++;
        this.#current = "";
        this.#phase = event.status ?? "";
        const cache = event.diagnostics?.find(item => typeof item === "object" && item !== null && "code" in item && (item.code === "cache_hit" || item.code === "cache_miss")) as {code: string} | undefined;
        this.#record(`${this.#prefix()} END Step ${event.step.kind}:${event.step.name} ${event.status} ${Math.round(event.durationMs ?? 0)}ms${cache ? ` ${cache.code === "cache_hit" ? "CACHE HIT" : "CACHE MISS"}` : ""}${this.#progressText()}`);
        if (event.error) {
          this.#log(`${this.#prefix()} ERROR ${event.step.kind}:${event.step.name}`);
          this.#error(`  ERROR [${event.error.code}] ${event.error.message}`);
          const tail = block(this.#outputTail).trim();
          if (!this.#verbose && tail && !block(event.error.message).includes(tail)) this.#log(`最近输出：\n${tail}`);
        } else if (event.status === "FAIL" && !this.#caseEvents) {
          this.#log(`${this.#prefix()} FAIL ${event.step.kind}:${event.step.name}`);
          const diagnostic = event.diagnostics?.[0];
          if (diagnostic !== undefined) this.#log(`  ${typeof diagnostic === "object" && diagnostic !== null && "message" in diagnostic ? block(diagnostic.message) : evidence(diagnostic)}`);
        }
        this.#update(true);
      }
    },
    onOutput: event => {
      this.#outputTail = (this.#outputTail + event.text).slice(-8000).split("\n").slice(-40).join("\n");
      if (!this.#verbose) return;
      this.#clear(); this.#writer.write(block(event.text));
      if (!event.text.endsWith("\n")) this.#writer.write("\n");
      this.#update();
    },
    onEvent: event => this.#event(event),
  };

  #event(event: WorkflowEvent): void {
    if (event.type === "JOB_START") {
      this.#job = String(event.jobId);
      this.#resultMode = event.resultMode === "steps" ? "steps" : "cases";
      this.#totalSteps = typeof event.totalSteps === "number" ? event.totalSteps : 0;
      this.#stepCounts = stepCounts(); this.#caseEvents = false;
      return;
    }
    if (event.type === "JOB_CLEANUP_START") {
      this.#job = String(event.jobId); this.#phase = "清理中"; this.#phaseStarted = performance.now();
      this.#current = ""; this.#step = ""; this.#stepLabel = "资源清理"; this.#lastResult = "";
      this.#update(true); return;
    }
    if (event.type === "CASE_SELECTION") {
      this.#caseEvents = true;
      this.#knownTotal = typeof event.total === "number" ? event.total : undefined;
      this.#counts = counts(); this.#active.clear(); this.#ended.clear(); this.#lastResult = "";
      this.#update(true); return;
    }
    if (event.type === "CASE_START") {
      this.#caseEvents = true;
      const name = clean(event.name ?? event.case);
      const description = clean(event.description);
      this.#active.set(this.#key(event), { name, failure: "" });
      this.#current = `${name}${description ? `（${description}）` : ""}`;
      if (!this.#writer.isTTY || this.#verbose) this.#log(`${this.#prefix()} RUN ${this.#current} | 用例 ${total(this.#counts) + 1}/${this.#knownTotal ?? "?"}`);
      this.#update(); return;
    }
    const active = this.#active.get(this.#key(event));
    if (event.type === "ASSERTION" && active && (event.status === "FAIL" || event.status === "ERROR" || event.passed === false)) {
      active.failure = `${clean(event.expression ?? event.message)}${event.file ? ` at ${clean(event.file)}:${event.line}` : ""}${event.expected === undefined && event.actual === undefined ? "" : ` expected=${evidence(event.expected)} actual=${evidence(event.actual)}`}`;
      this.#log(`${this.#prefix()} ${event.status ?? "FAIL"} ${active.name}\n  ${active.failure}`);
      this.#reportedCases.add(active.name); this.#reportedDetails.add(active.name); this.#update();
    } else if (event.type === "FAULT") {
      if (active) active.failure = `[${clean(event.code)}] ${clean(event.message)}`;
      this.#log(`${this.#prefix()} ERROR${active ? ` ${active.name}` : ""}\n  [${clean(event.code)}] ${clean(event.message)}`);
      if (active) { this.#reportedCases.add(active.name); this.#reportedDetails.add(active.name); }
      this.#update();
    } else if (event.type === "CASE_END" && active && !this.#ended.has(this.#key(event))) {
      const status = event.status as keyof Counts;
      if (!Object.hasOwn(this.#counts, status)) return;
      if (status === "ERROR" && !active.failure && typeof event.error === "object" && event.error !== null && "message" in event.error) {
        active.failure = block(event.error.message);
        this.#log(`${this.#prefix()} ERROR ${active.name}\n  ${active.failure}`);
        this.#reportedDetails.add(active.name);
      }
      this.#ended.add(this.#key(event)); this.#active.delete(this.#key(event));
      this.#counts[status]++;
      this.#current = "";
      this.#lastResult = `${active.name} 结果：${status}`;
      const text = `${this.#prefix()} ${this.#lastResult} | 已完成 ${total(this.#counts)}/${this.#knownTotal ?? "?"} | ${summary(this.#counts)}`;
      if (!this.#writer.isTTY || this.#verbose || ((status === "FAIL" || status === "ERROR") && !active.failure)) this.#log(text);
      if (status === "FAIL" || status === "ERROR") this.#reportedCases.add(active.name);
      this.#update();
    }
  }

  close(): void {
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#pulse) clearInterval(this.#pulse);
    this.#timer = undefined; this.#pulse = undefined; this.#clear();
  }
}
