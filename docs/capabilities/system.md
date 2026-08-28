# Script System Test

Script System Test 用 JavaScript 从进程外部验证服务、CLI 或系统集成行为。它把 Case 生命周期、Assertion、超时、日志和附件转换为标准 Result，因此可以与 Native、Kernel、Driver 和 MCU Job 使用相同的选择、执行和报告方式。

## 测试模块的执行模型

Job 动态加载并校验测试模块，再按声明顺序执行 Case。顶层回调获得受 Workflow 管理的命令执行函数、AbortSignal 和冻结的 Job 环境；每个 Case 获得独立 Context 和可覆盖的超时。继续执行的 Expect、终止当前 Case 的 Assert、显式 FAIL/SKIP、日志和附件都会形成结构化事件或结果，而不是只写 Console 文本。

测试模块也可以使用低层 `{ cases: [{ name, run }] }` Schema。无论采用哪种声明方式，Case Start/End、失败 Assertion、Skip 和异常都进入统一 Event Recorder；未捕获异常或执行条件损坏形成 ERROR，不伪装为 Assertion 失败。

## 与系统资源的边界

Script Test 本身只描述测试模块。服务启动、Ready Probe、外部进程日志和资源清理由标准 Workflow Step 组合；这些 Step 共享 Job 的 AbortSignal、失败传播和 LIFO Cleanup。只有多个能力必须共享同一次 Job 生命周期时才组合 Workflow，普通项目应优先保留独立 Job。

测试作者从[运行 Script System Test](../usage/system-script.md)开始；需要共享服务与其他标准能力时再读[组合多个标准 Workflow](../usage/workflow.md)。精确接口由 `ScriptSystemTestJobInput`、`ScriptSystemTestDefinition` 以及安装后的 `lib/config/index.d.ts`、`lib/config/schema/system.d.ts` 定义。
