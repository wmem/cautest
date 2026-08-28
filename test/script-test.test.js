import assert from "node:assert/strict";
import test from "node:test";
import { defineScriptTest, executeScriptTest } from "../dist/config/index.js";

test("Script Test 聚合 EXPECT、ASSERT、SKIP 和异常", async () => {
  let reachedAfterAssert = false;
  const script = defineScriptTest(async ({ test: api }) => {
    await api.case("pass", async (t) => t.expectEqual(1, 1));
    await api.case("expects", async (t) => { t.expect(false, "one"); t.expectEqual("a", "b", "two"); t.log("diagnostic"); });
    await api.case("assert", async (t) => { t.assert(false, "stop"); reachedAfterAssert = true; });
    await api.case("skip", async (t) => t.skip("not available"));
    await api.case("error", async () => { throw new Error("unexpected"); });
  });
  const group = await executeScriptTest(script);
  assert.deepEqual(group.cases.map((item) => item.status), ["PASS", "FAIL", "FAIL", "SKIP", "ERROR"]);
  assert.equal(group.cases[1].failures.length, 2);
  assert.equal(group.cases[1].logs[0], "diagnostic");
  assert.equal(reachedAfterAssert, false);
});

test("Script Case Timeout 记为 ERROR", async () => {
  const script = defineScriptTest(async ({ test: api }) => { await api.case("slow", async (t) => t.wait(100)); });
  const group = await executeScriptTest(script, { caseTimeoutMs: 5 });
  assert.equal(group.cases[0].status, "ERROR");
  assert.equal(group.cases[0].error.code, "timeout_error");
});

test("Script 顶层异常传播且每次执行获得隔离只读 Env", async () => {
  await assert.rejects(executeScriptTest(defineScriptTest(async () => { throw new Error("init failed"); })), /init failed/u);
  const seen = [];
  const script = defineScriptTest(async ({ test: api, env }) => { seen.push({ value: env.VALUE, frozen: Object.isFrozen(env) }); await api.case("env", async (t) => t.expect(Boolean(env.VALUE))); });
  const [first, second] = await Promise.all([executeScriptTest(script, { env: { VALUE: "alpha" } }), executeScriptTest(script, { env: { VALUE: "beta" } })]);
  assert.deepEqual(seen.map((item) => item.value).sort(), ["alpha", "beta"]);
  assert.ok(seen.every((item) => item.frozen));
  assert.equal(first.cases[0].status, "PASS");
  assert.equal(second.cases[0].status, "PASS");
});

test("Script Test 支持 assertEqual/fail/attach、Case 级 timeout 和统一事件", async () => {
  const events = [];
  let afterAssert = false;
  const script = defineScriptTest(async ({ test: api, exec, signal, env }) => {
    assert.equal(signal.aborted, false);
    assert.equal(env.MODE, "test");
    assert.equal((await exec({ program: "fixture" })).stdout, "executed");
    await api.case("features", async (t) => {
      t.expectEqual({ nested: [1, 2] }, { nested: [1, 2] });
      t.fail("recorded failure");
      t.attach("response", { status: 503 });
    });
    await api.case("assert-equal", async (t) => { t.assertEqual({ value: 1 }, { value: 2 }, "deep mismatch"); afterAssert = true; });
    await api.case("short-timeout", async (t) => t.wait(100), { timeoutMs: 5 });
  });
  const group = await executeScriptTest(script, {
    env: { MODE: "test" },
    async exec() { return { exitCode: 0, stdout: "executed", stderr: "" }; },
    onEvent(type, payload) { events.push({ type, ...payload }); },
  });
  assert.deepEqual(group.cases.map((item) => item.status), ["FAIL", "FAIL", "ERROR"]);
  assert.deepEqual(group.cases[0].attachments, [{ name: "response", value: { status: 503 } }]);
  assert.equal(afterAssert, false);
  assert.equal(group.cases[2].error.code, "timeout_error");
  assert.equal(events.filter((event) => event.type === "CASE_START").length, 3);
  assert.equal(events.filter((event) => event.type === "CASE_END").length, 3);
  assert.deepEqual(events.filter((event) => event.type === "ASSERTION").map((event) => event.message), ["recorded failure", "deep mismatch"]);
  assert.equal(events.at(0).type, "TEST_GROUP_START");
  assert.equal(events.at(-1).type, "TEST_GROUP_END");
});
