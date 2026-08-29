# 排查第一次运行失败

先不要直接执行昂贵构建。回到配置所在目录，从环境检查和计划开始：

```bash
./tools/cautest/cautest.js doctor --json
./tools/cautest/cautest.js list
./tools/cautest/cautest.js plan
```

如果没有选中 Job，检查配置文件位置、Job `enabled`、ID/Glob、`--level` 和 `--tag`。显式选择为空会返回退出码 4，不表示测试成功。

如果 `doctor` 报文件 Pattern 未匹配，所有 `tests`、`sources` 和 `headers` 都相对于根配置目录解析；确认命令加载的是预期 `cautest.config.mjs`。不要用当前 Shell 目录猜测 Pattern 基准。

Native 或 MCU 模拟构建失败时，先确认 C Compiler 可执行、支持 C99，并能完成所需静态链接。加入 `--verbose` 可以把完整构建输出写到 stderr：

```bash
./tools/cautest/cautest.js run --verbose
```

Kernel 或 Driver 在第一次运行前应设置：

```bash
export KERNEL_SRC=/path/to/linux
export BUSYBOX_SRC=/path/to/busybox
```

同时为首次构建显式预留足够时间，最小配置如下：

```js
const environment = umlKernelEnvironment({
  kernel: {
    sourceDir: process.env.KERNEL_SRC,
    timeoutMs: 20 * 60_000,
  },
  busybox: {
    sourceDir: process.env.BUSYBOX_SRC,
    timeoutMs: 10 * 60_000,
  },
});
```

`kernel.timeoutMs` 和 `busybox.timeoutMs` 控制各自的 Build Step；具体值应根据机器性能和源码配置调整。未设置时，两者会继承通用 60 秒 Step 默认值，`doctor` 会给出警告。CLI 的 `--run-timeout` 只控制 C Test Run，不能延长 Kernel 或 BusyBox Build Step。

源码树必须包含有效 Makefile，Kernel UML 还需要 `arch/um/Kconfig`。如果 `doctor` 报 Kernel in-tree 污染，请换用干净源码树；Cautest 不会自动删除 `.config` 或生成文件。缺少 `cpio`、静态链接或 UML ptrace 能力时按诊断修复宿主环境。

BusyBox 首次执行 `silentoldconfig` 时，`--verbose` 日志可能出现类似交互问答的配置项；该子进程不接收终端输入，会使用默认配置继续执行，这本身不表示构建卡住。应结合 Step 超时和后续日志判断。

Driver Module 构建成功但 Guest 无法访问设备时，检查 Module 是否按 `drivers` 顺序进入 Rootfs、设备注册是否成功，以及 Driver 的 `output` 是否与 Kbuild 产物一致。Probe 测试还要确认产品 Makefile 在 `CONFIG_CAUTEST=y` 时包含两个 Cautest Header 目录。

Script System Test 卡在启动阶段时，先检查 `processStart.ready` 对应的文件、端口或输出是否真的出现；进程退出、Ready Timeout 和 Case Timeout 是不同错误，应分别处理。

运行结束后先读 `.cautest/results/<run-id>/summary.json`。测试 Assertion 失败返回 1；构建、环境、Target 或协议错误返回 2；CLI、配置或计划错误返回 3；第一次 Ctrl-C 完成收集和清理后返回 130。详细失败按 `failures.jsonl` 的 `detailRef` 进入 `result.json`，不要只依赖 Console 的摘要。
