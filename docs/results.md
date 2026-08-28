# 结果目录与 Reporter

每次 `run` 在 `<defaults.resultDir>/<run-id>` 建立独立目录。实时进度写 stderr；`--json` 的 stdout 只返回带 CLI Schema Version 的紧凑索引，包含 `command`、`runId`、`status`、`configHash`、`resultDir` 以及 Result/Summary/Failures 路径，因此 Agent/CI 不会因完整 Case/Event 数量增长而承受无界 stdout。

磁盘中的权威入口是 `summary.json`。它只保留状态、时间、Job/Case 计数、失败 Job 索引以及 `failures.jsonl`、`result.json` 的相对引用；完整 Run 位于 `result.json`。每个 Job 还保存 `job.json`、`workflow.json`、`diagnostics.json` 和 `artifacts.json`。失败索引保留 FAIL/ERROR 状态、Suite/Case、源码位置、有界 Assertion/Diagnostic 摘要，并通过 JSON Pointer 风格的 `detailRef` 指回完整对象。

| 文件 | 用途 |
| --- | --- |
| `summary.json` | 快速判断 Run 状态和计数 |
| `result.json` | 完整 Run、Job、Step、Case、事件、Artifact 和 Resource 快照 |
| `failures.jsonl` | 按发生顺序读取 Step、Cleanup 和 Case 失败 |
| `events.jsonl` | Run 期间实时写入的生命周期事件 |
| `jobs/<id>/job.json` | 单 Job 完整结果 |

Profile 或 CLI `--reporter` 可以选择 `json`、`junit`、`html` 或 `console` Reporter；CLI 显式选择优先，并不要求先定义 Profile。报告在标准 Run 目录写入 `run.json`、`junit.xml`、`report.html` 或 `console.txt`。Console 与 JUnit 会保留失败 Assertion 的表达式、位置、expected/actual 或首条 Diagnostic；JUnit 为基础设施错误创建带 `infrastructure=true` 的独立 testcase；HTML 保留 Step 时间线、Case、Artifact 与诊断。Reporter 是附加视图，不替代标准 JSON 结果。

Artifact 路径指向具体构建产物或日志，并携带 fingerprint、Build ID 与必要 metadata。Resource 快照移除不可序列化 handle，只保留 kind、name、owner、状态和诊断；Job 结束时 owned Resource 已清理，borrowed Resource 不由 Cautest 关闭。
