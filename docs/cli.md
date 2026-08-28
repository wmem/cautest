# CLI、Doctor 与结果

```text
cautest list [--json]
cautest plan [Job ID...] [--json]
cautest describe [Job ID...] [--json]
cautest doctor [Job ID...] [--json]
cautest run [Job ID/Glob...] [--level <层级>] [--tag <标签>]
            [--profile <名称>] [--fail-fast] [--json] [--verbose]
cautest clean --all
cautest help <命令>
cautest --version | -V
```

每个子命令也接受 `--help`，例如 `cautest run --help`。

`plan` 显示最终 Job 来源、完整 ID 和严格执行顺序。`describe` 额外显示所有配置来源、最终默认项与 `configHash`。

`doctor` 在任何 Executor 和昂贵构建启动前检查源码目录、Makefile/Kbuild、测试/源码/Header/额外输入 Glob、Module Output、`inputRoots` 和 `extraModules` 顺序。诊断包含稳定错误码和修复提示；错误退出码为 5。

Job 参数支持精确 ID 或 Glob；`--level` 和可重复的 `--tag` 在展开后筛选普通 Job。`--fail-fast` 只影响 Job 级调度，不改变 CTP3 Suite Policy。

`run` 的 stdout 在 `--json` 下只包含一份结构化 Run 对象，实时进度始终写 stderr。每个 Job/Step 都有 START/END、状态和耗时；长 Step 默认每 30 秒 heartbeat；`--verbose` 把构建输出实时转发到 stderr。可用 `CAUTEST_HEARTBEAT_MS` 调整 heartbeat 周期。

结果目录为 `<defaults.resultDir>/<run-id>`。stdout JSON 包含 `runId`、`configHash` 和 `resultDir`；磁盘 `summary.json` 是用于快速读取的精简索引，完整对象在 `result.json`。Profile 可以额外生成 JUnit、HTML、JSON 或 Console Report，详见[结果目录与 Reporter](results.md)。

`clean --all` 只删除根配置 `defaults` 声明的 result/cache/generated/work 目录，并拒绝配置根本身或配置目录之外的路径。Kernel Module 构建不污染源码，所以不需要猜测和清理源码侧 `*.o/*.ko/*.cmd`。
