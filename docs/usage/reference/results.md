{% section id="cautest:use:reference:results" title="结果目录与 Reporter" %}

预检通过并开始执行后，每次 `run` 在 `<defaults.resultDir>/<run-id>` 建立独立目录。

实时进度写 stderr；`--json` 的 stdout 只返回带 CLI Schema Version 的紧凑索引，包含 `command`、`runId`、`status`、`configHash`、`resultDir` 以及 Result、Summary、Failures 路径。

预检失败发生在 Run 创建之前，返回退出码 `2` 和 `{ "status": "ERROR", "issues": [...] }`，不创建该目录。

## 标准文件

磁盘中的首要入口是 `summary.json`。它保存状态、时间、Job/Case 计数、失败 Job 索引以及其他标准文件的相对引用；完整 Run 位于 `result.json`。

| 文件 | 用途 |
| --- | --- |
| `summary.json` | 快速判断 Run 状态、计数和其他文件位置 |
| `result.json` | 完整 Run、Job、Step、Case、事件、Artifact 和 Resource 快照 |
| `failures.jsonl` | 按发生顺序读取 Step、Cleanup 和 Case 失败 |
| `events.jsonl` | Run 期间实时写入的生命周期事件 |
| `jobs/<id>/job.json` | 单 Job 完整结果 |
| `jobs/<id>/workflow.json` | 实际 Step 计划及执行状态 |
| `jobs/<id>/diagnostics.json` | Job 和 Step 诊断 |
| `jobs/<id>/artifacts.json` | 构建产物、日志和报告索引 |

失败索引保留 FAIL/ERROR 状态、Suite/Case、源码位置、有界 Assertion/Diagnostic 摘要，并通过 JSON Pointer 风格的 `detailRef` 指回完整对象。自动化程序应先读取 `summary.json`，只在失败或需要详情时进入 `failures.jsonl`、`result.json`。

## Reporter

Profile 或 CLI `--reporter` 可以选择 `console`、`json`、`junit` 或 `html`。CLI 显式选择优先，并不要求先定义 Profile。

| Reporter | 输出 | 适用场景 |
| --- | --- | --- |
| `console` | `console.txt` 和终端摘要 | 本地阅读 |
| `json` | `run.json` | 自定义自动化消费 |
| `junit` | `junit.xml` | CI 测试平台 |
| `html` | `report.html` | 人工浏览 Step、Case、Artifact 和诊断 |

Console 与 JUnit 保留失败 Assertion 的表达式、位置、expected/actual 或首条 Diagnostic；JUnit 为基础设施错误创建带 `infrastructure=true` 的独立 testcase。Reporter 是标准 Result 的附加视图，不替代标准 JSON 文件。

每个 Job 的执行结果保留 `description`；其 `groups[]` 保留 Suite 的 `description`，
`groups[].cases[]` 保留 Case 的 `description`、`expectedBehavior` 及可取得的 `source`。
说明缺失时保存为空字符串。C 源码注释约定见[编写 C 测试](../writing/c-tests.md)。
HTML 按 Job 展示说明、Suite、Case 的目的与预期行为、实际状态和失败证据，并提供整次
运行的计数及 Job 跳转。JUnit 通过 properties 保留说明。默认终端摘要只显示整体
Job/Case 计数、最多 5 项失败索引、报告文件名及结果目录，不重放运行时错误证据或逐项描述。
超出 5 项时提示读取 `failures.jsonl`；成功和跳过的逐项结果保存在报告中。`--verbose` 在运行时显示全部 Case，结束摘要保持同一布局。
`console.txt` 保留各 Job 汇总及 FAIL/ERROR/SKIP 明细。

通用任务通过 `policy.resultMode: "steps"` 声明，Job 结果保存 `resultMode: "steps"` 和实际步骤，
不会伪造 Case。终端摘要与 HTML 按步骤统计并隐藏空的用例信息，HTML 默认展开步骤时间线。
JUnit 将这些步骤映射为带 `workflowStep=true` 属性的 testcase，保留成功、FAIL、ERROR 和 SKIPPED；
清理或 Job 级错误仍通过 infrastructure testcase 表达。该 CI 视图不改变 JSON 中实际的 Case 数量。

交互终端用“总览、用例、任务、状态、当前”五行对齐的状态区显示整体 Job 和当前执行步骤的进度条、
完成数/选中数及状态计数，并把 Job 名称、阶段耗时和测试名称分开呈现。正常的开始/结束记录不刷屏；
断言、协议、构建及清理错误保留在状态区上方。长名称按显示宽度截断，`NO_COLOR=1` 关闭装饰配色。
阶段耗时持续更新，资源释放期间显示“清理中”。Job 的百分比只计算实际完成的 Job，不代表耗时百分比。
重定向或 CI 使用不含终端控制符的逐行进度。C Test 的选中数在目录发现和筛选后获得，
动态 Script Test 未知总数显示 `?`；完成数包含全部四种状态，PASS 仅表示通过数。
多次执行步骤分别计数，Job 结束按实际结果汇总。fail-fast 或取消不会把未启动 Job 算成完成。
进度及结果目录写 stderr，`--json` 的 stdout 保持单份结构化输出。

源码仓库可用 `node scripts/demo-progress.mjs` 查看约 6 秒的演示；添加 `--fail` 演示错误显示，
此时预期退出码为 1。演示使用模拟 Job，不代表产品测试结果；报告写入临时目录。
添加 `--generic` 可查看无 Case 的通用任务，并生成 Console、HTML 和 JUnit 报告；
`--generic --fail` 注入构建步骤错误，预期退出码为 2，后续普通步骤跳过，收集和清理仍执行。

## Artifact 和 Resource

Artifact 指向具体构建产物、日志、Coverage 或外部报告，并携带 fingerprint、Build ID 与必要 metadata。路径属于本次结果目录或明确的受管缓存目录。

Resource 快照会移除不可序列化 Handle，只保留 kind、name、owner、状态和诊断。Job 结束时 owned Resource 已由 Cleanup 关闭；borrowed Resource 不由 Cautest 释放。

退出码与 JSON stdout/stderr 契约见 [cautest.js 命令参考](cli.md)。结果异常或缺少日志时从[故障排查](../troubleshooting.md)继续。

{% /section %}
