# Xmake 构建边界与发现规模实测

## 运行方式

```sh
CAUTEST_XMAKE=/absolute/path/xmake npm run test:xmake:matrix
```

此显式矩阵需要 Linux x86_64、GCC、Clang 和 `/usr/bin/time`。缺少工具是失败而非跳过；
不自动下载依赖。它不包含 MCU 交叉编译、不运行 UML，也不表示所有平台已经验收。

## 2026-09-23 离线实测

使用上传的 Xmake 3.1.1，3 项测试通过，0 失败、0 跳过。

| 维度 | 实际验证 |
| --- | --- |
| private/public/interface 宏及 include 路径 | 产品静态库与测试消费者各自只看到规定的作用域；测试宏不能回溯修改产品库 |
| 链接依赖 | 产品库公开的 libm 和链接参数传播到测试可执行文件，并实际执行 CTP Case |
| 构建模式 | release/debug 路径和协议身份分离 |
| 工具链 | GCC → Clang 切换后 Receipt 配置摘要和协议 Build ID 均改变 |
| 构建目录 | 切换输出目录后，消费新的目标路径而非之前的 ELF |
| 分散收集与筛选 | 20 个 fragment，100/1000/2000 Job；`scale,even` 选出一半，不产生 build 目录 |

发现与筛选这次分别耗时 178/229/276 ms，GNU time 所记录的最大 RSS 分别为
54268/65292/74312 KiB。该指标是命令进程树的最大子进程 RSS，不是所有同时运行进程的内存总和；
单机一次 smoke 测量不用于承诺性能上限或严格复杂度证明。

仍需补全 MCU 启动/链接脚本、跨架构工具链、全部并发配置隔离，以及真实 Kernel/Driver UML 矩阵。
