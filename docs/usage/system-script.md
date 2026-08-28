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

export function systemExampleJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const port = Number(process.env.CAUTEST_EXAMPLE_PORT ?? 18765);
  const url = `http://127.0.0.1:${port}`;
  const script = scriptSystemTestJob({
    id: "system.example-api",
    file: fromExample("system.test.mjs"),
    env: { CAUTEST_EXAMPLE_URL: url },
  });

  return testJob({
    ...script,
    workflow: [
      processStart({
        name: "server",
        program: process.execPath,
        args: [fromExample("server.mjs")],
        env: { CAUTEST_EXAMPLE_PORT: String(port) },
        ready: { kind: "http", url: `${url}/health`, status: 200, bodyIncludes: '"status":"ok"' },
      }),
      ...script.workflow,
      collectLogs({ from: "server" }),
    ],
  });
}

export default testConfig({ jobs: [systemExampleJob()] });
```

测试模块用 `defineScriptTest()` 声明 Case。示例在 Ready Probe 成功后再次请求真实 HTTP Endpoint，并断言状态码和响应体；抛出异常表示 ERROR，`t.expect()`、`t.assertEqual()` 和 `t.fail()` 产生结构化失败：

```js
import { defineScriptTest } from "@cautest/config.js";

export default defineScriptTest(async ({ test, signal, env }) => {
  await test.case("health endpoint returns ok", async (t) => {
    const response = await fetch(`${env.CAUTEST_EXAMPLE_URL}/health`, { signal });
    t.assertEqual(200, response.status);
    t.expectEqual('{"status":"ok"}\n', await response.text());
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

成功时 `health endpoint returns ok` Case 为 PASS，服务 stdout/stderr 作为 Artifact 保存；进程由 Resource 生命周期自动关闭。服务没有 Ready 时先检查 `processStart.ready` 的 URL、状态、响应体和超时。Script Test 上下文和 System Step 的精确接口位于 `lib/config/index.d.ts`、`lib/config/schema/system.d.ts`。
