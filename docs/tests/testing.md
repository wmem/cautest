# 测试策略

Cautest 同时测试 Host 编排和真实 C Target 行为。只通过 TypeScript Build 不能证明 Kernel 隔离、协议事件或清理语义正确，因此默认门禁组合静态类型、Host 单元/集成测试和真实 C 编译执行。

| 入口 | 覆盖重点 |
| --- | --- |
| `pnpm typecheck` | TypeScript 实现与公开 `.d.ts` 一致性 |
| `pnpm test:c` | C Core、Assertion、CTP3、Freestanding、Kernel ABI/选择和 Probe 模型 |
| `pnpm test` | 以上 C 门禁加 Node Workflow、Cache、Native、UML 组件、Driver、MCU、CLI、Reporter 和安装测试 |
| `pnpm test:uml` | 真实 Linux UML、`examples/kernel-lib`、`examples/linux-driver-unit`、自动 Test Module、Rootfs、Guest Agent 和 CTP3 Case |
| `pnpm test:driver:uml` | 真实 Linux UML、Driver Module、test-only Probe、Guest ABI Test 和 CTP3 Case |
| `pnpm test:e2e` | 从固定 Git Commit 使用 npx 与 pnpm dlx 编译、安装和执行便携版本 |
| `pnpm versions:check` | 校验 Release、C API、CTP、Kernel/Probe ABI、Result/Event/CLI/Manifest/Cache 版本没有漂移 |

默认 Node 测试使用临时目录和伪 Make 隔离外部成本，但不会用伪输出替代关键行为：Native/Driver Guest/MCU Firmware 会真实编译并执行；Kernel Module 测试会验证源码树前后文件集合、损坏 Manifest 重建和不同 ARCH/Kernel 并发。

两个真实 UML 入口都必须显式提供 `KERNEL_SRC` 与 `BUSYBOX_SRC`，不使用开发者机器的私有默认路径：

```bash
KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox pnpm test:uml
KERNEL_SRC=/path/to/linux BUSYBOX_SRC=/path/to/busybox pnpm test:driver:uml
```

前者在一次共享环境中执行 `examples/kernel-lib` 与 `examples/linux-driver-unit` 的 Kernel Test Module 闭环；后者执行 `examples/linux-driver` 的 Driver、可选 Probe 和 Guest ABI 闭环。源码树缺失或结构不正确时，入口输出 `status: "BLOCKED"`、`code: "uml_prerequisites_missing"` 并以 77 结束；该结果表示外部环境未就绪，不表示测试通过。

`doctor` 的 Host/Toolchain Probe 会在系统临时目录编译最小程序，不写入项目源码树；Kernel 污染检查只读 `.config`、`include/config/auto.conf` 和 `include/generated/autoconf.h`，不会自动清理源码。

新增 Build 能力至少应验证输入变更会改变指纹、缓存命中不会跳过完整性校验、禁用缓存写入 Work 而非源码、并发发布是原子的。新增 Resource 应验证 ready、失败、owned/borrowed 和 Cleanup 后状态。新增 CTP3 Event 应同时验证任意分片、错误顺序和 C/JS 两侧。

真实硬件 MCU 不属于默认仓库门禁；项目 Adapter 负责 Flash、Reset、Transport 和物理环境稳定性，Cautest 公共测试使用 Host Simulation 与 External Adapter Contract 覆盖其边界。

## 版本变更

`versions.json` 是 Release 与所有协议、ABI、Schema、Manifest、Cache 版本的唯一权威来源。修改版本后运行 `pnpm versions:sync`，它同步 TypeScript 版本模块和 C `version.h`；`pnpm build`、`pnpm test`、安装器与便携包构建都会先执行漂移检查。`package.json.version` 也必须与 `versions.json.release` 一致，否则构建立即失败。
