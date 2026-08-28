# CLI、Doctor 与结果

```text
cautest list [--json]
cautest plan [Job ID...] [--json]
cautest describe [Job ID...] [--json]
cautest doctor [Job ID...] [--json]
cautest run [Job ID/Glob...] [--level <层级>] [--tag <标签>]
            [--profile <名称>] [--reporter <名称>] [--output-dir <目录>]
            [--include <Pattern>] [--exclude <Pattern>]
            [--suite <名称>] [--case <名称>] [--parameter <名称>]
            [--step <名称>] [--case-timeout <ms>] [--run-timeout <ms>]
            [--suite-policy <值>] [--fail-fast] [--json] [--verbose]
cautest session process --target <程序> [C Test 选择和超时选项]
cautest session attach --socket <Unix Socket> [C Test 选择和超时选项]
cautest session serial --device <设备> --baud <波特率> [C Test 选择和超时选项]
cautest clean [--results] [--cache] [--generated] [--work] [--all]
cautest help <命令>
cautest --version | -V
```

每个子命令也接受 `--help`，例如 `cautest run --help`。

`plan` 显示最终 Job 来源、完整 ID 和严格执行顺序。`describe` 额外显示所有配置来源、最终默认项与 `configHash`；不指定 Job 时也列出公开 Job Factory/Preset，指定其名称可查询概要。

`doctor` 在任何 Executor 和昂贵构建启动前检查 Node.js、C Test Kit、Compiler/Make/GCOV/CPIO、需要时的静态链接和 UML ptrace Probe、四类受管目录可写性，以及源码目录、Kernel in-tree 污染、Makefile/Kbuild、测试/源码/Header/额外输入 Glob、Module Output、`inputRoots` 和 `extraModules` 顺序。检查按所选 Job 的实际工具需求执行，不会无条件要求 Kernel/UML 工具。诊断包含稳定错误码和修复提示；检查失败属于基础设施错误，退出码为 2。

Job 参数支持精确 ID 或 Glob；`--level` 和可重复的 `--tag` 在展开后筛选普通 Job。`--fail-fast` 只影响 Job 级调度，不改变 CTP3 Suite Policy。

`run` 的 C Test 选项临时覆盖所选标准 Native、Kernel、Driver、MCU Job 的 Run Step。`--include`、`--exclude`、`--suite`、`--case` 和 `--parameter` 可重复；`--step` 只与 `--case` 一起使用，用于存在多个同名范围时限定一个 Run Step。`--suite-policy` 接受 `CONTINUE`、`STOP_ON_FAIL` 或 `STOP_ON_ERROR`。

`session` 不加载项目 Job，直接把 process、Unix Socket 或 serial CTP3 Target 包装成标准 Workflow Run，因此仍然生成统一事件、Target Log、结构化结果和 Reporter。Serial 模式使用系统 `stty` 配置 raw/无 echo。

`run` 的 stdout 在 `--json` 下只包含一份结构化 Run 对象，实时进度始终写 stderr。每个 Job/Step 都有 START/END、状态和耗时；长 Step 默认每 30 秒 heartbeat；`--verbose` 把构建输出实时转发到 stderr。可用 `CAUTEST_HEARTBEAT_MS` 调整 heartbeat 周期。

运行期间第一次按 Ctrl-C 会把 SIGINT 转为 AbortSignal：当前普通 Step 取消后，`runWhen: "always"`/`"on-failure"` 的 Collect Step 与 LIFO Cleanup 仍会执行，后续 Job 不再启动，结果照常落盘，进程最终返回 130。清理尚未结束时再次按 Ctrl-C 会立即强制返回 130。

退出码固定为：`0` 成功、`1` 测试 FAIL、`2` 构建/环境/协议等基础设施 ERROR、`3` CLI/Config/Plan 错误、`4` 不允许的空 Job 选择、`130` 用户中断。显式 Job/Glob、Level 或 Tag 未匹配，以及 `run` 只选中 disabled Job，都会返回 4；无筛选的空 `list` 仍是成功查询。

结果目录为 `<defaults.resultDir>/<run-id>`，`--output-dir` 可覆盖本次结果根目录。stdout JSON 包含 `runId`、`configHash` 和 `resultDir`；磁盘 `summary.json` 是用于快速读取的精简索引，完整对象在 `result.json`。`--reporter console/json/junit/html`（可逗号分隔或重复）优先于 Profile；未显式指定时使用 Profile Reporter，再默认使用 Console。详见[结果目录与 Reporter](results.md)。

`clean` 按 `--results`、`--cache`、`--generated`、`--work` 删除根配置 `defaults` 声明的对应目录，`--all` 选择全部；命令拒绝配置根本身或配置目录之外的路径。Kernel Module 构建不污染源码，所以不需要猜测和清理源码侧 `*.o/*.ko/*.cmd`。
