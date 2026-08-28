# 测试策略

Cautest 同时测试 Host 编排和真实 C Target 行为。只通过 TypeScript Build 不能证明 Kernel 隔离、协议事件或清理语义正确，因此默认门禁组合静态类型、Host 单元/集成测试和真实 C 编译执行。

| 入口 | 覆盖重点 |
| --- | --- |
| `pnpm typecheck` | TypeScript 实现与公开 `.d.ts` 一致性 |
| `pnpm test:c` | C Core、Assertion、CTP3、Freestanding、Kernel ABI/选择和 Probe 模型 |
| `pnpm test` | 以上 C 门禁加 Node Workflow、Cache、Native、UML 组件、Driver、MCU、CLI、Reporter 和安装测试 |
| `pnpm test:uml` | 真实 Linux UML、自动 Kernel Test Module、Rootfs、Guest Agent 和 CTP3 Case |
| `pnpm test:e2e` | 从固定 Git Commit 使用 npx 与 pnpm dlx 编译、安装和执行便携版本 |
| `pnpm audit:v1` | V1 的 103 个 API、46 个测试文件、6 组 Example 和 89 篇文档均有迁移结论 |

默认 Node 测试使用临时目录和伪 Make 隔离外部成本，但不会用伪输出替代关键行为：Native/Driver Guest/MCU Firmware 会真实编译并执行；Kernel Module 测试会验证源码树前后文件集合、损坏 Manifest 重建和不同 ARCH/Kernel 并发。`test:uml` 需要 `KERNEL_SRC` 与 `BUSYBOX_SRC`，未设置时使用开发环境默认路径。

新增 Build 能力至少应验证输入变更会改变指纹、缓存命中不会跳过完整性校验、禁用缓存写入 Work 而非源码、并发发布是原子的。新增 Resource 应验证 ready、失败、owned/borrowed 和 Cleanup 后状态。新增 CTP3 Event 应同时验证任意分片、错误顺序和 C/JS 两侧。

真实硬件 MCU 不属于默认仓库门禁；项目 Adapter 负责 Flash、Reset、Transport 和物理环境稳定性，Cautest 公共测试使用 Host Simulation 与 External Adapter Contract 覆盖其边界。
