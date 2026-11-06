{% section id="cautest:use:integration:xmake" title="Xmake Addon 接入" %}

消费工程声明插件后直接运行 `xmake ctest`，默认读取工程根目录的 ctest.lua。插件安装时在 Addon 目录编译 TypeScript；应用不需要 tools/cautest、Node 工程或 init 任务。

```lua {% process=false %}
add_repositories("wmem-xmake-addon git@github.com:wmem/xmake-addons.git")
add_addons("cautest 0.8.0")
```

```lua {% process=false %}
-- ctest.lua：测试可以按目录分散声明。
ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.include {patterns = {"modules/**/test.lua"}}
```

`xmake ctest` 在子进程注入现有测试规则和配置 API；普通工程构建不自动读取 ctest.lua。Native 测试 target 可放在测试配置内。需要随普通构建使用的 MCU 固件 target 应放在工程自己的 xmake.lua 中，并显式 `includes("@addon/cautest/mcu")` 加载公开规则，见下文[真实 MCU 固件](#真实-mcu-固件)。

直接源码接入仍可使用 includes("tools/cautest/xmake.lua") 和旧命令 xmake ct；本页命令默认采用 Addon 的 ctest。准备源码工具时在工具仓库执行 npm ci，工具不会在运行时自动安装依赖。

Choose another Lua configuration with either spelling:

```sh {% process=false %}
xmake ctest --config=tests/host.lua
xmake ctest -c "tests/host.lua" --list --json
```

配置文件的相对路径以所选工程根目录为基准，从其他目录使用 -P 时也相同。选中的文件替代默认配置；其中声明、fragment 和 Native 源码路径仍相对各自声明文件。

本次配置选择同时传给子 Xmake 构建和产物查询，只在本轮调用中生效，不保存到工程的 Xmake 配置。

Xmake 3.1.1 requires `=` for long options that take a value; use
`--config=FILE` or the short option `-c FILE`, rather than `--config FILE`.

兼容旧工程时，includes("ctest.lua") 不会重复加载；使用 --config 时，该行也会跳过默认文件。新工程应让 Cautest 加载配置，改用配置选择前先删除手工 include 的其他测试根文件。

配置加载和错误处理遵守以下边界：

- 没有默认文件时，仍支持既有内联 ctest.* 声明。
- 缺少所选文件或 Lua 配置错误时，ct 在构建及创建执行 Manifest 前退出，退出码为 3。
- 普通工程加载允许默认文件不存在，便于先运行初始化任务。

`CAUTEST_XMAKE_CONFIG` and `CAUTEST_XMAKE_WORKINGDIR` are reserved for internal propagation to build/query processes. Child processes preserve Xmake's independent working/configuration/build directory behavior with `-P`. Job/Profile environments cannot override that selection.

Real default/custom configuration and initialization regressions are in
{% page project="cautest" id="docs/development/sources" anchor="cautest:source:test:xmake-config:test:js" label="`test/xmake-config.test.js`（源码仓库）" /%}; run them through
`CAUTEST_XMAKE=/absolute/path/xmake npm run test:xmake`.

```lua {% process=false %}
-- modules/math/test.lua
-- Relative paths are anchored to this declaring file, not the shell's cwd.
target("test.math")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.native")
    add_files("math_test.c")
    add_values("cautest.registry.suites", "math_test")
target_end()
ctest.native {
    id = "unit.math", target = "test.math", level = "unit",
    tags = {"host", "math"}, run = {suite = "math_*"}
}
```

`cautest.registry.suites` contains **explicit C Suite symbols**, never patterns. The rule creates the Registry, entry point and protocol build identity, and adds the existing C Runtime. `run.suite` is a discovery filter; it is not a linker input.

One target can have several Suites; a Job is not a Case or a Suite.

```sh {% process=false %}
xmake ctest                         # defaults follow ctest.project.selection; otherwise all enabled Jobs
xmake ctest --list --json
xmake ctest --plan unit.math
xmake ctest --doctor --level=unit
xmake ctest --describe --json
xmake ctest --level=unit,component --tag=host,math
xmake ctest --collection=quick,smoke --environment=host,board-debug
xmake ctest --suite='math_*' --case=adds unit.math
xmake ctest --test-profile=ci --reporter=json,junit
xmake ctest --output-dir=out/test-results unit.math
```

Job 的筛选规则与 JS CLI 共用语义：

| 条件 | 规则 |
| --- | --- |
| 多个 Job Pattern | OR |
| 多个 Level | OR |
| 多个 Tag | AND |
| 不同维度 | AND |
| disabled Job | list/plan 保留，run 排除 |
| 未覆盖的 suite/case/include | 继续使用 Lua 配置中的值 |

suite/case/include 按字段覆盖，不改写 Registry。重复 kv 选项在 Xmake 3.1.1 中只保留最后值，因此 Level/Tag 使用逗号列表。

list/plan 不加载 target、不构建，也不调用 Board。doctor 会查询已有 Artifact 并执行静态诊断，但不调用 build Provider。Job/Profile 的 env 不能覆盖 Xmake 配置文件或工作目录选择。

Adapter 模块默认从工具的 dist/ 提供，便携包从 lib/ 提供。

Profile、输出与退出状态另外遵守：

- `--test-profile` 选择 Cautest Profile；Xmake 自身的 `--profile` 保持原用途。
- 退出码沿用旧 CLI：0 成功、1 测试失败、2 执行/基础设施错误、3 配置错误、4 空选择、130 中断。
- POSIX 父进程可能直接观察到 SIGINT；Shell 将它映射为 130。
- 诊断写 stderr；对应旧 CLI 命令会生成 JSON 时，`--json` 的 stdout 保持可解析。空选择特意不生成结果 JSON。

完整命令与退出状态见[CLI 参考](../reference/cli.md)。

## Build and runtime boundary

执行链为：Xmake task → 固定的 Node 模块 → 既有 Workflow build Step → 同一工程中的 xmake build。

- list/plan 不加载 target，也不调用 Provider。
- 上游构建失败后，collect Step 若请求该次无法取得的 Artifact，会被跳过；构建错误仍是 Run 失败原因。
- 工具的 xmake rc 通过显式环境变量和运行标记限定在本轮测试调用内。

构建后实际查询 target-file 并严格校验 Receipt，随后复用未变的 Native/MCU CTP 运行时及现有 Result/JSON/JUnit 引擎。

Manifest 承载声明数据，不将 Lua 源码、函数体、任意表达式或 CLI plan JSON 当作 Manifest 执行。用户指定的 Provider 模块与既有 .mjs 配置文件一样，属于受信的本地配置。

Receipt 分别保存输出角色、路径、大小、构建上下文和 CTP protocolBuildId。每轮执行都会进入普通 Xmake 构建，由 Xmake 判断增量；Cautest 不读取源码树、Header、Git diff 或二进制内容来校验缓存。

缺失输出由 Xmake 重建；构建错误阻止后续执行。

构建复用遵守两项约束：

- 同一次调用中的共享 target 构建会去重；冲突的声明式构建环境应使用隔离 target。
- 消费工程显式隔离 Xmake 配置与输出上下文；Cautest 不从应用 target 猜测继承关系、交叉工具链，或按后缀猜固件/模块输出。

For secondary outputs, declare explicit roles on the real target:

```lua {% process=false %}
add_values("cautest.outputs", "firmware-bin=output/image.bin")
add_values("cautest.protocolBuildId", "identity-embedded-by-the-firmware-build")
```

输出角色与产物查询分工如下：

| 入口 | 行为 |
| --- | --- |
| primary | 来自 target:targetfile() |
| ctest.mcu 的 output | 例如 firmware-bin，选择显式声明的其他角色 |
| phony/custom target | 必须显式声明输出角色 |
| 内部 cautest-artifact task | 只加载 target 元数据，不编译 |
| Native 规则查询 | 读取实际构建产生的身份，不重新生成源码 |

例如用 `ctest.mcu {target="firmware", output="firmware-bin", ...}` 选择其他输出。

每个声明的输出都校验，不只检查选中角色。用户自己的 target load hook 仍由用户控制。

{% relation-diagram id="cautest:reading:xmake-execution" /%}

图中返回 Xmake 的是普通构建与产物查询，不会再次执行 ctest/ct 任务。

## Reuse product code explicitly

The [two-module example](../reference/sources.mdoc#cautest:source:examples:xmake:native:xmake:lua) demonstrates a shared source rule and a separately compiled static library. A consumer's private macros **do not** change an already compiled dependency library; shared source rules recompile in each consumer. Keep product `main`, mocks and test entry points explicit.

Cautest never clones a production target or attempts to copy its include paths/flags/defines automatically.

生成 Header 时，构建顺序与身份规则分别处理：

1. 生成 Header 的生产 target 声明 set_policy("build.fence", true)。
2. 消费 target 通过 add_deps 依赖它；普通链接依赖只约束链接，不足以阻止并行编译。
3. Native Registry 和入口在首次构建、该屏障之后生成，不在 target 加载时生成。

协议身份保存在所选 target 目录的 identity.json 中，增量构建可以复用，不从源码或二进制内容推导。编译、链接及生成 Header 的依赖由 Xmake 判断。

文件变化落在 Xmake 时间戳粒度内时，可能需要显式重建；Cautest 不扫描源码内容强制同秒重建。首次构建和 Header 变化的回归见 test/xmake-robustness.test.js。

Copy `examples/xmake/native` outside this repository, then clone Cautest at that
copy's `tools/cautest`. Prepare the clone before running `xmake ct`. The disabled
negative Job is documentation: `--case=deliberate_failure unit.math` provides an
explicit failing-case demonstration.

## Native GCOV 覆盖率

覆盖率分为构建插桩和运行后收集。在 Native 测试目标上添加
`cautest.gcov`，在对应 Job 上声明 `coverage = {}`：

```lua {% process=false %}
target("test.math")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.native", "cautest.gcov")
    add_files("math_test.c", "math.c")
    add_values("cautest.registry.suites", "math_test")
target_end()
ctest.native {
    id = "unit.math", target = "test.math",
    coverage = {tool = "gcov", timeoutMs = 30000}
}
```

当前支持 Linux GCC 和与之匹配的 gcov。`cautest.gcov` 添加覆盖率编译、链接 参数及 `CAUTEST_GCOV`，使隔离子进程在退出前保存计数。

该 rule 关闭 Xmake 只恢复对象文件的编译缓存，因为它不同时恢复 gcno，且缓存对象中可能保留 另一目标的 gcda 路径；普通时间戳增量构建继续有效。需要统计的独立静态库 也应显式添加 `cautest.gcov`；源码复用 rule 的源码随测试目标一起插桩。

每轮 Job 使用专用 GCOV_PREFIX 目录，按原始对象路径匹配 gcno/gcda，不读取 build 目录的历史计数。同名源码分别处理；共享库 notes 可被多个消费者只读 引用。

gcno 作为 `gcov-note-*` 显式输出进入 Receipt；缺失时只移除对应对象， 由 Xmake 重编译。不使用内容摘要检查 notes；损坏应显式重建。

收集使用 `runWhen = "always"`，测试 FAIL 后仍尝试生成报告， 保留失败状态；工具错误或缺少插桩 notes 返回 ERROR，构建失败不会伪造覆盖率。

Coverage Artifact 的 `metadata.reports` 列出实际 `.gcov` 路径；Xmake 报告位于 本轮结果目录的 `coverage/<Job ID>/reports/`，收集不会将 gcno/gcda 写回构建 目录。

配置加载、list 和 plan 不执行构建或收集，doctor 检查 gcov 是否可用。新声明使用 Xmake Manifest v3，读取方继续接受无 coverage 的 v1。

随包 Native 示例可在准备工具后执行：

```sh {% process=false %}
xmake f -y --coverage=y
xmake ctest --reporter=json,junit
```

真实回归入口为 {% page project="cautest" id="docs/development/sources" anchor="cautest:source:test:xmake-coverage:test:js" label="test/xmake-coverage.test.js（源码仓库）" /%}，
由 `npm run test:xmake` 一并执行；其范围包含同名源码、共享库、重复运行、
失败后收集和 notes 损坏恢复。

## Module workflow providers

### Run 结束收集

单个 Job 的 collect 阶段适合该 Job 的 gcov 和日志；需要汇总所有 Job 时，在项目中声明
Run Collector。所有选中 Job 完成后，工具先保存本轮报告，再依次执行收集器。用例 FAIL、
编译 ERROR、fail-fast 和取消后仍尝试收集；不读取上一轮目录。

```lua {% process=false %}
ctest.project {
    defaults = {resultDir = "build/test-results"},
    collectors = {{
        id = "coverage.summary",
        provider = {module = "test/coverage.mjs", export = "create"},
        timeoutMs = 60000,
    }},
}
```

`create({projectRoot, origin, options})` 只返回回调，构造时不得执行汇总。回调接收 `{run, resultDir, signal, output, exec}`；`exec` 使用 argv、独立超时信号和进程组清理。

相对 provider 路径以声明文件为基准。直接 JavaScript 配置使用公开 `runCollector()` 工厂。

```js {% process=false %}
export function create({projectRoot}) {
  return async ({resultDir, exec}) => {
    const result = await exec({program: process.execPath, args: ["test/merge.mjs", resultDir], cwd: projectRoot});
    if (result.exitCode !== 0) throw new Error(result.stderr || "合并失败");
  };
}
```

收集器结果写入 `result.collectors` 和 `collectors/<ID>/`，不增加测试 Job/Case 计数。收集失败使 Run 返回 ERROR，JSON、失败索引和 JUnit 保留诊断；成功收集不会将原 FAIL、ERROR 或 SKIP 改成成功。

没有实际产物时是否跳过由项目回调判断。list/plan/doctor 不执行回调。Xmake Manifest v4 增加项目收集声明，读取方继续接受 v1 和无收集器的 v3。

```lua {% process=false %}
ctest.workflow {
    id = "integration.application",
    provider = {module = "tests/application.mjs", export = "create"},
    artifacts = {app = {target = "application"}}, options = {}
}
```

Workflow Provider 的构造和执行分开：

| 阶段 | 合同 |
| --- | --- |
| 构造 | create({projectRoot, origin, options, artifacts, getArtifact}) 返回已有 WorkflowStep、WorkflowFragment 或它们的数组 |
| 步骤编排 | Cautest 在开头的 prepare Step 之后插入 build Step |
| 运行 | 用 getArtifact(context, "app") 读取产物，不依赖硬编码 State key |
| 结果 | Provider 产生 Case 结果，或显式选择允许空结果策略 |

构造必须无副作用：list/plan 会加载 Workflow 模块，但不执行 Step，也不调用 build Provider。

Board 与 Kernel/Driver 的接入入口分别是：

- Board：ctest.board {id, provider={module,export}, options, resourceId, ownership} 注册工厂，ctest.mcu {id,target,board} 引用它；Board 模块在实际准备目标时延迟加载，list/plan 不加载。
- 真实 MCU：GD32 已通过直接 CLI 和 Xmake RT-Thread 测试固件验证，见[真实 MCU 接入](../scenarios/mcu-real.md)与 {% page project="cautest" id="docs/development/acceptance/mcu-rtthread-xmake-20261007" label="RTOS 验收（源码仓库）" /%}。
- Kernel/Driver：提供 Artifact Workflow 与共享声明式 UML Environment，见[Kernel/Driver 接入](kernel-driver.md)。

组件合同测试只证明组件边界；真实 UML 的冷/热和失败矩阵单独验收。既有 JS helper 继续可用。

## Scope and validation

ctest.include 的发现与诊断规则如下：

- 未设置 optional=true 时，每个 Pattern 都必须匹配。
- 收集器排序、去重规范化路径，并检测循环。
- 重复 ID 同时报告两个声明文件。
- 每个定义保留文件、声明序号和 include 链；序号不是 Lua 源码行号。
- 必须显式 include，不扫描整个仓库自动发现测试。
- 保留任务名 ct 和 cautest-artifact 冲突时报告错误，不静默覆盖。

Xmake 配置重解析时重置 Registry。导出声明前，ct 加载保存的配置并重新解释描述文件，使 has_config()/get_config() 反映 xmake f 选项。

该轮解释不加载 target、不执行构建 hook，也不安装 Addon 或 package；list/plan 保持只读。

现有实现验证于所提供的 Xmake 3.1.1、Linux x86_64；一个固定的私有 accessor 用于取得当前 Lua 文件名。

其他版本、平台以及真实 MCU SPI 需要各自的验收。真实 UML 的已验证环境和复现入口见[Kernel/Driver 接入](kernel-driver.md)，不由本页的组件验证替代。

## 真实 MCU 固件

`cautest.mcu` 仅添加公共 core、CTP3 和 MCU 运行时，生成 Registry、24 位十六进制 Build ID 及 cautest_config.h。应用负责工具链、启动代码、链接脚本、RTOS、驱动和 C 入口；规则不添加 POSIX main、模拟板或 malloc 移植。普通构建需公开 include：

```lua {% process=false %}
includes("@addon/cautest/mcu")
target("mcu-test")
set_kind("binary")
set_default(false)
-- 此处添加应用自己的芯片/RTOS 规则、源码和链接配置。
add_rules("cautest.mcu")
add_values("cautest.registry.suites", "rtos_thread", "rtos_semaphore")
add_values("cautest.workspaceSize", 2048) -- 可选，默认 2048 字节
add_files("tests/port/runtime.c", "tests/rtos/*.c")
target_end()
```

生成头提供 CAUTEST_MCU_BUILD_ID 和 CAUTEST_MCU_WORKSPACE_SIZE，Registry 符号为 cautest_mcu_registry。

C 入口使用这些值初始化 `cautest/mcu.h`，实现 read/write 并在线程中 poll，完整契约见[板端接入](../scenarios/mcu-real.md#板端只移植收发和启动)。Suite 值是明确的 C 符号，不能写筛选通配符。

生成目录在规则加载时固定，后续芯片规则切换平台和工具链不会改变编译路径；正常增量构建沿用原身份，不读取源码计算摘要。

```lua {% process=false %}
-- ctest.lua：Board Provider 是应用脚本，下载方式由 MSP/平台提供。
ctest.board {
    id = "test-board", resourceId = "probe:实际序列号",
    provider = {module = "tests/board.mjs", export = "create"},
}
ctest.mcu {id = "mcu.all", target = "mcu-test", board = "test-board"}
```

```sh {% process=false %}
xmake build mcu-test              # 仅编译，不连接硬件
xmake ctest --list
xmake ctest --plan mcu.all         # 不调用 Board 工厂
xmake ctest mcu.all               # 构建、烧录、复位、协议执行及清理
xmake ctest --suite='rtos_*' mcu.all
xmake ctest --case=semaphore --reporter=json,junit mcu.all
```

Board 工厂在执行阶段返回 McuBoardAdapter。Build ID 从构建产物 Receipt 传给 Host，Boot ID 从本轮 reset 返回并由固件 HELLO 确认。

普通应用 UART/Shell 能交互不代表存在 Cautest 服务；测试固件占用协议 UART 时应关闭同一路 Shell/打印。GD32 模板的独立 RT-Thread 固件、板配置继承和实测结果见{% page project="cautest" id="docs/development/acceptance/mcu-rtthread-xmake-20261007" label="验证记录（源码仓库）" /%}。

## MCU artifact adapter and physical locking

[MCU Host 模拟](../reference/sources.mdoc#cautest:source:examples:xmake:mcu-simulated:xmake:lua) 用 Xmake 构建真实 C 固件代码，再通过既有 Freestanding MCU/CTP Transport 做分片 I/O。

模拟规则与真实固件的边界是：

| 项目 | 约定 |
| --- | --- |
| cautest.mcu-simulated | 生成显式 Registry，嵌入 24 位十六进制协议身份 |
| 参考 MCU 的身份存储 | 32 字节，包含终止符 |
| 协议身份 | 独立于源码字节；同一 target 目录源码重建可保留身份 |
| 编译与链接增量 | 由 Xmake 处理 |
| 真实固件 | 应用自行维护 target，显式导出固件产物和嵌入的协议身份 |

该模拟不验证真实 MCU、启动/链接脚本或 SPI 实板行为。

Board 工厂接收 {projectRoot, options, origin, signal}，在构建和物理锁就绪后的 provision 阶段才加载，并须响应取消。

| 情况 | 清理责任 |
| --- | --- |
| owned Adapter 的 flash/reset 失败 | Cautest 仍关闭 Adapter |
| borrowed Adapter | Cautest 不关闭 Board |
| 工厂部分分配资源后拒绝 | 工厂自己释放已分配资源 |
| 取消后工厂才返回 owned Adapter | 在任何 flash 前关闭 Adapter |
| 多个 Job 引用同一 Board | 各 Job 使用独立 Board/log 名称，避免覆盖日志 |

无法强制取消不协作的任意 JavaScript；工厂不要启动未跟踪的异步设备工作。

Board 必须提供 resourceId。同一探针或串口的不同别名，使用同一物理 ID：

| 锁约定 | 行为 |
| --- | --- |
| 适用范围 | Linux flock，协调同一 OS 用户的合作进程，与工程位置无关 |
| 目录 | `$CAUTEST_LOCK_DIR`，未设置时使用 OS 临时目录中的用户目录 |
| 参与者要求 | 相同锁目录、相同物理 ID |
| lockTimeoutMs | 默认 30000 毫秒；doctor 检查 flock |
| 等待与进程死亡 | 等待可取消；持有进程死亡后内核释放锁 |
| 锁文件 | 保留、不 unlink，避免新旧 inode 的竞态 |
| 释放时机 | Board/Transport 清理之后，即使之前的清理失败也释放 |

这是合作协调，不是针对其他 OS 用户或忽略锁工具的访问控制。

模拟门禁覆盖以下场景：

- 真实 Xmake → 固件构建 → MCU CTP；两个别名共用一次构建。
- 一次串口断线恢复，owned/borrowed 失败清理。
- 陈旧 Board 固件、错误 Boot ID。
- 锁忙超时、取消等待、强制终止锁持有进程。

这些测试本身未提供物理板卡，不能证明真实 flash/reset/上电/串口/SPI。GD32 实板与真实 UML 的独立结果分别见[真实 MCU](../scenarios/mcu-real.md)和[Kernel/Driver 接入](kernel-driver.md)。

## Product Kbuild multi-output example (not Driver runtime acceptance)

The [Kbuild product example](../reference/sources.mdoc#cautest:source:examples:xmake:kbuild-product:xmake:lua) owns
its driver sources, Makefile and macro in one product target. It executes real
external-module Kbuild in a throwaway source copy, not `M=<product-source>`.
Prepare a Kernel build/headers directory yourself, then configure explicitly:

```sh {% process=false %}
xmake f -y --kernel_build=/absolute/prepared/kernel-build --demo_value=7
xmake ctest --json integration.kbuild-contract
```

该 Kbuild 示例只使用事先准备的 x86_64 Kernel 树，不使用 UML。一个 phony target 导出 ko、symbols、order、kernel-identity 四类角色，Receipt 校验全部角色，Workflow 的多个引用共享一次构建。

构建前后检查 Kernel 配置、Module.symvers 元数据和 release 值；合同测试检查 ELF、vermagic release 及预期导出符号。

该测试不加载模块、不执行 .ko、不启动 Kernel，也不测试 Driver ABI。它不是完整 ABI 兼容性验证；真正加载模块还要求 Kernel 配置、符号版本、架构和显式 UML Environment 匹配。

Kbuild-only 回归使用显式 KERNEL_BUILD，始终不加载宿主模块。

真实 UML 验收是另一条路线：已有记录构建并启动 Linux 6.6.157 / BusyBox 1.36.1，执行 Kernel C Test 及 Driver read/write/ioctl/非法输入用例。冷/热和失败矩阵命令见[Kernel/Driver 指南](kernel-driver.md)。

MCU SPI fixture 是宿主编译的行为模型；GD32 RTOS 的物理验收另有记录，不证明 SPI 接线或硬件通过。

## Explicit acceptance commands and provider dependencies

```sh {% process=false %}
npm test
CAUTEST_XMAKE=/absolute/xmake npm run test:xmake
CAUTEST_XMAKE=/absolute/xmake KERNEL_BUILD=/absolute/prepared/kernel-build npm run test:xmake:kbuild
```

The explicit Xmake acceptance commands fail with a prerequisite diagnostic when required environment inputs are absent; an entirely skipped suite is not PASS. The Kbuild command is separate from the Native/MCU simulation gate and from real UML/Driver ABI acceptance.

A relocated portable tree has independently passed both Native and MCU simulation with no `dist` or `node_modules`; its manifest also remains valid after application tests finish.

Provider 的相对 import 从其声明模块定位。第三方依赖放在消费工程正常的 Node 解析目录；Cautest 不打包任意 npm 包或 Native Addon，原生扩展必须匹配实际 Node ABI/平台。

敏感信息通过继承的进程环境传递：

- 不写入 Lua Job/Profile env；声明式配置值会保存到执行 Manifest，也可能出现在 CLI 描述中。
- Cautest 不输出完整的继承环境。
- 用户自己的构建或 Provider 命令仍须避免打印敏感信息。

### Provider source provenance

Board 工厂保持延迟加载：list、plan、doctor 不 import/执行 Board 模块，也不调用工厂。

构建或 provision 前，单独的只解析 Node 子进程发现静态 ESM import/re-export（含循环）。这些来源路径用于配置溯源。

配置 ID 描述已加载的声明数据，不重新摘要或监控来源字节。启动运行前完成配置编辑；构建失败仍阻止 provision。

Dynamic `import()`, CommonJS `require()`, native add-on dependencies and data read
by a factory are not inferable from static ESM imports. Declare those inputs:

```lua {% process=false %}
ctest.board {
    id = "board", resourceId = "probe:serial-number",
    provider = {
        module = "board.mjs", export = "create",
        inputs = {"board-settings.json", "board-support/**.mjs"}
    }
}
```

provider.inputs 的规则如下：

- Pattern 相对声明 Lua 文件，必须留在工程根目录内；必需 Pattern 无匹配时报配置错误。
- 该可选字段也适用于 Environment 和 Workflow Provider。
- 静态 import 到达的 .cjs、.node、JSON 只登记来源路径，不执行或摘要；它们进一步的动态依赖须显式声明。

只解析子进程使用当前 Node 可执行文件及其 VM-module Parser，不安装 npm 包，也不执行 Provider 代码。

### Concurrent Linux builds

在已支持的 Linux 宿主，Cautest 用内核 flock 保护两类事务：

| 事务 | 范围 |
| --- | --- |
| 缓存 | validate → invalidate → build → publish，全程持锁 |
| 同一工程构建 | Xmake build → Artifact query → Receipt，串行处理 |

锁位于用户临时锁目录，放在 Artifact 之外；使用期间不 unlink，持有进程死亡后由 OS 释放。所有合作进程使用相同 CAUTEST_LOCK_DIR，或都不设置该变量。

This does not lock arbitrary external `xmake f` calls. A configuration or source change during a run is an error, not permission to silently switch configurations. Different Guest output names have different cache identities.

Cross-process build locking on non-Linux hosts is not part of the verified support matrix.

### MCU SPI 行为模拟与失败清理

`examples/xmake/mcu-spi-simulated` 将实际 C SPI 协议测试与一个确定性的设备行为模型一起编译为模拟固件。两个 Job 共用一个固件产物，但分别拥有烧写、复位、串口和清理生命周期。

测试覆盖片选、模式、设备 ID、写使能、读写、非法参数和复位；`spi-fault` 构建选项注入错误的设备 ID，必须产生 CTP FAIL，而非仅检查进程退出码。参见 [SPI 模拟说明](mcu-spi-simulation.md) 中的正常、故障与恢复命令。

这属于软件协议行为模拟，不模拟引脚时序、信号完整性或真实 SPI 控制器。它满足“MCU 先模拟”的当前交付范围，不能替代原方案的实板 SPI 门禁。

共享 MCU Runtime 还覆盖 owned/borrowed Adapter 的 flash、reset、openTransport 抛错及超时，以及错误 Adapter 返回值和清理异常。

超时后才返回的 Transport 会立即关闭，不会启动 CTP；borrowed Board 不由本 Job 关闭，但本 Job 创建的 Transport 和持有的物理锁仍会释放。

### 当前验证的宿主与第三方模块边界

当前实测组合是 Linux x86_64、Xmake 3.1.1、Node 22.16.0、GCC 和 Clang。声明的 Node 最低版本沿用旧项目要求；没有把未安装的 Node 版本、Windows/macOS 或交叉架构算作验证通过。Native 规则明确拒绝不支持的宿主/目标组合。

Board 可以从消费工程的 `node_modules` 导入 npm 包。真实编译的 N-API v1 扩展已在源码 checkout 和中文/空格路径下的便携包中验证：list/plan/doctor 不执行工厂，run 才调用扩展并连接模拟 Board。

该测试使用本地 fixture，不经过 npm Registry；不等于任意串口/USB 扩展或某个第三方版本均兼容。便携 Cautest 自身不需要 node_modules，但 Board 依赖仍由消费工程提供。

扩展的 `require()`、动态载入 `.node` 或配置文件需要写入 `provider.inputs`，例如：

```lua {% process=false %}
provider = {
    module = "board.mjs", export = "create",
    inputs = {"node_modules/my-board/*.cjs", "node_modules/my-board/*.node"}
}
```

原生扩展必须匹配实际运行它的 Node/N-API、宿主架构及动态库；不应盲目复制另一架构或另一发行版的 node_modules。

同工程的 Cautest 构建会话会串行化“构建—查询—Receipt 发布”；不同工程可并行使用 GCC/debug 与 Clang/release。一个会话仍只允许一个固定的 Xmake 配置，不能在测试期间并行执行任意 `xmake f`。

验证已注入“编译完成后、Receipt 查询前切换配置”的真实 Xmake 竞态：旧会话必须在 CTP 前失败，新会话重新读取配置后才能运行。这个失败保护不等于支持同一工程同时使用两个可变全局配置。

项目执行集合与逻辑环境声明见[测试组织模型](../overview.md#项目集合与执行环境)。原生 `--suite` 仍选择 C Test Suite，不用于项目执行集合。

{% /section %}
