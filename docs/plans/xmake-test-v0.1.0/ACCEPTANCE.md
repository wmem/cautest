# 验收矩阵与发布门禁

版本：v0.1.0；日期：2026-09-22。所有新功能验收当前均为**未执行**。本文件是待实施的检查要求，不是测试通过报告。

## 1. 证据规则

每次验收至少保存源码版本/归档身份、工具版本、完整命令、工作目录、退出码、日志和结果目录。硬件测试另保存板卡/探针身份、接线或外设前提、固件摘要及清理结果。路径和敏感信息按需要脱敏。

状态只使用 PASS、FAIL、未执行、受阻；“未提供板卡/Kernel”属于受阻，不是 PASS。这里的验收状态不是对 Cautest 既有 Case Result Schema 增加新的状态枚举。

本次已完成的唯一运行证据是包内既有 dist 的 5 个 Node 测试文件，20 项通过、0 项失败，见 `evidence/baseline-subset.tap`。没有重新编译 TS，没有执行 Xmake、实板、真实 UML；不得据此勾选下表。

## 2. Xmake 接入阻断项

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| XMK-01 | 工程 includes tools/cautest，后续 includes ctest.lua 与多个 fragment；重复 include | DSL/rule/task 可用且作用域明确；工具重复加载不重复注册；不污染产品 target |
| XMK-02 | 外层 xmake ct 等待 Node，Node 再调同工程 xmake build；失败与 Ctrl+C | 不死锁、不递归进入 ct；构建互斥仍有效；子进程完整退出并记录结果 |
| XMK-03 | Job ID glob、多值 level/tag、Case 参数、Xmake 公共参数 | 规范化值不丢失；重复参数支持以实测为准；--test-profile 不覆盖 Xmake --profile；帮助与实现一致 |

这三项必须在最低支持 Xmake 版本上实际运行，不得用模拟 task 对象替代。

## 3. 分散配置与路径

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| CFG-01 | 根文件只配置 include；两个模块各有 test.lua；新增第三模块 | 新 Job 自动进入扁平 Registry，无需逐项修改根文件；普通 build 不执行测试 |
| CFG-02 | 重复 Pattern、同文件多次 include、循环 include、不同文件同 Job ID | 文件去重；循环输出完整链；不同来源同 ID 报错且列出两处位置 |
| CFG-03 | 必需 Pattern 未匹配、optional include 不存在、vendor 中含 test.lua | 必需项失败；optional 行为明确；不扫描未声明 roots，不静默漏测 |
| CFG-04 | 从不同 cwd 执行，含空格/非 ASCII 路径，模块目录移动，JS 相对 import | 相对基准不漂移；target 名称不被目录拼接；生成目录不成为配置根；来源指向 Lua 原文件 |
| CFG-05 | 未知字段、错误 level、重复 profile、错误 tags、错误 Manifest 版本 | 明确 config/selection 错误；profiles 是既定结构；新旧默认值及浅合并语义不被暗改 |

## 4. 选择语义

构造如下固定 fixture：

| ID | level | tags | enabled |
|---|---|---|---|
| unit.math | unit | native, math, fast | true |
| component.protocol | component | native, protocol | true |
| integration.mcu.spi | integration | mcu, hardware, spi | true |
| integration.mcu.i2c | integration | mcu, hardware, i2c | true |
| integration.driver.foo | integration | driver, abi, uml | true |
| unit.disabled | unit | native, fast | false |

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| SEL-01 | level=unit,component；tags=mcu,spi；ID glob 与 level/tag 组合 | level 多值 OR、tags 多值 AND、不同维度 AND；与旧 selector 输出一致，不按 level 隐含向下包含 |
| SEL-02 | list/plan/run 的 disabled 与无命中 | list/plan 保留可见性；run 不执行 disabled；无命中沿用旧错误语义，不报告“全通过” |
| SEL-03 | --suite/--case/--parameter 覆盖 Job 默认运行选择；只选 Native | 不修改构建 Registry；保留原按字段覆盖规则；未选 Job 不烧写、不启 UML，不构建无关 target |

Registry 的 `suites` 中使用 `spi_*` 必须被拒绝；运行 `run.suite={"spi_*"}` 是另一种合法语义。

## 5. 构建、变体与产物

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| BLD-01 | 产品组件共享源定义；测试使用相同定义；依赖库受消费者宏影响的反例 | 无复制的产品源码/宏事实；需要重编时确实在测试 target 上重编，不误用另一宏配置的静态库 |
| BLD-02 | 生成头文件、条件源码、Mock 替换、产品 main、MCU 启动文件 | 依赖与构建顺序正确；不会生成两个 main；Mock 不与真实实现重复定义；不隐式替换启动文件 |
| BLD-03 | 两 target 的 private/public/interface 配置与共享 rule | 只传播契约允许的信息；不靠复制 target 私有状态通过测试；不支持的派生明确报错 |
| BLD-04 | 连续构建、改源码/头文件/宏/Suite/生成器、只改 Case 选择 | 正确增量；不因 list 或选择条件更新 Build ID 而无谓重编；运行选择不改变 Registry |
| BLD-05 | binary、MCU ELF/BIN、phony 包装 .ko 的 output 解析 | 使用实际 output/Receipt，不猜路径；内容摘要、context 与协议 Build ID 分开记录并校验 |
| BLD-06 | 同 target 多 Job、损坏 Receipt、删除产物、构建失败后残留旧文件 | 同上下文构建可去重；损坏或陈旧输入不执行；失败阻止后续 provision/run；每 Job 有正确归属 |
| BLD-07 | Native/MCU 架构、mode、工具链或构建 env 不同，但名字或输出目录相同 | 显式隔离或报错；不得串用产物、改写另一任务配置；不能用反复 xmake f 隐藏冲突 |

## 6. 工作流与结果

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| WF-01 | Manifest 经过 Loader；旧 plan JSON 被错误当作执行输入；list/plan | Loader 经 Factory 创建真正 TestJob/Step；拒绝展示格式冒充；list/plan 不调用构建/硬件 execute |
| WF-02 | 新 Artifact Provider 与旧 compiler helper 对相同测试执行 | 共用 Runtime Steps、CTP 与 Reporter；PASS/FAIL/ERROR/SKIP、allowEmpty、超时策略一致 |
| WF-03 | build/provision/run 抛错、整体超时、Ctrl+C、外部进程挂起 | 下游普通 Step 停止；按现有语义运行可执行的失败收集；已取得资源最终清理；子进程不遗留 |
| WF-04 | 多资源、owned/borrowed、cleanup 本身报错、已有部分 Case Result | LIFO 与所有权正确；清理失败不吞掉；保留已有结果并记录基础设施错误，不标 PASS |

若旧引擎在某个取消场景本身有缺陷，应独立记录/修复并跑旧入口回归，不能在 Adapter 内维护另一套不兼容的清理实现。

## 7. Native 闭环

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| NAT-01 | 多文件、多 Suite、Fixture、参数化、PASS/FAIL/ERROR/SKIP | Xmake 真正编译并执行 C Runtime；Node CTP 结果正确；不存在只检查进程退出码的降级 |
| NAT-02 | Registry/entry 生成、Suite 新增、Build ID 错误、普通 app 同时构建 | Registry 符号正确；Build ID 与实际 HELLO 匹配；产品二进制不混入测试入口；JSON/JUnit 有完整 Job 来源 |

## 8. MCU 与物理资源

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| MCU-01 | Host Simulation、错误 Build/Boot ID、同固件不同 Job、分片/断线 | 正确协议身份及既有恢复行为；同产物可重用而 Job 生命周期仍隔离；不是凭文件名确认固件 |
| MCU-02 | 两个进程、两个逻辑 Board 名指向同探针；设备占用 | 同一物理资源不可同时烧写/复位；失败锁可恢复且不误释放他人锁；等待与超时有诊断 |
| MCU-03 | flash/reset/openTransport 各阶段失败、超时、Ctrl+C、owned/borrowed | 在准备失败路径也能关闭已取得的资源；不误关借用设备；保留日志和实际失败阶段 |
| MCU-04 | 指定真实板的 SPI 外设识别/收发与可控错误场景 | 真正由 Xmake 构建、烧写、复位并从 C Case 得到结果；已知错误必须产生失败；留存工具/板卡/固件与恢复证据 |

物理测试的接线、外设、供电与故障注入需使用受控条件；禁止为“测试失败”设计不受控的破坏性操作。无实板时 MCU-04 保持受阻，不能删除该门禁以宣布完整 MCU 支持。

## 9. Kernel 与 Linux Driver

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| DRV-01 | Kernel Test Module 与 Driver + Guest ABI 两种输入 | 两条工作流区分明确；Module/Guest/Kernel/Rootfs 角色正确；不把 .ko 当二进制执行 |
| DRV-02 | Kernel 身份、ARCH、Module.symvers、Probe、Guest 链接与产物缓存 | 必需输入兼容；陈旧模块/Rootfs 不复用；不污染产品/Kernel 源码树 |
| DRV-03 | 真实 UML 的 read/write/ioctl、错误输入、模块/Guest 失败、启动超时 | 用实际接口验证 Driver，不以 fake 输出替代；结果、日志、UML 停止与资源清理完整 |
| DRV-04 | 环境缺失与真实 Kernel/Driver UML 验收 | KERNEL_SRC/BUSYBOX_SRC 等前提明确；缺失标受阻；两类真实执行分别有证据；未实现的 host/SSH 模式不宣称支持 |

## 10. 规模、分发与回归

| 编号 | 场景 | 必须满足的结果 |
|---|---|---|
| SCL-01 | 100/1000 分散 Job、重复 Pattern 与稳定排序 | 根 ctest.lua 大小基本不随 Case 数增长；发现结果与来源确定、无重复；记录时间/内存增长 |
| SCL-02 | 大量 Suite/Case、多个 Job 共用产物 | 不为每个 Case 自动生成一个构建 target/新进程；选择后构建；去重不改变测试隔离语义 |
| PKG-01 | 仓库与便携包放到 tools/cautest；其他 cwd 与特殊路径 | includes/JS import/C Runtime 路径均正确；不依赖开发者绝对路径 |
| PKG-02 | 未装 Node、未生成 dist、普通产品 build、帮助/list | 普通 build 不因 Node 缺失失败；实际需要 Node 的命令给可操作诊断；不自动联网安装 |
| PKG-03 | 第三方纯 JS/原生扩展、provider 相对模块、env 密钥 | 明确依赖解析与支持平台；不把函数/完整 env/密钥写到 Manifest 或日志；不承诺万能 bundle |
| PKG-04 | 打包内容、版本、固定 commit、干净解压验证 | 包含 root xmake.lua、Adapter、dist、C Runtime；版本一致；无工作机缓存依赖 |
| REG-01 | 重新构建 TS、旧默认完整门禁、版本/docs 检查 | 旧入口无回归；不是仅用包内 dist 通过部分测试代替 |
| REG-02 | 旧 JS 与新 Adapter 的相同测试、安装与结果路径 | 只改变配置/构建来源；不改变协议、选择和结果含义；迁移说明准确 |
| DOC-01 | 全部示例、支持矩阵、迁移说明、失败诊断 | 已实现/拟实现明确分开；每个支持平台都有实际门禁；无“自动继承全部配置”的未验证承诺 |

## 11. 放行清单

G0 必须先通过 XMK-01～03 及构建复用 PoC；G3 需 Native 真实闭环；G4 需稳定性、规模、兼容通过；G5 需 MCU-04 实板证据；G6 需 DRV-03～04 的真实 UML 证据；G7 汇总发行与文档。

如果只通过 G4，可以发布标明 Native 范围的增量；不能把 MCU/Driver 的设计代码或 Fake 测试写成完整支持。
