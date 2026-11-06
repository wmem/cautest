// A short, deterministic terminal preview. These are demonstration tests.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineStep, defineScriptTest, executeScriptTest, testConfig, testJob } from "../dist/config/index.js";
import { runCli } from "../dist/runtime/cli.js";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--fail" && arg !== "--generic")) {
  process.stderr.write("用法：node scripts/demo-progress.mjs [--generic] [--fail]\n--generic 演示没有 Case 的通用 Job。\n--fail 注入演示失败：用例模式退出 1，通用任务模式退出 2。\n");
  process.exitCode = args.includes("--help") ? 0 : 3;
} else {
  const fail = args.includes("--fail");
  const generic = args.includes("--generic");
  const root = await mkdtemp(path.join(tmpdir(), "cautest-progress-demo-"));
  const jobs = generic ? ["download", "build", "package"].map(name => testJob({
    id: `demo.${name}`, level: "system", description: "无 Case 的通用任务演示", policy: {resultMode: "steps"},
    workflow: ["prepare", "build", "run", "collect"].map((phase, index) => defineStep({
      kind: "demoTask", name: ["prepare", "build", "verify", "collect"][index], phase,
      ...(phase === "collect" ? {runWhen: "always"} : {}),
      async execute(context) {
        if (phase === "prepare") context.defer(async () => {await new Promise(resolve => setTimeout(resolve, 100));}, "release-demo-resource");
        await new Promise(resolve => setTimeout(resolve, [300, 700, 500, 300][index]));
        if (fail && name === "build" && phase === "build") {
          context.output("stderr", "build: expected output artifact was not produced\n");
          throw new Error("演示错误：任务构建失败");
        }
      },
    })),
  })) : ["math", "spi", "storage"].map(name => testJob({
    id: `demo.${name}`, level: "unit", description: "终端显示演示",
    workflow: [
      defineStep({kind: "demoPrepare", name: "prepare", phase: "prepare", async execute() {
        await new Promise(resolve => setTimeout(resolve, 300));
      }}),
      defineStep({kind: "demoRun", name, phase: "run", async execute(context) {
        context.events.emit("CASE_SELECTION", {jobId: context.job.id, step: name, total: 4});
        const group = await executeScriptTest(defineScriptTest(async ({test}) => {
          for (let index = 1; index <= 4; index++) await test.case(`case_${index}`, async t => {
            await t.wait(400);
            t.expectEqual(1, fail && name === "spi" && index === 2 ? 2 : 1, "设备返回值应为 1");
          });
        }), {name, signal: context.signal, onEvent(type, payload) {
          context.events.emit(type, {jobId: context.job.id, step: name, ...payload,
            ...(payload.case === undefined ? {} : {name: `${name}/${payload.case}`})});
        }});
        return {testResults: [group]};
      }}),
    ],
  }));
  process.stderr.write(`终端演示：${generic ? "3 个模拟通用 Job，每个 4 个步骤，没有 Case" : "3 个模拟 Job，共 12 条用例"}${fail ? "，包含一次演示失败" : ""}。\n`);
  process.exitCode = await runCli(generic ? ["run", "--reporter", "console,html,junit"] : ["run"], process, {loadedConfig: {
    config: testConfig({jobs}), dir: root, path: fileURLToPath(import.meta.url), hash: "terminal-demo", sources: [],
  }});
}
