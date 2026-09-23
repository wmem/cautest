import {
  selectJobs,
  type JobSelectionInput,
  defineStep,
  defineFragment,
  standardJobFragment,
  defineScriptTest,
  externalTest,
  jobNamespace,
  nativeCTestJob,
  nativeCTestJobFactory,
  processStart,
  kernelCTestJobFactory,
  driverAbiCTestJobFactory,
  mcuCTestJob,
  scriptSystemTestJob,
  umlKernelEnvironment,
  testJob,
  withJobDefaults,
  type TestJobCommonInput,
  type TestJobFactory,
  type WorkflowStep,
} from "../../dist/config/index.js";

interface FixtureInput extends TestJobCommonInput {
  readonly source: string;
  readonly level: "unit";
  readonly workflow: readonly WorkflowStep[];
}

const run = defineStep({ kind: "typeFixture", phase: "run", execute() {} });
const fixture: TestJobFactory<FixtureInput> = (input) => testJob({
  id: input.id,
  level: input.level,
  workflow: input.workflow,
});
const configured = withJobDefaults(fixture, { level: "unit", workflow: [run] });

configured({ id: "unit.direct", source: "direct.c" });
testJob({ id: "unit.fragment", level: "unit", workflow: [standardJobFragment(nativeCTestJob({ id: "unit.fragment.source", tests: ["source.c"] }), { phases: ["build"] }), defineFragment(run)] });
jobNamespace({
  namespace: "unit.utils",
  source: import.meta.url,
  factory: configured,
  definitions: [{ name: "queue", source: "queue.c" }],
});

nativeCTestJob({ id: "unit.native.smoke", tests: ["test/**/*_test.c"] });
nativeCTestJobFactory({ defaults: { build: { compiler: "clang" } } })({
  id: "unit.native.clang",
  tests: ["test/clang_test.c"],
});

const uml = umlKernelEnvironment({ kernel: { sourceDir: "vendor/linux" }, busybox: { sourceDir: "vendor/busybox" } });
kernelCTestJobFactory({ environment: uml })({ id: "unit.kernel.queue", tests: ["test/queue_test.c"] });
driverAbiCTestJobFactory({ environment: uml })({ id: "integration.driver", drivers: [{ name: "driver", sourceDir: "driver", output: "driver.ko" }], guest: { tests: ["test/driver.c"] } });
mcuCTestJob({ id: "component.mcu", firmware: { kind: "existing", file: "build/firmware" }, board: { kind: "simulated", maxReadSize: 3, maxWriteSize: 2, disconnectOnce: 20 }, reconnects: 1, recoverTimeouts: true });
scriptSystemTestJob({ id: "system.api", file: "test/api.test.mjs" });
defineScriptTest(async ({ test, exec, signal, env }) => {
  await exec({ program: "true" });
  signal.throwIfAborted();
  await test.case("typed", async (context) => {
    context.expectEqual(env.VALUE, "expected");
    context.assertEqual({ value: 1 }, { value: 1 });
    context.fail("typed failure");
    context.attach("evidence", { value: 1 });
    await context.wait(1);
  }, { timeoutMs: 100 });
});
processStart({ program: "node", args: ["server.mjs"], ready: { kind: "http", url: "http://127.0.0.1:3000/health" } });
externalTest({ program: "tool", resultAdapter: "junit" });

// @ts-expect-error Native C Test 的 tests 是非空必填字段。
nativeCTestJob({ id: "unit.native.missing" });

// @ts-expect-error 绑定公共默认值后，未提供默认值的 source 仍然必填。
configured({ id: "unit.missing" });

// @ts-expect-error definitions 的 Schema 必须与 factory 输入一致。
jobNamespace({ namespace: "unit.invalid", source: import.meta.url, factory: configured, definitions: [{ name: "bad" }] });

const selection: JobSelectionInput = { selectors: ["unit.*"], levels: ["unit"], tags: ["native"], includeDisabled: true };
const selected = selectJobs([configured({ id: "unit.selection", source: "selection.c" })], selection);
// @ts-expect-error The public selector returns an immutable collection.
selected.push(configured({ id: "unit.invalid.push", source: "selection.c" }));
// @ts-expect-error Scalar tags are not silently converted into a list.
selectJobs([], { tags: "native" });

// npm self-reference resolves the same public declarations as the standalone API.
import { selectJobs as npmSelectJobs } from "cautest";
npmSelectJobs([], { tags: ["native"] });
