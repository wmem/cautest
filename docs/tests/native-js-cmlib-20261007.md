# 原生 JS 与 Xmake 编译环境接入验收

2026-10-07，在 Linux x86_64、Node.js 24.15.0、GCC 和 Xmake 3.1.1+HEAD.3ba37a0 上验证 Cautest 0.7.0 / Addon 0.1.5 的原生 JS 路径。C API 2.2、CTP 3.1 和结果 Schema 保持不变，Native fingerprint 升至 3。

## 接入边界

项目的 JS 配置维护测试源码、依赖、Suite、Job 与运行参数。Xmake 可通过根 `set_values("cautest.prepare", "任务名")` 指定环境导出任务；插件执行准备任务后直接启动原生 CLI，不注入 RCFILES、Lua manifest 或测试 target。直接 Node CLI 需要使用方先准备所需环境。

原有 Lua 工程没有 JS 根配置或显式选择 `.lua` 时继续走原链路；GD32 模板的现有 MCU 入口暂未迁移。Native 的可选 build.linker 允许编译和链接驱动分别配置，省略时继续使用 compiler。Make/depfile 负责增量，不读取所有源码内容计算摘要。

## 工具验证

- `npm test`：C Runtime 与类型门禁通过，Node 测试 175 PASS、0 FAIL/SKIP。包含原生插件真实 Xmake 回归、Native 增量依赖和独立链接驱动检查。
- [插件回归](../../test/xmake-js-native.test.js)：准备任务先于 JS 配置读取；外部目录与含空格路径；list/plan；筛选和重复 Reporter 参数转发；FAIL 返回 1；准备失败不启动 CLI，准备输出不污染 JSON stdout。
- [增量回归](../../test/build-incremental.test.js)：独立编译/链接调用，无变化不重新执行编译和链接，链接失败移除旧产物；已有真实头文件依赖、缺失 depfile、编译失败和并发用例仍通过。
- Addon 索引的隔离真实配方安装回归 20 PASS，包含 TS 构建、原生 JS / 直接 CLI 和原有 Lua、公开 MCU 构建入口；隔离环境不修改用户全局配置。

## cmlib 迁移验证

消费工程为 gd32-template 内的 cmlib 组件，迁移前提交 58e320b。先重新运行 Lua 基线，59 个 Job、236 个 Case 全部通过；10 个目录改用 JS 声明后，发现结果的 ID、顺序、level、tags 和 enabled 与基线一致，原生全量仍 PASS 236、FAIL/ERROR/SKIP 0。库源码和原有 C 用例没有修改。保留导出表链接片段、cprint disabled 变体及串口编译探针。

原生全量日志保存在消费工程的 build/js-tests-full.log，迁移前基线在 build/js-tests-baseline-unit.log。这些本机生成记录不随工具包交付；发布插件的再次执行结果由消费工程 test/README.md 记录。本轮不包含真实 Kernel UML、SPI/Flash 或其他 MCU 验收。
