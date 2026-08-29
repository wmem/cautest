# cautest.js 命令、输出与退出码

以下示例假设从项目根目录运行，并把安装位置保存为变量：

```bash
CAUTEST=./tools/cautest/cautest.js
```

使用 `"$CAUTEST" --help` 查看总帮助，使用 `"$CAUTEST" help run` 或 `"$CAUTEST" run --help` 查看子命令帮助。

## 命令概览

| 命令 | 作用 | 是否执行测试 |
| --- | --- | --- |
| `list` | 列出最终 Job ID、Level、启用状态和 Tag | 否 |
| `plan` | 展开所选 Job 的实际 Workflow 和 Step 顺序 | 否 |
| `describe` | 查看配置来源、默认项、`configHash`、Job 和公开 Preset 摘要 | 否 |
| `doctor` | 检查配置输入、宿主工具和昂贵构建的前置条件 | 否 |
| `run` | 执行所选 Job 并写入标准结果目录 | 是 |
| `session` | 不加载 Job，直接连接 process/socket/serial CTP3 Target | 是 |
| `clean` | 选择性删除根配置声明的受管目录 | 否 |
| `help` | 显示总帮助或子命令帮助 | 否 |

完整命令形状：

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

根配置默认从当前目录向上查找 `cautest.config.mjs`。需要从其他目录运行时显式传入 `--config <文件>`。

## 查询和诊断

建议在第一次运行或修改配置后依次执行：

```bash
"$CAUTEST" doctor
"$CAUTEST" list
"$CAUTEST" plan
"$CAUTEST" run
```

`plan` 显示最终 Job 来源、完整 ID 和严格执行顺序。`describe` 额外显示所有配置来源、最终默认项与 `configHash`；不指定 Job 时也列出公开 Job Factory/Preset，指定名称可以查询概要：

```bash
"$CAUTEST" describe nativeCTestJob --json
```

`doctor` 只检查所选 Job 实际需要的工具和输入，不会因为项目包含普通 Native Job 就无条件要求 Kernel/UML 环境。诊断带稳定 Code、Severity、Job、Step 和修复提示；Warning 不改变成功退出码，Error 返回 2。

## 选择 Job

位置参数接受精确 Job ID 或 Glob。`--level` 和可重复的 `--tag` 会继续筛选：

```bash
"$CAUTEST" run 'unit.*' --level unit --tag fast
"$CAUTEST" plan 'integration.driver-*'
```

Level 为 `unit`、`component`、`integration` 或 `system`。多个 `--tag` 使用 AND 语义，即 Job 必须同时包含所有指定 Tag。`run` 不执行 disabled Job；`--fail-fast` 在第一个失败 Job 后停止启动后续 Job。

显式 ID/Glob、Level 或 Tag 没有选中任何 Job 时返回 4。无筛选的空 `list` 仍是成功查询。

## 覆盖 C Test 选择和运行参数

`run` 的下列选项只覆盖所选标准 Native、Kernel、Driver 或 MCU Job 的 C Test Run，不改变构建输入：

- `--include`、`--exclude`：Case Pattern，可重复；
- `--suite`、`--case`、`--parameter`：精确名称，可重复；
- `--step`：存在多个同名 Case 范围时指定一个 Run Step，只能与 `--case` 同用；
- `--suite-policy`：`CONTINUE`、`STOP_ON_FAIL` 或 `STOP_ON_ERROR`；
- `--case-timeout <ms>`：单个 Case 的执行超时；
- `--run-timeout <ms>`：整次 C Test Run 超时。

`--run-timeout` 不会延长 Compile、Kernel、BusyBox、Module、Firmware、Rootfs 或 Provision Step。构建 Step 超时必须设置相应 Job 配置的 `timeoutMs`。

## 输出、JSON 和 Reporter

普通模式在 stdout 打印 Console 结果；实时 Step 进度和 heartbeat 写 stderr。`--verbose` 还会把构建与目标进程输出实时转发到 stderr。

`run --json` 的 stdout 只包含一份有界的紧凑索引，包括 `runId`、状态、`configHash`、结果目录及标准文件路径；完整 Case、事件和 Artifact 保存在磁盘，不会随着测试数量无限扩大 stdout。CI 应分别捕获 stdout、stderr 和进程退出码。

Reporter 可通过 Profile 或 CLI 选择：

```bash
"$CAUTEST" run --profile ci
"$CAUTEST" run --reporter json --reporter junit --reporter html
```

支持 `console`、`json`、`junit`、`html`。CLI 显式 `--reporter` 优先于 Profile；`--output-dir` 只覆盖本次结果根目录。文件说明见[结果目录与 Reporter](results.md)。

## Direct Session

`session` 不加载项目配置，直接把 process、Unix Socket 或 serial CTP3 Target 包装成标准 Run：

```bash
"$CAUTEST" session process --target ./build/test-target
"$CAUTEST" session attach --socket .cautest/target.sock
"$CAUTEST" session serial --device /dev/ttyUSB0 --baud 115200
```

它仍然支持 Case 选择、超时、Reporter、结构化结果和 Target Log。Serial 模式使用系统 `stty` 配置 raw、无 echo。

## 清理

```bash
"$CAUTEST" clean --results
"$CAUTEST" clean --cache --generated --work
"$CAUTEST" clean --all
```

`clean` 只删除根配置 `defaults` 声明的 `resultDir`、`cacheDir`、`generatedDir`、`workDir`。命令拒绝配置根本身和配置目录之外的路径，不会清理产品源码树。

## 退出码

| 退出码 | 含义 | 常见处理 |
| --- | --- | --- |
| `0` | 命令成功，测试没有 FAIL/ERROR | 继续流水线 |
| `1` | 至少一个结构化测试 Case 为 FAIL | 修复产品或测试断言 |
| `2` | 构建、环境、Target、协议或 Cleanup 等基础设施 ERROR | 查看诊断、stderr 和 `failures.jsonl` |
| `3` | CLI 参数、配置加载或执行计划错误 | 修正命令或 `cautest.config.mjs` |
| `4` | 显式选择没有得到允许执行的 Job | 检查 ID、Glob、Level、Tag 和 enabled |
| `130` | 用户通过 Ctrl-C 中断 | 确认 Collect/Cleanup 已完成后决定是否重试 |

第一次 Ctrl-C 会请求取消：当前 Step 接收 AbortSignal，Collect 和 LIFO Cleanup 仍有机会执行，结果照常落盘。清理尚未结束时再次 Ctrl-C 会立即强制退出 130。
