import {
  defineStep,
  jobNamespace,
  nativeCTestJob,
  nativeCTestJobFactory,
  kernelCTestJobFactory,
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

// @ts-expect-error Native C Test 的 tests 是非空必填字段。
nativeCTestJob({ id: "unit.native.missing" });

// @ts-expect-error 绑定公共默认值后，未提供默认值的 source 仍然必填。
configured({ id: "unit.missing" });

// @ts-expect-error definitions 的 Schema 必须与 factory 输入一致。
jobNamespace({ namespace: "unit.invalid", source: import.meta.url, factory: configured, definitions: [{ name: "bad" }] });
