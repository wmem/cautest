# 结果目录与 Reporter

每次 `run` 在 `<defaults.resultDir>/<run-id>` 建立独立目录。实时进度写 stderr；`--json` 的 stdout 返回完整 Run JSON 并额外包含 `runId`、`configHash` 和 `resultDir`，因此 Agent/CI 不需要解析 Console 文本。

磁盘中的权威入口是 `summary.json`。它只保留状态、时间、Job/Case 计数以及 `failures.jsonl`、`result.json` 的相对引用；完整 Run 位于 `result.json`。每个 Job 还保存 `job.json`、`workflow.json`、`diagnostics.json` 和 `artifacts.json`。失败索引通过 JSON Pointer 风格的 `detailRef` 指回完整对象。

| 文件 | 用途 |
| --- | --- |
| `summary.json` | 快速判断 Run 状态和计数 |
| `result.json` | 完整 Run、Job、Step、Case、事件、Artifact 和 Resource 快照 |
| `failures.jsonl` | 按发生顺序读取 Step、Cleanup 和 Case 失败 |
| `events.jsonl` | Run 期间实时写入的生命周期事件 |
| `jobs/<id>/job.json` | 单 Job 完整结果 |

Profile 可以声明 `json`、`junit`、`html` 或 `console` Reporter。`cautest run --profile ci` 在标准目录写入 `run.json`、`junit.xml`、`report.html` 或 `console.txt`。JUnit 为基础设施错误创建带 `infrastructure=true` 的独立 testcase；HTML 保留 Step 时间线、Case、Artifact 与诊断。Reporter 是附加视图，不替代标准 JSON 结果。

Artifact 路径指向具体构建产物或日志，并携带 fingerprint、Build ID 与必要 metadata。Resource 快照移除不可序列化 handle，只保留 kind、name、owner、状态和诊断；Job 结束时 owned Resource 已清理，borrowed Resource 不由 Cautest 关闭。
