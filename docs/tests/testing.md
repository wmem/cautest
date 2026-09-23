# 测试策略

Cautest 同时测试 Host 编排和真实 C Target 行为。只通过 TypeScript Build 不能证明 Kernel 隔离、协议事件或清理语义正确，因此默认门禁组合静态类型、Host 单元/集成测试和真实 C 编译执行。

| 入口 | 覆盖重点 |
| --- | --- |
| `npm run typecheck` | TypeScript 实现与公开 `.d.ts` 一致性 |
| `npm run test:c` | C Core、Assertion、CTP3、Freestanding、Kernel ABI/选择和 Probe 模型 |
| `npm test` | 以上 C 门禁加 Node Workflow、Cache、Native、UML 组件、Driver、MCU、CLI、Reporter 和安装测试 |
| `npm run test:uml` | 真实 Linux UML、`examples/kernel-lib`、`examples/linux-driver-unit`、自动 Test Module、Rootfs、Guest Agent 和 CTP3 Case |
| `npm run test:driver:uml` | 真实 Linux UML、Driver Module、test-only Probe、Guest ABI Test 和 CTP3 Case |
| `npm run test:e2e` | 从固定 Git Commit 使用 npx 与 npm exec 编译、安装和执行便携版本 |
| `npm run test:xmake` | 真实 Xmake 3.1.1 的 DSL、Native、MCU Host 模拟、失败清理及便携组件；需 `CAUTEST_XMAKE` |
| `npm run test:xmake:kbuild` | 实际 Runtime/Test/Driver 模块构建及 Context/角色校验；需 `CAUTEST_XMAKE`、`KERNEL_BUILD`，不加载模块、不启动 UML |
| `npm run test:xmake:matrix` | private/public/interface、链接传递、GCC/Clang、配置输出隔离及 100/1000/2000 Job 测量 |
| `npm run test:xmake:uml` | 显式真实 Kernel Test + Driver ABI 冷/热、12 项故障/恢复、旧 JS 入口等价验收；需 Xmake 与 Kernel/BusyBox 源码，缺前提返回 BLOCKED/77 |
| `npm run versions:check` | 校验 Release、C API、CTP、Kernel/Probe ABI、Result/Event/CLI/Manifest/Cache 版本没有漂移 |

默认 Node 测试使用临时目录和伪 Make 隔离外部成本，但不会用伪输出替代关键行为：Native/Driver Guest/MCU Firmware 会真实编译并执行；Kernel Module 测试会验证源码树前后文件集合、损坏 Manifest 重建和不同 ARCH/Kernel 并发。

两个真实 UML 入口都必须显式提供 `KERNEL_SRC` 与 `BUSYBOX_SRC`，不使用开发者机器的私有默认路径：

```bash
KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox npm run test:uml
KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox npm run test:driver:uml
```

前者在一次共享环境中执行 `examples/kernel-lib` 与 `examples/linux-driver-unit` 的 Kernel Test Module 闭环；后者执行 `examples/linux-driver` 的 Driver、可选 Probe 和 Guest ABI 闭环。源码树缺失或结构不正确时，入口输出 `status: "BLOCKED"`、`code: "uml_prerequisites_missing"` 并以 77 结束；该结果表示外部环境未就绪，不表示测试通过。

`doctor` 的 Host/Toolchain Probe 会在系统临时目录编译最小程序，不写入项目源码树；Kernel 污染检查只读 `.config`、`include/config/auto.conf` 和 `include/generated/autoconf.h`，不会自动清理源码。

新增 Build 能力至少应验证输入变更会改变指纹、缓存命中不会跳过完整性校验、禁用缓存写入 Work 而非源码、并发发布是原子的。新增 Resource 应验证 ready、失败、owned/borrowed 和 Cleanup 后状态。新增 CTP3 Event 应同时验证任意分片、错误顺序和 C/JS 两侧。

真实硬件 MCU 不属于默认仓库门禁；项目 Adapter 负责 Flash、Reset、Transport 和物理环境稳定性，Cautest 公共测试使用 Host Simulation 与 External Adapter Contract 覆盖其边界。

## 版本维护与发布

[`versions.json`](../../versions.json) 是当前 Release 与所有协议、ABI、Schema、Manifest、Cache 版本的唯一机器可读权威来源。[版本记录](../changelog.md)保存各版本对使用者可见的变化和历史兼容性基线，两者职责不同：代码和构建读取前者，维护者和使用者查阅后者。

### 何时升级版本

| 版本维度 | 升级条件 |
| --- | --- |
| Release Major | 已发布的公共配置、CLI、结果或运行行为发生不兼容变化 |
| Release Minor | 增加向后兼容的能力或公共接口 |
| Release Patch | 修复缺陷，或只调整向后兼容的文档、构建和交付内容 |
| C API、CTP、Kernel ABI、Probe ABI Major | 现有调用方或通信对端必须修改才能继续工作 |
| C API、CTP、Kernel ABI、Probe ABI Minor | 增加旧调用方或旧对端可以忽略的兼容能力 |
| Schema | 持久化或对外数据的结构、含义发生变化，读取方需要据此区分格式 |
| Cache | 指纹输入、Manifest 结构或产物有效性假设变化，旧缓存可能被错误复用 |

一次修改可以同时升级多个维度。例如，兼容地增加协议能力通常升级 Release Minor 和 CTP Minor；仅改变缓存键构造则升级对应 Cache 版本，并按交付影响选择 Release 版本。无法确定兼容性时，应先补充新旧版本交互测试，再决定版本号。

### 准备发布

发布准备按以下顺序进行：

1. 在[版本记录](../changelog.md)顶部建立“未发布”章节，记录使用者可见的变化和所有协议、ABI、Schema、Cache 版本迁移。
2. 修改 `versions.json` 中受影响的版本。Release 变化时，同时修改根 `package.json`、`assets/cautest-c/package.json` 、`package-lock.json` 根条目和 `assets/cautest-c/Makefile` 中的 Release 版本。
3. 运行 `npm run versions:sync`，生成 `src/config/versions.ts` 和 `assets/cautest-c/include/cautest/version.h`。该命令不会替维护者修改 Package Manifest 或 Makefile；它会在这些文件漂移时失败。
4. 至少执行 `npm run versions:check` 和 `npm test`。涉及真实 Kernel UML 或 Driver 行为时，按变更范围追加 `npm run test:uml`、`npm run test:driver:uml`；涉及 Git 安装链时追加 `npm run test:e2e`。
5. 验证通过后，将“未发布”改为 `X.Y.Z — YYYY-MM-DD`，提交完整的发布候选变更，并确认工作树干净。
6. 在该 Commit 上运行 `npm run pack:portable`，检查归档文件名包含目标版本和 Commit，校验 `.sha256`，并从解压目录执行 `cautest.js --version`。
7. 确认归档对应已验证的 Commit 后，创建 annotated tag `vX.Y.Z`。推送发布 Commit、tag 和分发归档属于显式发布动作，不由构建脚本自动执行。

`npm run build`、`npm test`、安装器与便携包构建都会执行版本漂移检查。发布记录、tag、归档中的版本和 Commit 必须指向同一份已验证源码；带 `-dirty` 的归档只能用于本地检查，不能作为正式发布产物。

## npm 工具链迁移

开发使用 `npm ci` 和 `npm test`。完整门禁包含空消费项目中的离线 npm tarball 安装、`npm exec` 安装器与实际 Workflow 运行；固定 Git Commit 的安装另用 `npm run test:e2e`。本轮环境、原始基线与离线验证边界见 [npm 迁移验证](npm-migration.md)。


## Xmake 增量的验收边界

当前逐项状态见 [实施进度](../plans/xmake-test-progress.md)。原方案和历史基线不改写为通过报告。
`test:xmake:kbuild` 可以使用显式 Host headers 做真实构建组件检查，但不能代替
`test:xmake:uml`。后者只有真实 Kernel Test 与 Driver Guest CTP、日志、清理及缓存复跑均通过
才成功；缺失前提的退出码 77 不是测试通过。默认套件中的 Agent 模拟器、人工 Kernel fixture
和假 Make 只覆盖各自组件契约，不会满足真实 UML 或实板门禁。
