# 结果目录与 Reporter

每次 `run` 在 `<defaults.resultDir>/<run-id>` 建立独立目录。实时进度写 stderr；`--json` 的 stdout 只返回带 CLI Schema Version 的紧凑索引，包含 `command`、`runId`、`status`、`configHash`、`resultDir` 以及 Result、Summary、Failures 路径。

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

## Artifact 和 Resource

Artifact 指向具体构建产物、日志、Coverage 或外部报告，并携带 fingerprint、Build ID 与必要 metadata。路径属于本次结果目录或明确的受管缓存目录。

Resource 快照会移除不可序列化 Handle，只保留 kind、name、owner、状态和诊断。Job 结束时 owned Resource 已由 Cleanup 关闭；borrowed Resource 不由 Cautest 释放。

退出码与 JSON stdout/stderr 契约见 [cautest.js 命令参考](cli.md)。结果异常或缺少日志时从[故障排查](troubleshooting.md)继续。
