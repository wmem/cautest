# 运行 Script System Test

Script System Test 适合从进程外部验证服务、CLI 或系统集成行为。Workflow 可以启动被测进程、等待 Ready 条件、执行 JavaScript Case，最后无论成功或失败都收集日志并清理资源。

完整示例位于 `examples/system-script/`：

```text
examples/system-script/
├── cautest.config.mjs
├── server.mjs
└── system.test.mjs
```

配置先创建 Script Test Job，再把服务生命周期组合进去：

```js
import { collectLogs, processStart, scriptSystemTestJob, testConfig, testJob } from "@cautest/config.js";

const script = scriptSystemTestJob({ id: "system.example-api", file: "system.test.mjs" });
export default testConfig({ jobs: [testJob({
  ...script,
  workflow: [
    processStart({ name: "server", program: process.execPath, args: ["server.mjs"], ready: { kind: "file", path: ".cautest/server.ready" } }),
    ...script.workflow,
    collectLogs({ from: "server" }),
  ],
})] });
```

测试模块用 `defineScriptTest()` 声明 Case。抛出异常表示 ERROR，`t.expect()`、`t.assertEqual()` 和 `t.fail()` 产生结构化失败：

```js
import { defineScriptTest } from "@cautest/config.js";

export default defineScriptTest(async ({ test }) => {
  await test.case("server is ready", async (t) => {
    t.expect(true, "processStart 已完成 Ready Probe");
  });
});
```

运行示例：

```bash
cd examples/system-script
../../cautest.js doctor
../../cautest.js list
../../cautest.js plan system.example-api
../../cautest.js run system.example-api
```

成功时 Case 为 PASS，服务 stdout/stderr 作为 Artifact 保存；进程由 Resource 生命周期自动关闭。服务没有 Ready 时先检查 `processStart.ready` 的类型、路径和超时。Script Test 上下文和 System Step 的精确接口位于 `lib/config/index.d.ts`、`lib/config/schema/system.d.ts`。
