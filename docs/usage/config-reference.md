# 配置 API 索引

普通配置只从 `@cautest/config.js` 导入。安装目录中的 `lib/config/index.d.ts` 是这个逻辑入口的声明文件；`lib/config/schema/*.d.ts` 保存各场景参数。不要从 `lib/` 的内部目录直接导入实现模块。

如果使用 VS Code 或 TypeScript Language Service，可以在项目根目录添加：

```json
{
  "compilerOptions": {
    "checkJs": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "paths": {
      "@cautest/config.js": ["./tools/cautest/lib/config/index.d.ts"]
    }
  }
}
```

## 根配置和公共 Job

| 函数 | 主要 Interface | 声明文件 |
| --- | --- | --- |
| `testConfig()` | `TestConfigInput`、`TestConfigDefaultsInput`、`TestProfileInput` | `lib/config/schema/common.d.ts` |
| `testJob()` | `TestJobInput`、`TestJobCommonInput` | `lib/config/schema/common.d.ts` |
| `withJobDefaults()` | `TestJobFactory`、`JobInputWithDefaults` | `lib/config/schema/common.d.ts` |
| `jobNamespace()` | `JobNamespaceInput`、`NamedJobDefinition` | `lib/config/schema/common.d.ts` |

所有标准 Job 的 `id`、`level`、`tags`、`enabled`、`timeoutMs`、`env` 和 `policy` 都来自 `TestJobCommonInput`。

## 标准 Job Factory

| 场景函数 | 主要 Interface | 声明文件 |
| --- | --- | --- |
| `nativeCTestJob()` | `NativeCTestJobInput` | `lib/config/schema/native.d.ts` |
| `nativeCTestJobFactory()` | `NativeCTestJobFactoryInput` | `lib/config/schema/native.d.ts` |
| `umlKernelEnvironment()` | `UmlKernelEnvironmentInput` | `lib/config/schema/kernel.d.ts` |
| `kernelCTestJob()` | `KernelCTestJobInput` | `lib/config/schema/kernel.d.ts` |
| `kernelCTestJobFactory()` | `KernelCTestJobFactoryInput` | `lib/config/schema/kernel.d.ts` |
| `driverAbiCTestJob()` | `DriverAbiCTestJobInput` | `lib/config/schema/driver.d.ts` |
| `driverAbiCTestJobFactory()` | `DriverAbiCTestJobFactoryInput` | `lib/config/schema/driver.d.ts` |
| `mcuCTestJob()` | `McuCTestJobInput` | `lib/config/schema/mcu.d.ts` |
| `scriptSystemTestJob()` | `ScriptSystemTestJobInput` | `lib/config/schema/system.d.ts` |

公共 C Test 选择、Case/Run/Step 超时、Suite Policy 和 Session 参数由 `CTestRunInput` 定义，位于 `common.d.ts`。

## System Script 和标准 Step

`defineScriptTest()` 的上下文、断言与 `exec` 接口位于 `lib/system/script-test.d.ts`。进程、Ready Probe、外部结果和日志 Step 位于 `lib/steps/system.d.ts`：

| 能力 | 入口 |
| --- | --- |
| 启动或附加进程 | `processStart()`、`processAttach()` |
| 等待 Ready | `waitForReady()`、`waitReady()` |
| 执行命令 | `execStep()`、`shellExec()` |
| 接入已有测试结果 | `externalTest()`、`parseJsonResults()`、`parseJUnit()` |
| 收集日志或自定义 Collect | `collectLogs()`、`collectStep()` |

## Workflow 组合和扩展

配置入口还公开以下高级能力：

- `defineFragment()`、`standardJobFragment()`、`composeJobWorkflows()`：复用标准 Job 的 Workflow；
- `defineStep()`、`testJob()`：标准 Job 无法表达时创建自定义 Step；
- `SimulatedMcuBoard`、`McuBoardAdapter`、`McuCtpTransport`：实现或测试 MCU Board 接入；
- `ProcessTransport`、`StreamTransport`、`CTestSession`：程序化接入 CTP3 Target；
- `executeWorkflow()`、`executeRun()` 和 Reporter 函数：嵌入式调用执行与报告层。

这些入口的类型由 `lib/config/index.d.ts` 继续导出到相应声明文件。普通 `cautest.config.mjs` 不需要直接使用执行器、Cache、协议解析器或 Result Writer；它们属于扩展接口，不是生成标准 Job 的必读内容。

## C 测试与 Probe Header

| 用途 | 权威文件 |
| --- | --- |
| Case、Suite、Fixture、Assertion、日志 | `assets/cautest-c/include/cautest/cautest.h` |
| CTP3 协议常量和 Frame | `assets/cautest-c/include/cautest/ctp3.h` |
| Kernel Test Runtime | `assets/cautest-c/target/linux-kernel/include/cautest/kernel_runtime.h` |
| Driver Test-only Probe | `assets/cautest-c/platform/linux-kernel/include/cautest/probe.h` |
| UML Guest Probe Client | `assets/cautest-c/agent/uml-guest-agent/probe_client.h` |

常用 C 写法先读[编写 C 测试](write-c-tests.md)，只有实现 Platform Adapter 或协议接入时才需要继续阅读底层 Header。
