import assert from "node:assert/strict";
import test from "node:test";
import { filterTestDescriptors, planCTestExecutions, runCTestSession } from "../dist/config/index.js";

const catalog = [
  { suiteId: 0, caseId: 0, paramId: 0, suite: "alpha", case: "plain", parameter: "", name: "alpha/plain" },
  { suiteId: 0, caseId: 1, paramId: 0, suite: "alpha", case: "parameter", parameter: "one", name: "alpha/parameter@one" },
  { suiteId: 1, caseId: 0, paramId: 0, suite: "beta", case: "plain", parameter: "", name: "beta/plain" },
];

test("Host Filter 与执行规划区分 Suite 和 Case 模式", () => {
  assert.deepEqual(filterTestDescriptors(catalog, { include: ["alpha/*"], exclude: ["*@one"] }).map((item) => item.name), ["alpha/plain"]);
  assert.deepEqual(filterTestDescriptors(catalog, { suite: ["alpha"], case: ["parameter"], parameter: ["one"] }).map((item) => item.name), ["alpha/parameter@one"]);
  const alpha = filterTestDescriptors(catalog, { suite: "alpha" });
  assert.deepEqual(planCTestExecutions(catalog, alpha, { suite: "alpha" }), [{ kind: "SUITE", suiteId: 0, suite: "alpha" }]);
  assert.deepEqual(planCTestExecutions(catalog, alpha, { include: "alpha/*" }).map((item) => item.kind), ["CASE", "CASE"]);
});

class ScriptedTransport {
  constructor({ hang = false, suiteError = false, wrongLogIds = false, targetLog = false, typedAssertion = false } = {}) {
    this.lines = []; this.commands = []; this.closed = false; this.hang = hang; this.suiteError = suiteError; this.wrongLogIds = wrongLogIds; this.targetLog = targetLog; this.typedAssertion = typedAssertion;
  }
  async open() {}
  async write(data) {
    const command = new TextDecoder().decode(data).trimEnd();
    this.commands.push(command);
    if (command === "AT+HELLO") this.lines.push(...(this.targetLog ? ["+LOG:0,TARGET,0,0,0,TARGET,INFO,booting"] : []), "+HELLO:3,0,build,boot,64,512", "OK:HELLO");
    else if (command === "AT+LIST") this.lines.push("+LIST:START", "+CASE:0,0,0,alpha,plain,", "+LIST:END,1", "OK:LIST");
    else if (command.startsWith("AT+CASE=") && !this.hang) this.lines.push(
      "+EXEC-START:1,CASE,0,0,0", "+SUITE-START:1,0", "+CASE-START:1,0,0,0",
      `+LOG:1,CASE,0,0,${this.wrongLogIds ? 1 : 0},TARGET,INFO,diagnostic`,
      ...(this.typedAssertion ? ["+ASSERT2:1,0,0,0,0,FAIL,file.c,7,string equality,string,0,expected\\,value,actual"] : []),
      `+CASE-END:1,0,0,0,${this.typedAssertion ? "FAIL" : "PASS"}`, `+SUITE-END:1,0,${this.typedAssertion ? "FAIL" : "PASS"}`, `+EXEC-END:1,${this.typedAssertion ? "FAIL,0,1" : "PASS,1,0"},0,0`, "OK:CASE,1",
    );
    else if (command.startsWith("AT+SUITE=") && this.suiteError) this.lines.push(
      "+EXEC-START:1,SUITE,0,0,0", "+SUITE-START:1,0", "+FAULT:1,SUITE,0,0,0,FIXTURE,suite setup failed", "+SUITE-END:1,0,ERROR", "+EXEC-END:1,ERROR,0,0,0,0", "OK:SUITE,1",
    );
    else if (command === "AT+BYE") this.lines.push("OK:BYE");
  }
  nextLine({ timeoutMs, signal } = {}) {
    if (this.lines.length > 0) return Promise.resolve(this.lines.shift());
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout_error" })), timeoutMs);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }
  async close() { this.closed = true; }
}

test("Session 生成 Case 结果并将 Target Log 外置", async () => {
  const transport = new ScriptedTransport();
  const logs = [];
  const events = [];
  const result = await runCTestSession({ transport, expectedBuildId: "build", include: ["alpha/plain"], onLog: (log) => { logs.push(log); return "target.log:1"; }, onEvent: (event) => events.push(event) });
  assert.equal(result.groups[0].cases[0].status, "PASS");
  assert.equal(result.executionCount, 1);
  assert.equal("targetEvents" in result, false);
  assert.equal(logs[0].message, "diagnostic");
  assert.equal(events.find((event) => event.type === "TARGET_LOG").message, undefined);
  assert.equal(events.find((event) => event.type === "TARGET_LOG").logRef, "target.log:1");
  assert(transport.commands.includes("AT+CASE=1,0,0,0"));
});

test("Execution Timeout 关闭连接且不发送 CANCEL", async () => {
  const transport = new ScriptedTransport({ hang: true });
  await assert.rejects(runCTestSession({ transport, expectedBuildId: "build", include: ["alpha/plain"], runTimeoutMs: 10 }), (error) => error.code === "timeout_error");
  assert.equal(transport.commands.some((line) => line.includes("CANCEL")), false);
  assert.equal(transport.closed, true);
});

test("ASSERT2 保留字符串 expected/actual 结构化类型", async () => {
  const result = await runCTestSession({ transport: new ScriptedTransport({ typedAssertion: true }), expectedBuildId: "build", include: ["alpha/plain"] });
  const assertion = result.groups[0].cases[0].assertions[0];
  assert.deepEqual(assertion.expected, { type: "string", value: "expected,value" });
  assert.deepEqual(assertion.actual, { type: "string", value: "actual" });
});

test("Suite Fixture 错误形成执行错误且不伪造 Case", async () => {
  const result = await runCTestSession({ transport: new ScriptedTransport({ suiteError: true }), expectedBuildId: "build" });
  assert.deepEqual(result.groups, []);
  assert.equal(result.executionErrors.length, 1);
  assert.equal(result.groupDiagnostics[0].code, "FIXTURE");
});

test("Session 拒绝无法关联到当前 Case 的日志 ID", async () => {
  await assert.rejects(runCTestSession({ transport: new ScriptedTransport({ wrongLogIds: true }), expectedBuildId: "build", include: ["alpha/plain"] }), (error) => error.code === "protocol_error" && /LOG/u.test(error.message));
});

test("TARGET Scope 日志可在 HELLO 之前实时到达", async () => {
  const logs = [];
  const result = await runCTestSession({ transport: new ScriptedTransport({ targetLog: true }), expectedBuildId: "build", include: ["alpha/plain"], onLog: (log) => logs.push(log) });
  assert.equal(result.groups[0].cases[0].status, "PASS");
  assert.equal(logs[0].scope, "TARGET");
  assert.equal(logs[0].message, "booting");
});
