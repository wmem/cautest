# Script System Test

配置只引用测试模块：

```js
scriptSystemTestJob({
  id: "system.api.health",
  file: "test/system/api-health.test.mjs",
  caseTimeoutMs: 5000,
});
```

测试模块推荐使用渐进 Assertion API：

```js
import { defineScriptTest } from "@cautest/config.js";

export default defineScriptTest(async ({ test, exec, signal, env }) => {
  const service = await exec({ program: "curl", args: ["-sS", env.API_URL] });
  await test.case("health endpoint", async (t) => {
    signal.throwIfAborted();
    t.assertEqual(0, service.exitCode);
    t.expectEqual('{"status":"ok"}', service.stdout);
    t.attach("response", service.stdout);
  }, { timeoutMs: 3000 });
});
```

顶层回调获得受 Workflow 管理的 `exec`、AbortSignal 和冻结 Job Env。Case Context 提供继续执行的 `expect`/`expectEqual`/`fail`、终止当前 Case 的 `assert`/`assertEqual`、`skip`、`log`、`attach` 和可取消 `wait`；第三个参数可以覆盖单 Case timeout。Case Start/End、失败 Assertion 和 Skip 都进入统一 Run Event。

也可以直接默认导出 `{ cases: [{ name, run }] }` 的低层 Schema。调用链：动态加载并校验定义 → 按序执行每个 Case（独立超时和 AbortSignal）→ 结构化 PASS/FAIL/SKIP/ERROR Result。该 Job 与 Native、Kernel、MCU 一样只是普通 `TestJob`，可以和它们放在同一个 `jobs` 数组中。

权威 Schema：`ScriptSystemTestJobInput`、`ScriptSystemTestDefinition`，见源码 `src/config/schema/system.ts` 或安装后的 `lib/config/schema/system.d.ts`。
