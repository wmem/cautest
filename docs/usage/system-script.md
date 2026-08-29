# 运行 Script System Test

Script System Test 适合从进程外部验证服务、CLI 或系统集成行为。Workflow 可以启动被测进程、等待 Ready 条件、执行 JavaScript Case，最后无论成功或失败都收集日志并清理资源。

只执行已有 Script Test 文件时，最小 Job 是：

```js
scriptSystemTestJob({
  id: "system.api",
  file: "test/system/api.test.mjs",
});
```

小而典型的服务生命周期示例位于 `examples/system-script/`：

```text
examples/system-script/
├── cautest.config.mjs
├── client.mjs
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
import { getJson } from "./client.mjs";

export default defineScriptTest(async ({ test, signal, env }) => {
  await test.case("health endpoint returns ok", async (t) => {
    const response = await getJson(`${env.CAUTEST_EXAMPLE_URL}/health`, signal);
    t.assertEqual(200, response.status);
    t.expectEqual("ok", response.body.status);
  });

  await test.case("version endpoint returns release", async (t) => {
    const response = await getJson(`${env.CAUTEST_EXAMPLE_URL}/version`, signal);
    t.assertEqual(200, response.status);
    t.expectEqual("1.0.0", response.body.version);
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

成功时两个 Endpoint Case 都为 PASS，服务 stdout/stderr 作为 Artifact 保存；进程由 Resource 生命周期自动关闭。一个 Script Test 文件可以组织共享环境和生命周期的多个 Case，并把通用请求代码放在普通 `.mjs` 模块中；需要独立服务、环境变量、超时或 CI 选择时再拆成多个 Job。通用边界见[组织典型项目](project-organization.md)。

服务没有 Ready 时先检查 `processStart.ready` 的 URL、状态、响应体和超时。`scriptSystemTestJob()` → `ScriptSystemTestJobInput` → `lib/config/schema/system.d.ts`；`defineScriptTest()` 和 System Step 位于 `lib/config/index.d.ts` 导出的相应声明文件，完整映射见[配置 API 索引](config-reference.md)。
