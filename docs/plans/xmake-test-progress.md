# Cautest Xmake 继续实施：MCU 软件模拟与宿主可靠性

本轮开始：2026-09-23 **12:28:41 +08:00**；一小时截止：**13:28:41 +08:00**。
新增功能工作已于 **13:10:26 +08:00** 停止，为最终 bundle 独立克隆回归预留时间。
最终封存时间、精确 HEAD、bundle 校验值及冷克隆日志记录在外部交付报告。
未使用网络，没有执行 pnpm 或安装系统软件包。

**当前是经过验证的增量交付，不是全平台总验收通过。** 用户同意 MCU 先模拟，本轮已完成 SPI 软件行为模拟与失败恢复；原始实板门禁单列延期，不要求用户现在提供硬件。真实 Linux 6.6.157 UML 仍被缺少 flex 阻断。

## 新增且独立验证的工作

| Commit | 内容 |
|---|---|
| `ac00a1b` | UML 构建缓存及 Xmake 构建/查询/Receipt 跨进程事务锁；不同 Guest 输出名分离缓存键 |
| `5929e3f` | 不执行模块代码的静态 Board 依赖快照；显式动态输入 |
| `1aaf931` | 真实编译 SPI 行为模型、已知故障/恢复，MCU 失败与迟到 Transport 清理 |
| `fba3ec5` | Kernel/BusyBox 所有配置阶段传递 makeArgs；bc 能力检查及离线依赖收集器 |
| `d7a8881` | 修正可选 close 的 TypeScript 类型与文档目录问题；16 Suite/1024 Case 实测 |
| `fa5d936` | 消费工程的真实 N-API 扩展在源码与可搬迁便携包中加载 |
| `1bea7a0` | 从 BusyBox 1.36.1 构建私有静态 bc 的可复现脚本 |
| `c51184a` | 并行 GCC/debug 与 Clang/release；会话中途改配置必须在 CTP 前失败 |
| `cf26552` | 便携包执行 SPI 模拟，记录上传依赖的实际清单 |

默认回归 **157/157**，真实 Xmake **21/21**，真实 Kbuild 组件 **2/2**，显式构建/规模矩阵 **4/4**。这些计数无失败、无跳过。精确最终 HEAD 的新克隆结果以外部 `cautest-bundle-verification.log` 为准；不是空 Registry 缓存下的 npm ci。

开发中完整构建发现可选 Transport.close 类型错误，随后默认回归发现新说明文档放错目录。两项均已修正，失败证据保留；重新构建和完整回归通过，未降低断言。

## 关键验证边界

缓存锁以 Linux flock 协调同一用户、同一锁目录的合作进程，锁不放入产物树。六个独立进程共享一次真实 Guest 编译；验证取消、超时、崩溃释放和路径别名。四个同工程 Xmake 会话与另一个独立工程并行通过，另有不同工程的 GCC/debug 与 Clang/release 并行实测。

Cautest 会话固定一个 Xmake 配置。外部 `xmake f` 不在它的锁契约内；实际注入编译后切换配置时，旧会话在 CTP 前失败，新会话重新读取配置后恢复。它不是“同工程任意两个全局配置并行”的承诺。

SPI 模型包含片选、模式、设备 ID、写使能、存储读写、非法参数和复位。两个 Job 共享一个固件产物，但各自烧写/复位/连接/清理；四个 C Case 通过。注入错误 ID 后必须 FAIL/退出 1，恢复配置后再次通过。另有 owned/borrowed 的 16 个 flash/reset/open 抛错、超时、无效 Adapter 和清理异常组合，以及迟到工厂/Transport 的关闭验证。它不是 MCU 指令集、周期、引脚或电气模型。

静态 ESM 导入/导出及循环依赖在不执行 Board 模块的情况下记录；require、动态导入、数据文件和原生扩展的隐含输入必须通过 `provider.inputs` 显式声明。一个真实 N-API v1 fixture 的源码/便携验证通过，不代表任意 USB/串口扩展都兼容。

16 个 Suite / 1024 个实际 C Case 分给两个 Job，只构建一个 target；筛选再次执行 8 Case，二进制身份和 mtime 不变，JUnit/JSON 数量一致。记录的 GNU time 最大 RSS 是命令树单进程峰值，非所有并行进程内存之和；不是无界压力性能保证。

## 本次上传的依赖与真实 UML 阻断

压缩包实际只有 **bison、cpio、zlib1g、zlib1g-dev 四个 `.deb`** 及其展开文件。没有 flex 或 bc 包。Bison/cpio 已直接执行成功；bc 已使用上传的 BusyBox 源码真实静态编译，并执行任意精度算术和 Linux timeconst 生成。

实际 Linux 6.6.157 的配置命令仍停在：

```text
LEX scripts/kconfig/lexer.lex.c
/bin/sh: 1: flex: not found
```

真实 Xmake UML 入口完成 list/plan 后，Doctor **BLOCKED / exit 77**，当前执行工具探测只剩 flex。宿主 libelf 开发头缺失，但构建尚未走到证明它必需的阶段；宿主 OpenSSL 头已存在。没有启动 UML、加载宿主模块或执行真实 Driver read/write/ioctl。本轮 Kbuild 组件测试仍使用预装 **6.12.96+deb13-amd64 headers**，不是上传的 6.6.157。

新的 [依赖准备说明](../usage/xmake-kernel-driver.md) 提供空 dpkg 状态的完整下载脚本，避免普通 download-only 跳过已安装包。它只下载、不安装；离线测试用显式 APT 替身与真实 dpkg-deb，不能当作在线镜像下载验证。私有 bc 构建脚本已真实执行。

## 剩余任务

最直接的外部阻断是 **flex**。补齐后仍需实际构建 Linux 6.6.157、启动 UML、执行 Kernel Test 与 Driver ABI 冷/热缓存及 read/write/ioctl/非法输入/失败清理，不保证后续不会出现新的编译或运行问题。

冷 Registry npm ci、额外 Node 版本/宿主平台、完整发布候选总验收尚未执行。真实 MCU 的 ELF/BIN、启动/链接和物理 SPI 属于用户同意延期的硬件范围；原计划的 Later 项继续延期。Artifact Driver Probe/Kernel Coverage 的额外 DSL 不在本轮新增范围，旧独立 JS helper 保留。

[逐项机器进度](xmake-test-progress.json) 保留原计划编号与范围；[原方案](xmake-test-v0.1.0/README.md) 的九个文件与上传 ZIP 逐字节一致，没有修改原始验收条件。
