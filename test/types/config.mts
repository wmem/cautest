import {
  defineStep,
  jobNamespace,
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

// @ts-expect-error 绑定公共默认值后，未提供默认值的 source 仍然必填。
configured({ id: "unit.missing" });

// @ts-expect-error definitions 的 Schema 必须与 factory 输入一致。
jobNamespace({ namespace: "unit.invalid", source: import.meta.url, factory: configured, definitions: [{ name: "bad" }] });
