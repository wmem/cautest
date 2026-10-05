# Xmake adapter (Linux x86_64, Xmake 3.1.1)

Clone this repository into the application's `tools/cautest`, then run `npm ci`
in that directory. npm's prepare builds the Node runtime; Xmake does not install
anything. With dependencies already installed, use `npm run prepare`. Runtime
execution after preparing needs Node >=20.6, not node_modules.

```lua
-- application's xmake.lua; Cautest does not set project/version/toolchains
includes(os.files("tools/cautest/xmake.lua"))
```

```lua
-- application's ctest.lua: explicit root, deterministic sorted fragments
ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.include {patterns = {"modules/**/test.lua"}}
```

The entry automatically loads `ctest.lua` from the Xmake project root after
registering the `ctest` API and Native rules and parsing the root `xmake.lua`.
Product build rules and variables declared after the tool entry are therefore
available to the test configuration. If the tool has not been installed,
`os.files()` returns no entry and the test configuration is not loaded, so a
project's `init` task can run first. No dependency installation happens while
loading Cautest.

Choose another Lua configuration with either spelling:

```sh
xmake ct --config=tests/host.lua
xmake ct -c "tests/host.lua" --list --json
```

Relative configuration paths are anchored to the selected project root,
including when using `-P` from another working directory. The selected file
replaces the default configuration. Its declarations, fragment paths and
Native source paths are relative to their declaring files as before. The same
selection reaches child Xmake builds and artifact queries; it is scoped to this
invocation, not saved in the project's Xmake configuration.

Xmake 3.1.1 requires `=` for long options that take a value; use
`--config=FILE` or the short option `-c FILE`, rather than `--config FILE`.

The old literal `includes("ctest.lua")` remains compatible and does not load the
file twice. With `--config`, that line also skips the default file. New projects
should let Cautest load the configuration; remove manual includes of other test
root files before using configuration selection. Existing inline `ctest.*`
declarations remain supported when no default file exists. Missing files and
Lua configuration errors make `ct` return exit code `3` before building or
creating execution manifests. Ordinary project loading tolerates an absent
default file so initialization remains possible.

`CAUTEST_XMAKE_CONFIG` and `CAUTEST_XMAKE_WORKINGDIR` are reserved for internal
propagation to build/query processes. Child processes preserve Xmake's independent
working/configuration/build directory behavior with `-P`. Job/Profile environments
cannot override that selection. Real
default/custom configuration and initialization regressions are in
[`test/xmake-config.test.js`](../../test/xmake-config.test.js); run them through
`CAUTEST_XMAKE=/absolute/path/xmake npm run test:xmake`.

```lua
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

`cautest.registry.suites` contains **explicit C Suite symbols**, never patterns.
The rule creates the Registry, entry point and protocol build identity, and adds
the existing C Runtime. `run.suite` is a discovery filter; it is not a linker
input. One target can have several Suites; a Job is not a Case or a Suite.

```sh
xmake ct                         # run all enabled Jobs
xmake ct --list --json
xmake ct --plan unit.math
xmake ct --doctor --level=unit
xmake ct --describe --json
xmake ct --level=unit,component --tag=host,math
xmake ct --suite='math_*' --case=adds unit.math
xmake ct --test-profile=ci --reporter=json,junit
xmake ct --output-dir=out/test-results unit.math
```

Job patterns and levels are OR; tags are AND; dimensions are AND. List/plan
retain disabled Jobs; run excludes them. Xmake 3.1.1 repeats of a kv option are
**last-wins**, so use comma-separated values. `--test-profile` selects a Cautest
profile, leaving Xmake's own `--profile` untouched. Exit codes retain the old
CLI: 0 success, 1 test failure, 2 execution/infrastructure error, 3 invalid
configuration, 4 empty selection, 130 interruption (POSIX parents can observe SIGINT instead; shells map it to 130). Diagnostics go to stderr;
`--json` stdout stays parseable when the corresponding old CLI command produces
JSON (empty selection intentionally does not create a result JSON).

## Build and runtime boundary

The actual chain is Xmake task → fixed Node module → existing Workflow build
Step → `xmake build` in the **same project** → actual target-file query → strict
receipt → unchanged Native/MCU CTP runtime → existing Result/JSON/JUnit engine.
No Lua source, function body, arbitrary expression or CLI plan JSON is executed
as a manifest. User-specified provider modules are trusted local configuration,
just like existing `.mjs` configuration files.

A receipt keeps output roles, paths, sizes, build context and CTP
`protocolBuildId` separate. Each invocation calls the ordinary Xmake build;
Xmake owns timestamp dependencies and incremental compilation. Missing outputs
are rebuilt by Xmake; build errors block execution. Cautest does not read source
or binary bytes to validate a cache. Shared target builds are deduplicated per
invocation; conflicting declared build environments require isolated targets.
Xmake configuration/output contexts must be isolated explicitly; Cautest does
not invent inheritance from an application target, configure cross toolchains,
or guess firmware/module outputs by suffix.

For secondary outputs, declare explicit roles on the real target:

```lua
add_values("cautest.outputs", "firmware-bin=output/image.bin")
add_values("cautest.protocolBuildId", "identity-embedded-by-the-firmware-build")
```

The primary role comes from `target:targetfile()`. Select another with
`ctest.mcu {target="firmware", output="firmware-bin", ...}`. Every declared
output is checked, not only the selected role. A phony/custom target needs
explicit output roles. The internal `cautest-artifact` task only loads target
metadata; it never compiles. The Native rule reads the identity emitted during
the actual build; it does not regenerate sources during this query. User target
load hooks remain user-controlled.

## Reuse product code explicitly

The [two-module example](../../examples/xmake/native/xmake.lua) demonstrates a
shared source rule and a separately compiled static library. A consumer's
private macros **do not** change an already compiled dependency library; shared
source rules recompile in each consumer. Keep product `main`, mocks and test
entry points explicit. Cautest never clones a production target or attempts to
copy its include paths/flags/defines automatically.

For generated headers, the producer target must declare Xmake
`set_policy("build.fence", true)`, and consumers must `add_deps` on it. Ordinary
link dependencies alone allow compilation in parallel and are not a header
generation fence. The Native Registry and entry are generated after that fence
in the first build, not during target loading. A content-sensitive compile
definition and GNU-compatible linker build-ID flag invalidate both compile
and link timestamp caches, including same-second updates. The Native rule
therefore requires a GNU-compatible ELF linker (GCC/ld was actually tested).
See `test/xmake-robustness.test.js` for first-build and changed-header evidence.

Copy `examples/xmake/native` outside this repository, then clone Cautest at that
copy's `tools/cautest`. Prepare the clone before running `xmake ct`. The disabled
negative Job is documentation: `--case=deliberate_failure unit.math` provides an
explicit failing-case demonstration.

## Native GCOV 覆盖率

覆盖率分为构建插桩和运行后收集。在 Native 测试目标上添加
`cautest.gcov`，在对应 Job 上声明 `coverage = {}`：

```lua
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

当前支持 Linux GCC 和与之匹配的 gcov。`cautest.gcov` 添加覆盖率编译、链接
参数及 `CAUTEST_GCOV`，使隔离子进程在退出前保存计数。该 rule 关闭 Xmake
只恢复对象文件的编译缓存，因为它不同时恢复 gcno，且缓存对象中可能保留
另一目标的 gcda 路径；普通时间戳增量构建继续有效。需要统计的独立静态库
也应显式添加 `cautest.gcov`；源码复用 rule 的源码随测试目标一起插桩。

每轮 Job 使用专用 GCOV_PREFIX 目录，按原始对象路径匹配 gcno/gcda，不读取
build 目录的历史计数。同名源码分别处理；共享库 notes 可被多个消费者只读
引用。gcno 作为 `gcov-note-*` 显式输出进入 Receipt；缺失时只移除对应对象，
由 Xmake 重编译。不使用内容摘要检查 notes；损坏应显式重建。收集使用 `runWhen = "always"`，测试 FAIL 后仍尝试生成报告，
保留失败状态；工具错误或缺少插桩 notes 返回 ERROR，构建失败不会伪造覆盖率。

Coverage Artifact 的 `metadata.reports` 列出实际 `.gcov` 路径；Xmake 报告位于
本轮结果目录的 `coverage/<Job ID>/reports/`，收集不会将 gcno/gcda 写回构建
目录。配置加载、list 和 plan 不执行构建或收集，doctor 检查 gcov 是否可用。
新声明使用 Xmake Manifest v3，读取方继续接受无 coverage 的 v1。

随包 Native 示例可在准备工具后执行：

```sh
xmake f -y --coverage=y
xmake ct --reporter=json,junit
```

真实回归入口为 [test/xmake-coverage.test.js](../../test/xmake-coverage.test.js)，
由 `npm run test:xmake` 一并执行；其范围包含同名源码、共享库、重复运行、
失败后收集和 notes 损坏恢复。

## Module workflow providers

```lua
ctest.workflow {
    id = "integration.application",
    provider = {module = "tests/application.mjs", export = "create"},
    artifacts = {app = {target = "application"}}, options = {}
}
```

`create({projectRoot, origin, options, artifacts, getArtifact})` returns the
existing `WorkflowStep`/`WorkflowFragment` or an array of them. Cautest inserts
build Steps after leading prepare Steps. During execution use
`getArtifact(context, "app")`, not hard-coded state keys. The provider must
produce Case results or explicitly opt into an empty-result policy, as before.
Construction must be side-effect-free: list/plan loads workflow modules but
never executes Steps or invokes the build provider.

Board factories use `ctest.board {id, provider={module,export}, options,
resourceId, ownership}` and `ctest.mcu {id,target,board}`. Board modules are
loaded lazily on flash, not on list/plan. Real hardware has not been validated.
Kernel/Driver now have artifact-backed workflows and a shared declarative UML
Environment factory; see [Kernel/Driver integration](xmake-kernel-driver.md).
Their component contracts are tested, but real UML acceptance is still blocked
by missing Kernel build tools. Standalone JS helpers remain available.

## Scope and validation

`ctest.include` requires every pattern to match unless `optional=true`. The
collector sorts, deduplicates normalized paths and detects cycles. Duplicate
IDs report both declaration files. Definitions include file, declaration ordinal
and include chain; the ordinal is **not a Lua source line number**. Explicit
includes are required: there is no repository-wide auto-discovery. Reserved
task names `ct` and `cautest-artifact` are diagnosed rather than silently replaced.
Xmake reparses on configuration; the registry resets between interpreter passes.
Before exporting declarations, `ct` loads the saved configuration and reparses
the description files, so `has_config()` and `get_config()` reflect `xmake f`
options. This pass does not load targets, execute build hooks or install addons
or packages; list/plan remain read-only.

The implementation is verified on supplied Xmake 3.1.1 Linux x86_64. One pinned
private accessor supplies the current Lua filename. Other versions/platforms,
real MCU SPI and actual UML kernel/driver execution need their respective
acceptance tests before being declared supported.

## MCU artifact adapter and physical locking

The [MCU Host simulation](../../examples/xmake/mcu-simulated/xmake.lua) builds
real C firmware code with Xmake, then runs the existing freestanding reference
MCU/CTP transport with fragmented I/O. `cautest.mcu-simulated` generates an
explicit Registry and embeds a 24-hex protocol identity (the reference MCU
storage is 32 bytes including termination). This persistent target identity is
independent of source bytes. Compilation/linking dependencies belong to Xmake;
source rebuilds within the same target directory may retain the same identity.
This is **not** a real MCU target, real startup/linker-script verification or SPI
acceptance. Real firmware is an application-owned target with explicitly
exported firmware output and embedded protocol identity.

Board factories receive `{projectRoot, options, origin, signal}`. They load only
inside provision, after the build and physical lock, and must honor cancellation.
Owned adapters close even after flash/reset failure; borrowed adapters are never
closed by Cautest. Factories that reject after partially allocating resources
must clean up those resources themselves. Arbitrary non-cooperative JavaScript
cannot be forcibly canceled; do not start untracked asynchronous device work.
A factory resolving after cancellation has its owned adapter closed before any
flash. Per-Job board/log names prevent two aliases overwriting each other's logs.

`resourceId` is **required** for a Board. Distinct aliases of one probe/serial
number must use the same ID. Actual Linux `flock` serializes cooperating processes
of the same OS user, independently of project location. The lock directory is
`$CAUTEST_LOCK_DIR` or a per-user directory under the OS temp directory. All
participants must use the same lock directory and physical ID. `lockTimeoutMs`
defaults to 30000. Doctor checks for `flock`; waiting is cancelable; the kernel
releases ownership after owner process death. Lockfiles are intentionally never
unlinked, avoiding races between old and new lockfile inodes. Release runs after
board/transport cleanup, even when an earlier cleanup fails. This is advisory
coordination, not access control against other OS users or tools ignoring it.

Tests cover real Xmake → firmware → MCU CTP, two aliases/one build, one-time
serial disconnect recovery, owned/borrowed failure cleanup, stale board firmware,
wrong Boot ID, busy-lock timeout, canceled wait and forced owner process death.
No physical board was supplied; real flash/reset/power/serial/SPI acceptance
remains outstanding. Kernel/Driver artifact workflows are implemented, but their
real UML acceptance remains separate and has not passed.

## Product Kbuild multi-output example (not Driver runtime acceptance)

The [Kbuild product example](../../examples/xmake/kbuild-product/xmake.lua) owns
its driver sources, Makefile and macro in one product target. It executes real
external-module Kbuild in a throwaway source copy, not `M=<product-source>`.
Prepare a Kernel build/headers directory yourself, then configure explicitly:

```sh
xmake f -y --kernel_build=/absolute/prepared/kernel-build --demo_value=7
xmake ct --json integration.kbuild-contract
```

This example deliberately supports prepared **x86_64** Kernel trees, not UML.
It exports `ko`, `symbols`, `order` and `kernel-identity` roles from the same
phony target. All roles are validated by the receipt and a single invocation is
shared between the workflow's references. Kernel configuration and Module.symvers metadata, plus the release value,
are checked before/after building. The contract test checks ELF,
vermagic release and the expected exported symbol; **it never loads the module,
executes a .ko, boots a Kernel or tests a Driver ABI**. This is not full ABI
compatibility validation; final module loading also needs matching Kernel config,
symbol versions, architecture and the future explicit UML Environment.

The Kbuild-only regression uses the explicitly supplied `KERNEL_BUILD` and never
loads host modules. Separately, the real UML acceptance has now built and booted
the supplied Linux 6.6.157 with BusyBox 1.36.1, exercising both Kernel C Test and
Driver read/write/ioctl/invalid-input cases. See the [Kernel/Driver guide](xmake-kernel-driver.md)
for the distinct cold/hot and failure-matrix commands. MCU physical hardware is
explicitly deferred; the MCU SPI fixture is a host-compiled behavioral model.

## Explicit acceptance commands and provider dependencies

```sh
npm test
CAUTEST_XMAKE=/absolute/xmake npm run test:xmake
CAUTEST_XMAKE=/absolute/xmake KERNEL_BUILD=/absolute/prepared/kernel-build npm run test:xmake:kbuild
```

The explicit Xmake acceptance commands fail with a prerequisite diagnostic when
required environment inputs are absent; an entirely skipped suite is not PASS.
The Kbuild command is separate from the Native/MCU simulation gate and from real
UML/Driver ABI acceptance. A relocated portable tree has independently passed
both Native and MCU simulation with no `dist` or `node_modules`; its manifest
also remains valid after application tests finish.

Provider-relative imports resolve from the provider's declaring module. Install
third-party dependencies in that application's normal Node resolution tree;
Cautest does not bundle arbitrary packages or native addons. Native addons must
match the host Node ABI/platform. Supply secrets through the inherited process
environment, not Lua Job/profile `env`: declared configuration values intentionally
appear in saved execution manifests and may appear in CLI descriptions. Cautest
does not dump the complete inherited environment; user build/provider commands
remain responsible for not printing their own secrets.

### Provider source provenance

Board factories remain lazy: `list`, `plan` and `doctor` do not import/evaluate
Board modules or call their factories. A parse-only Node subprocess discovers
static ESM imports and re-exports (including cycles) before any build/provision.
Source paths are retained as configuration provenance. The configuration ID
describes the loaded declaration data; source bytes are not hashed or monitored
again before constructing the Board or flashing. Finish configuration edits
before starting a run. Build failures still block provisioning.

Dynamic `import()`, CommonJS `require()`, native add-on dependencies and data read
by a factory are not inferable from static ESM imports. Declare those inputs:

```lua
ctest.board {
    id = "board", resourceId = "probe:serial-number",
    provider = {
        module = "board.mjs", export = "create",
        inputs = {"board-settings.json", "board-support/**.mjs"}
    }
}
```

Input patterns are relative to the declaring Lua file and must remain inside the
project root. Required patterns matching nothing fail configuration. The optional
`provider.inputs` field also works for Environment and Workflow providers.
A `.cjs`, `.node` or JSON file reached through a static import is recorded as
a source path without being evaluated or hashed; its further dynamic
dependencies must be declared explicitly.
The parse-only subprocess uses the running Node executable and its VM-module
parser; no npm package is installed and no provider code is executed there.

### Concurrent Linux builds

On the supported Linux host, Cautest locks the complete cache transaction
(validate → invalidate → build → publish) with kernel `flock`, and serializes the
Xmake build → artifact-query → receipt transaction per project. Locks live in the
user's temporary lock directory, outside artifacts; they are never unlinked while
in use and are released by the OS after an owning process dies. All cooperating
processes must use the same `CAUTEST_LOCK_DIR` (or leave it unset).

This does not lock arbitrary external `xmake f` calls. A configuration or source
change during a run is an error, not permission to silently switch configurations.
Different Guest output names have different cache identities. Cross-process build
locking on non-Linux hosts is not part of the verified support matrix.

### MCU SPI 行为模拟与失败清理

`examples/xmake/mcu-spi-simulated` 将实际 C SPI 协议测试与一个确定性的设备行为模型一起编译为模拟固件。两个 Job 共用一个固件产物，但分别拥有烧写、复位、串口和清理生命周期。测试覆盖片选、模式、设备 ID、写使能、读写、非法参数和复位；`spi-fault` 构建选项注入错误的设备 ID，必须产生 CTP FAIL，而非仅检查进程退出码。参见 [SPI 模拟说明](xmake-mcu-spi-simulation.md) 中的正常、故障与恢复命令。

这属于软件协议行为模拟，不模拟引脚时序、信号完整性或真实 SPI 控制器。它满足“MCU 先模拟”的当前交付范围，不能替代原方案的实板 SPI 门禁。

共享 MCU Runtime 还覆盖 owned/borrowed Adapter 的 flash、reset、openTransport 抛错及超时，以及错误 Adapter 返回值和清理异常。超时后才返回的 Transport 会立即关闭，不会启动 CTP；borrowed Board 不由本 Job 关闭，但本 Job 创建的 Transport 和持有的物理锁仍会释放。

### 当前验证的宿主与第三方模块边界

当前实测组合是 Linux x86_64、Xmake 3.1.1、Node 22.16.0、GCC 和 Clang。声明的 Node 最低版本沿用旧项目要求；没有把未安装的 Node 版本、Windows/macOS 或交叉架构算作验证通过。Native 规则明确拒绝不支持的宿主/目标组合。

Board 可以从消费工程的 `node_modules` 导入 npm 包。真实编译的 N-API v1 扩展已在源码 checkout 和中文/空格路径下的便携包中验证：list/plan/doctor 不执行工厂，run 才调用扩展并连接模拟 Board。该测试使用本地 fixture，不经过 npm Registry；不等于任意串口/USB 扩展或某个第三方版本均兼容。便携 Cautest 自身不需要 node_modules，但 Board 依赖仍由消费工程提供。扩展的 `require()`、动态载入 `.node` 或配置文件需要写入 `provider.inputs`，例如：

```lua
provider = {
    module = "board.mjs", export = "create",
    inputs = {"node_modules/my-board/*.cjs", "node_modules/my-board/*.node"}
}
```

原生扩展必须匹配实际运行它的 Node/N-API、宿主架构及动态库；不应盲目复制另一架构或另一发行版的 node_modules。

同工程的 Cautest 构建会话会串行化“构建—查询—Receipt 发布”；不同工程可并行使用 GCC/debug 与 Clang/release。一个会话仍只允许一个固定的 Xmake 配置，不能在测试期间并行执行任意 `xmake f`。验证已注入“编译完成后、Receipt 查询前切换配置”的真实 Xmake 竞态：旧会话必须在 CTP 前失败，新会话重新读取配置后才能运行。这个失败保护不等于支持同一工程同时使用两个可变全局配置。
