# Native C Test

Native C Test 把可以在开发机直接编译和运行的 C 代码变成标准 Test Job。它适合不依赖 Kernel API、真实 Driver 或硬件外设的单元与组件测试；这些目标环境分别由 Kernel、Driver 和 MCU Capability 承担。

## 从源码到结构化结果

Job 声明测试源码、产品源码和必要的构建输入。执行时，Cautest 解析文件 Pattern，生成 Registry 和程序入口，把源码与 C Runtime 编译为本机可执行文件，再启动目标进程。Host 与目标进程通过 CTP3 交换 Catalog、选择条件和执行事件，因此结果保留 Suite、Case、Assertion、日志以及 expected/actual，而不依赖 Console 文本反推状态。

编译和运行是两个独立责任。构建目录按 Compiler、Flag、宏、输入路径和声明环境区分；源码与 Header 的时间戳依赖由 Make 和编译器 depfile 管理，每轮仍调用 Make，不读取文件内容判断缓存。构建失败会阻止运行，缺失输出由 Make 重建；不提供二进制内容损坏检测。运行阶段负责选择、Case 超时和 Suite Policy，改变这些条件不要求重新描述 Job 的构建输入。

## 边界、失败与附加产物

源码或工具链问题属于构建/基础设施错误；CTP3 身份、事件顺序或 Target 生命周期异常属于运行基础设施错误；Assertion、FAIL、SKIP 和 ERROR 则按 C Test 语义进入结构化 Case 结果。启用 GCOV 时，覆盖率作为运行后的附加收集步骤生成，不替代标准测试结果。

测试作者从[运行 Native C 测试](../usage/native-c.md)开始；C 测试生命周期和断言语义见 [C Test API](../specifications/c-test-api.md)。精确配置由 `NativeCTestJobInput`、`NativeCBuildInput` 和 `NativeCoverageInput` 定义，见源码 `src/config/schema/native.ts` 或安装后的 `lib/config/schema/native.d.ts`。
