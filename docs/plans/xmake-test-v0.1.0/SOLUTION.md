# Cautest Xmake-Test 适配层实施方案

版本：方案 v0.1.0  
日期：2026-09-22  
状态：待实施设计；不是已经可用的 Cautest/Xmake API  
基线：用户上传的 Cautest 0.2.1，归档指纹及逐段证据见 `SOURCE_AUDIT.md`

## 1. 目标与结论

在 Cautest 内增加 `xmake-test` 适配层，不把 Cautest 重写成 Lua，也不按“纯软件/系统测试”拆成互不兼容的两套框架。

工程通过 `includes("tools/cautest/xmake.lua")` 接入；根 `ctest.lua` 负责项目级测试策略和收集入口；分散的 `test.lua` 负责模块级 Job 声明。正式源码、宏、工具链和产物构建仍以 Xmake 为唯一权威，已有 JS Factory 继续生成并执行工作流。

Native、MCU 上的 SPI 等真实硬件测试、Kernel 内测试、Linux Driver ABI 测试都属于本方案范围。Native 先实现只表示实施顺序，不表示重新缩小产品范围。

**统一构建事实、测试模型和命令入口，不强制统一实现语言。**

| 层 | 负责 | 不负责 |
|---|---|---|
| Xmake 工程模型 | 产品与测试 target、源码、工具链、宏、依赖、增量构建、产物 | 测试结果模型和硬件生命周期 |
| Xmake-Test 适配层 | Lua 声明、分散收集、target 引用、Manifest、命令桥接 | 复制一套 Compiler/Cache 系统 |
| Cautest JS | Job Factory、工作流、构建调度、烧写/部署、CTP、结果、清理 | 为 Xmake 管理的产品重新描述源码和编译参数 |
| C Runtime | Case/Suite、断言、Fixture、参数化、目标侧执行、CTP | 项目文件发现和工具链管理 |

这里的“JS 构建调度”是调用 Xmake 构建指定 target，而不是继续拼装产品的编译命令。

## 2. 已确认的现状，以及必须纠正的假设

旧版模型是 `TestConfig → TestJob[] → 有序 Workflow Step[] → Suite/Case Result`。Workflow 是线性相位序列，不是通用 DAG；相位为 `prepare → build → provision → run → collect`。[B02、B03、B08]

Job 是稳定 ID、level/tag、超时、失败策略和结果隔离边界。一个 Job 可以含多个测试文件与 Suite，不能按文件数或 Case 数推导 Job 数。[B16]

必须保留的细节如下。

| 事项 | 核查结论 | 对新方案的约束 |
|---|---|---|
| Level | `unit/component/integration/system` | 是类别，不是数值大小；选择 integration 不自动包含 unit |
| Job 筛选 | ID 多选 OR、level 多选 OR、tag 多选 AND；维度间 AND | 由同一 JS selector 实现，Lua 不另写一套语义 |
| enabled | 旧 run 排除 disabled；list/plan 可展示 | 不因为显式 ID 就偷偷强制执行 disabled Job |
| profiles | 数组；提供 env/reporters | 不把 profiles 顺手改成 Job 分组或过滤语言 |
| suites | Native/Kernel/Guest 的 Registry C 符号列表 | 不允许把通配符 `spi_*` 当成 C 标识符 |
| run.suite | 运行阶段 Suite 选择 | 与 Registry 分开；CLI 保留原来的按字段覆盖方式 |
| planConfig | 只输出可展示的 Step 描述 | 不能作为可执行工作流直接 JSON 反序列化 |
| Step executor | JS 函数保存在内部 Symbol 字段 | 必须经 JS Factory 重建，而非生成伪造 TestJob |
| Native helper | 仍绑定 tests/sources/build | 需要新增产物入口或抽出共用 Runtime Steps，不能假定已有 artifact-only API |
| MCU helper | 已支持 existing/command/host-simulated | 可复用，但产物 Build ID 与固件 HELLO 需另行对齐 |
| Board adapter | 带方法的 JS 对象 | 用 `module + export + options` 引用，不序列化函数 |
| Native tags | 默认通常只有 level | 显式写 `native` 标签；不宣称 helper 会自动追加 |

上述结论分别有 B01—B20 源码证据。此前讨论中的 `ctest.*`、任意 target 自动继承、通配符 Registry 等均是设想，不能视为已实现接口。

## 3. 工程使用形态

```text
project/
├── xmake.lua
├── ctest.lua                       # 项目测试唯一根入口
├── src/
│   ├── math/
│   │   ├── xmake.lua               # 产品源码/可复用构建定义
│   │   └── test/
│   │       ├── test.lua            # 局部测试 target 与 Job 声明
│   │       ├── arithmetic_test.c
│   │       └── limits_test.c
│   └── queue/test/...
├── drivers/foo/test/
│   ├── test.lua
│   └── abi_test.c
├── tests/
│   ├── mcu/spi/test.lua
│   └── support/
│       ├── resources.lua          # 共享 Board/Environment 声明
│       └── board-adapter.mjs      # JS 实现，不重复构建配置
└── tools/cautest/
    ├── xmake.lua                   # 新增的薄入口
    ├── adapters/xmake-test/        # 新增 Lua 适配层
    ├── src/                       # 保持现有 TS 布局
    ├── dist/                      # 保持现有 JS 发布布局
    └── assets/cautest-c/           # 保持现有 C Runtime 布局
```

项目 `xmake.lua`：

```lua
set_project("my-project")
includes("tools/cautest/xmake.lua")
includes("src/xmake.lua")
includes("ctest.lua")
```

第一版显式包含 `ctest.lua`，不同时提供隐式自动扫描，以免重复加载或依赖声明顺序不透明。没有测试的产品可不包含该文件；仅加载工具入口不应触发 Node、安装、构建或硬件访问。

Xmake 的 `includes` 与自定义 task 提供接入基础，但 `ctest` 表式 DSL 的作用域、注册与加载时机仍须先做最小验证。[W1、W2]

## 4. 根 ctest.lua：入口与策略，不是 Case 清单

以下所有 `ctest.*` 均为待实现的 API 草案。

```lua
ctest.project {
    defaults = {
        resultDir = ".cautest/results",
        jobTimeoutMs = 120000
    },
    profiles = {
        {id = "ci", reporters = {"json", "junit"}}
    }
}

ctest.include {
    patterns = {"tests/support/resources.lua"}
}

ctest.include {
    patterns = {
        "src/**/test/test.lua",
        "drivers/**/test/test.lua",
        "tests/**/test.lua"
    }
}
```

根文件不列每个 Case，也不强制列每个 Job。新模块在约定目录增加 `test.lua` 即可被收集；同模块新增 Case 通常只改 C 测试代码。新增 Suite 仍需登记 Registry，不能把“收集 C 文件”误认为“自动解析所有 C 宏”。

`ctest.include` 只收集定义文件。测试源码交给 Xmake 的文件 API或后续薄 helper，二者不能共用一个含义不清的 `collect` 字段。

### 4.1 收集与路径规则

定义文件 Pattern 相对于声明该次 `ctest.include` 的文件；局部定义中的测试路径、JS module 路径相对于该定义文件。根 defaults 的受管目录相对于项目根，target 名称是工程级标识，不按当前目录改写。

每个 include 调用先展开、规范化路径、排序，再加载。整个工程对同一个规范化文件只加载一次；循环 include 报错，报告完整链路。同名 Job 来自不同文件时必须报错并指明两处来源，不能后定义覆盖前定义。

默认每个正向 include Pattern 都必须有匹配；可显式设置 `optional = true` 表示该组文件允许不存在。测试源码的必需 Pattern 不允许无声漏测。第一版不承诺与旧文件 glob 的所有语法一一相同：文件收集语法须列出已验证子集并对不支持语法报错；Job ID 的 glob 则继续复用旧 JS matcher。

不默认扫描 `**/test.lua`，避免把 `tools/vendor/third_party/build` 纳入自身测试。保留显式允许的外部目录机制，但默认禁止解析后逃逸项目测试边界；符号链接与路径大小写行为必须测试。

## 5. 局部 test.lua：一个 Job 聚合一组测试

初版采用无歧义的引用方式：`target` 表示已经声明的测试产物 target，**不是“把产品 app 的全部配置自动复制过来”**。

```lua
-- src/math/test/test.lua
-- test.math 的源码、产品复用关系及 Registry 在 Xmake 构建定义中声明。
ctest.native {
    id = "unit.math",
    target = "test.math",
    level = "unit",
    tags = {"native", "math", "fast"},
    run = {
        suite = {"math_*"}
    }
}
```

同一个局部文件也可以用标准 Xmake target/rule API 定义 `test.math`；较复杂时放进邻近的 `test-targets.lua` 再显式引入。两者都在同一 Xmake 模型内，不是恢复 JS 编译配置。

为减少配置，后续提供薄的测试 target helper，但只组合“共享产品构建定义 + 测试源码 + Cautest Runtime + Registry”。它不接受另一套 `compiler/cflags/includeDirs` 模型；需要额外编译选项时使用标准 Xmake API。

### 5.1 Level 与 Tag

Level 由测试目的决定，不能由运行地点硬编码。MCU 的算法测试可以是 unit；真实 SPI 外设交互可以是 integration；Driver 用户接口测试也可以是 integration，而不是一概 system。

Job 示例：

| Job ID | level | tags | 运行产物 |
|---|---|---|---|
| unit.math | unit | native, math, fast | Native 测试 ELF |
| component.protocol | component | native, protocol | 组件测试 ELF |
| integration.mcu.spi | integration | mcu, hardware, spi | MCU 测试固件 |
| unit.driver.foo | unit | kernel, driver, uml | Kernel Test Module |
| integration.driver.foo | integration | driver, abi, uml | Driver Module + Guest Test |

第一版 level/tag 仍仅在 Job 上，不修改 C Case 元数据与 CTP。类型 helper 的默认 level/tag 保持兼容，并在 list 中显示规范化后的最终值；项目最好显式写关键标签。用户传入 tags 不应被适配层偷偷改成另一种合并规则。

### 5.2 多个 Job 可以引用同一产物

MCU 固件可包含 SPI、I2C、UART 多个 Suite；SPI Job 与 I2C Job 共用构建 target，但各自有 level/tag/run 选择。

这只代表可以去重构建，不代表自动合并烧写、复位或会话。默认每个 Job 保留独立生命周期；跨 Job 共享一次硬件会话必须另作显式能力，不能顺手优化。

原有 CLI 选择会覆盖配置中的同名 `run` 字段，因此默认 Suite 选择不是不可突破的权限边界。[B18] 第一版保持此语义，不暗中加入硬分区。

## 6. 构建配置复用：三种明确模式

**一个构建模型，不等于产品和测试只能有一个 target。** 主入口、Mock、宿主 ABI 或测试固件启动流程不同，本来就可能需要不同 target；应共享构建定义而非复制事实。

| 模式 | 适用情况 | 必须明确的边界 |
|---|---|---|
| 引用现有产物 | MCU 测试固件、Native 测试程序、Guest、.ko 已有 target | 最早实现；只调 Xmake 并取实际产物 |
| 链接共享组件 | 已编译库本身不依赖消费者的私有宏 | 只承诺 Xmake 已定义的依赖/导出语义 |
| 共享源码构建定义 | 产品源码需要在最终 app 或 test 的宏下重新编译 | 共享函数/rule/显式组件 recipe；在测试 target 中重新应用 |

Xmake 配置有 private/public/interface 可见性。[W3] `add_deps` 不能被包装成“任意 target 完整克隆”的承诺。尤其不能假定测试 target 的宏会反向修改已经编译好的依赖库。

对于用户关注的“依赖仓库源码受最终 app 宏控制”，应把源码列表和公共编译配置封装为可重放的 Xmake 构建定义，产品 target 与测试 target 使用同一份。禁止反射复制所有已解析字段，禁止静默复制产品 main、启动文件、链接脚本或后处理 hook。

第一版明确不支持任意 target 自动派生。P0 要用私有宏、条件源码、生成头文件、Mock 和跨架构示例验证共享定义的有效边界；验证失败时明确诊断，不能用“构建成功”代替配置正确。

C Runtime 对编译宏、ABI 或工作区配置敏感的部分要按测试构建上下文编译；不能为了去重把所有平台都链接到同一个错误配置的静态库。

## 7. 前后端协议：Execution Manifest，不是旧 plan 输出

```text
xmake.lua + ctest.lua + 分散 test.lua
             │
             ▼
       Lua 定义注册/校验
             │
             ▼
   Xmake-Test Execution Manifest
             │
             ▼
    JS Loader + Provider/Factory
             │
             ▼
      原生 TestConfig/TestJob
             │
             ▼
       原有 Cautest Workflow
```

旧 `planConfig()` 继续用于人和 CLI 查看步骤。新 Manifest 是**声明型执行输入**，通过 `schemaVersion` 独立版本化。JSON 不携带 Closure、Xmake target 对象、Board 对象或序列化后丢失的 Symbol。[B06—B08]

建议最小结构：

```json
{
  "format": "cautest.xmake-test",
  "schemaVersion": 1,
  "projectRoot": "/work/project",
  "definitionDigest": "<由规范化声明及定义来源计算>",
  "buildContexts": [
    {
      "id": "current",
      "projectDir": "/work/project",
      "configurationDigest": "<解析后的构建上下文标识>"
    }
  ],
  "jobs": [
    {
      "id": "unit.math",
      "kind": "native",
      "level": "unit",
      "tags": ["native", "math", "fast"],
      "origin": {"file": "src/math/test/test.lua"},
      "artifacts": {
        "executable": {"context": "current", "target": "test.math", "output": "primary"}
      },
      "run": {"suite": ["math_*"]}
    }
  ]
}
```

这是结构示意，不是可运行实例。字段还需经过 P0 的 Schema 冻结；严格验证未知字段、类型、版本与 target 引用。`configurationDigest` 是构建上下文标识，不能代替 Xmake 对源码依赖的增量判断。

如旧入口更适合加载 `.mjs`，可生成固定薄包装：读取 Manifest，调用 Bridge Factory，返回正规 `testConfig()`。不要把工作流业务逻辑拼成 JS 字符串，也不要维护 JSON 和生成 JS 两套独立语义。

### 7.1 JS 扩展引用

标准 Native/MCU/Kernel/Driver 不要求用户手写 JS Job。自定义 Board 或工作流用可序列化引用：

```lua
ctest.board {
    id = "board0",
    provider = {
        module = "./board-adapter.mjs",
        export = "createBoard"
    },
    options = {
        probeSerialEnv = "CTEST_PROBE_SERIAL",
        serialPortEnv = "CTEST_SERIAL_PORT"
    }
}
```

Node 加载该 export 并传入 options，产生已有 Board 契约的对象。通用 `ctest.workflow` 同样可引用 JS Factory，返回现有 Step/Fragment，由 Bridge 包装为正规 Job；它是扩展出口，不是在 Lua 中增加 steps/重试/并发 DSL。Factory 的构造阶段必须无烧写、启动设备等副作用，实际 I/O 放进 Step 执行阶段。项目 JS 是受信任代码，声明“list/plan 无副作用”不是对任意恶意 JS 的安全沙箱保证。

禁止把密码、令牌或完整宿主环境写进 Manifest/结果；通过环境引用注入。JS module 及其受管依赖的身份要进入来源追踪和配置摘要。

## 8. 构建执行桥与产物契约

### 8.1 首选执行方式

`xmake ct` 注册/导出配置后启动 Node，JS 工作流中的新 `xmakeBuild` Step 调 Xmake 构建引用的 target。编译仍在 Workflow 的 build 相位内，因此构建失败、日志、取消和结果可以继续落在原来的 Job 生命周期中。

这是首选设计，但有一个必须先验证的阻断项：外层 `xmake ct` 等待 Node 时不能持有内层 `xmake build` 所需的锁。P0 必须验证配置锁、项目锁、重复加载、子进程退出码与中断传播。在该实验通过前，不能宣称这条调用链已可用。

如果目标版本无法安全释放锁，需要通过 ADR 改成分离启动或 Xmake 前置构建，并补齐构建失败归属；不得用轮询、递归重入、关闭互斥或长超时掩盖死锁。第一版不同时维护两种默认执行路径，也不引入双向 RPC 构建服务。

调用链必须单向终止：`xmake ct → Node Workflow → xmake build/内部产物查询`。构建子命令不会重新进入 `xmake ct`，配置加载也不会自动开始测试。

### 8.2 产物不能只是一条路径

构建完成后得到 Artifact Receipt，至少包含：角色、target、构建上下文、实际路径、内容摘要、协议 Build ID（适用时）、相关 sidecar、来源和构建结果。

普通 binary 可有默认 primary output；MCU ELF/BIN/HEX、phony 包装的 .ko、Kernel/Rootfs 等必须声明实际 output 角色，不靠拼接文件后缀或猜 `build/` 路径。

区分三种身份：

| 身份 | 用途 |
|---|---|
| definition/config digest | 声明和构建上下文追踪 |
| artifact content digest | 产物完整性、缓存和复现 |
| protocolBuildId | 固件/测试程序 HELLO 中实际报告的身份 |

文件 hash 与内嵌 Build ID 不能默认相等；后者应由构建阶段生成并传给目标与 Host。MCU 现有 existing 分支的身份行为必须单独适配。[B10、B13]

### 8.3 去重与增量

Job 先按 ID/level/tag 筛选，再构建所需 target。相同 target、构建上下文、有效构建环境的请求在一次 run 中合并；不同运行 Case 选择不导致重新编译。

Xmake 负责源码、头文件、工具链等增量判断。Adapter 只管理 Manifest、生成文件及 Receipt，不再建立完整 Native 编译缓存。同路径存在不能表示产物有效；Receipt 缺失、摘要错误或构建配置不符不得执行旧文件。

同一 target 在不同 Job 下的构建相关 env 不同时，不得盲目复用或覆写同一输出；要求显式变体/隔离输出，或拒绝配置并解释冲突。Profile/env 的构建影响要显式处理，不允许 JS 与 Xmake 各看到一份不同环境。

### 8.4 多架构

第一版针对当前 Xmake 配置中合法可构建的 target，不默认通过反复执行 `xmake f` 切换全工程来跑 Native/MCU 矩阵。跨平台多上下文要隔离配置状态和输出，只有更换输出目录并不等于配置状态已经隔离。未验证的组合明确拒绝，不能产物串用。

## 9. 各平台的实施边界

### Native

保留 CTP3 及现有 JS Native Session，包括当前传输约定；不因新增 Xmake 改成 Lua executor 或换协议。抽出 Native 的 Artifact 消费与 Runtime Steps，旧编译入口和 Xmake 入口共用。

Xmake rule 负责 C Runtime、Registry/entry 生成、构建身份与产物导出。Registry 使用显式 Suite C 符号；运行筛选使用 `run.suite`。Native 自动发现只发现测试定义/源码，不正则解析任意 C 代码。

### MCU

`ctest.mcu` 引用测试固件 target 和命名 Board。固件内 Case 可以直接操作真实 SPI；Host 工作流负责 lease、flash、reset、CTP discovery/run、日志和 close。

物理资源以真实 probe/板卡身份加跨进程独占锁，不仅靠逻辑 board0 名称；在可能失败的准备动作之前注册必要清理。处理 owned/borrowed、超时、断线、Ctrl+C、错误固件与 Boot ID。

先用 Host Simulation 与 Fake Board 验证契约，再用真实板完成 SPI 成功与可控失败闭环。未提供硬件时标记验收未执行/受阻，不以模拟通过替代。

### Kernel 与 Linux Driver

保留两个路径：Kernel 内部单测运行 Test Module；Driver ABI 测试构建真实 Driver Module，并由 Guest 程序访问设备接口。两者不能合并成一个只会跑 `.ko` 的 helper。

产品 Driver/Kbuild 定义由 Xmake target 引用或包装，不重新用普通 C 编译替代已有构建流程。新 JS helper 消费具名 Driver、Guest、Kernel、Rootfs 等产物。

允许第一阶段继续复用 JS 对测试专用 Kernel/BusyBox/Rootfs 的环境准备和缓存，前提是共享 Environment 只定义一次，且不重复配置产品 Driver 的 sources/defines。应在 plan 中显示这些过渡性 build Step；后续可继续包装为 Xmake target。该过渡不是保留两套产品构建模型。

真实 Linux 宿主 insmod/SSH 模式不假定已存在。首个 Driver 闭环按旧版 UML 路线完成；真实宿主部署后续作为独立 Provider，需单独权限和清理设计。

## 10. CLI 与可观察性

规划命令形态：

```sh
xmake ct --list
xmake ct --plan --tag=driver
xmake ct --doctor --tag=mcu
xmake ct --level=unit
xmake ct --level=unit,component --tag=native
xmake ct --tag=mcu,spi
xmake ct --tag=driver,abi
xmake ct --suite=spi_dma --case=transfer_4k integration.mcu.spi
xmake ct --test-profile=ci --level=unit
```

逗号形式是适配层拟提供的多值语法：level 列表 OR、tag 列表 AND，映射到现有 JS selector。重复 `--tag/--level` 的支持须由参数解析测试确认，不能在解析器丢弃前值时声称兼容。

Cautest Profile 用 `--test-profile`，避免抢占 Xmake 公共 `--profile`。[W2] 原有独立 JS CLI 不改名。

无选择条件的 run 延续执行 enabled Job 的语义，可能涉及烧写硬件；文档必须明确。日常示例优先显式 level/tag，而不是静默改成“只跑 Native”。

`list/plan` 只展示，不编译、不烧写、不加载驱动；`doctor` 可有显式轻量探测，但不开展破坏性部署。若 Xmake 本身在配置阶段触发自动依赖解析，也须区分工具固有行为与 Adapter 执行动作，并在 P0 验证可控制路径。

`list` 展示 ID、kind、level、tags、enabled、来源；`plan` 展示选中理由、构建 target/产物角色、相位、资源及运行选择。最终保留原 result/summary/events/failures/JUnit 等输出，附加 Adapter Manifest/Receipt 与 provenance。不能把基础设施 ERROR 伪装为测试 FAIL 或 PASS。

## 11. Cautest 仓库改动位置

```text
xmake.lua                          # 新增薄入口
adapters/xmake-test/
  xmake.lua                        # DSL/rules/task 注册
  modules/                         # collector/registry/manifest/target bridge
  rules/                           # native runtime、registry、artifact export
  tasks/                           # ct 与内部只读产物查询
src/adapters/xmake/
  manifest.ts                      # 新格式校验
  load.ts                          # Manifest → 正规 TestConfig
  factories.ts                     # 平台 Job 展开
  providers.ts                     # module/export/options 加载
src/build/                         # 新增或调整：Xmake Build Provider
src/config/select.ts               # 从 CLI 抽取共用选择逻辑
src/jobs/                          # 小步抽出共用 Runtime Step，不整体搬家
assets/cautest-c/                   # 保持布局；增加 Xmake 接入，不改协议
examples/xmake/                    # 独立接入、Native/MCU/Driver 示例
test/                              # 对应 adapter/selection/artifact/集成测试
```

目录为拟定位置，具体文件名随实现可调整；不以“整理目录”为理由搬动整个 Runtime/Host。包内现有 `src/`、`dist/`、`assets/` 比前面讨论过的虚构 `host/runtime` 布局更适合增量接入。[B20]

## 12. 兼容、发布与非目标

旧 `cautest.config.mjs`、JS helper、安装/便携入口继续可用；新 Adapter 以增加入口的方式接入。旧路径与新路径必须共享 selector、执行语义与 Reporter，不能分别维护两个测试引擎。

Manifest 独立版本化，新增到 `versions.json` 权威版本流程。只有确实变化的 schema/cache 才升级，C API、CTP、Kernel/Probe ABI 无变化就不动。保持现有版本同步与 docs 测试。

消费项目不应被迫拥有 pnpm 工程；Cautest 发布包包含可运行的 dist 和适配层。Node 仍然需要，开发 Cautest 本身也仍可使用 pnpm/TypeScript。第三方库如含原生扩展或平台资源，必须明确打包和安装要求，不能承诺一个 JS bundle 总能包含全部依赖。

首版不做：任意 target 自动克隆、自动解析 C Suite 宏、Case tag/协议升级、Lua Workflow 引擎、跨 Job 自动共享烧写会话、通用分布式调度、自动安装 Node、所有宿主平台同时支持。

## 13. 完成判定

最终交付应证明：一个工程只通过 Xmake 管理产品构建，分散 `test.lua` 汇成扁平 Job，按 level/tag 先选择后构建，Native/真实 MCU/Driver UML 分别有可复现闭环；旧 Cautest 的工作流、结果与兼容入口不退化。

Native 阶段通过可以作为首个可用增量，但不能把“Native 可运行”写成“MCU 与 Linux Driver 已支持”。详细任务、依赖和验收见 `PLAN.md` 与 `ACCEPTANCE.md`。
