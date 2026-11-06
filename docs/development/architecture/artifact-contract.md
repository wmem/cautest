{% section id="cautest:dev:architecture:artifact-contract" title="Artifact Receipt v2 与构建产物合同" %}

src/artifacts/index.ts 定义公开类型和严格的 Receipt 校验。当前 schemaVersion 为 2，与 CTP、Result 的版本分别维护；旧 v1 说明保存在[历史合同](../history/artifact-v1.mdoc)。

{% section id="cautest:dev:architecture:artifact-contract:receipt" title="产物身份与 Receipt" %}

ArtifactRef 显式指定工程 target 和可选的输出角色，默认角色为 primary，不复制源码、宏或编译参数。Build Provider 只在 Workflow 的 build 阶段调用，返回包含以下内容的 ArtifactReceipt：

- target、schemaVersion 和 kind；
- context：绝对 projectRoot/buildDir，以及 plat、arch、mode；
- outputs：唯一 role、绝对 path 和非负整数 size；
- 可选的 protocolBuildId；用于 Native/MCU CTP 运行时默认要求提供。

协议 Build ID 标识配置后的 Target 构建目录，不是源码或产物内容摘要；同一目录内重建可以保留身份。源码和 Header 增量由 Xmake/Make/Kbuild 判断。

{% /section %}

{% section id="cautest:dev:architecture:artifact-contract:resolve" title="解析与失败边界" %}

resolveArtifact 校验 schema/kind、target、上下文、角色唯一性、路径及字段类型，并对每个输出执行 stat，确认其存在且为普通文件。它不读取二进制计算摘要，也不将 Receipt 声明的 size 与实际文件大小作完整性比对。缺失角色、文件、上下文不一致或缺少必需协议身份会在 build 阶段失败，阻止下游运行。

需要重新产生损坏产物时，显式清理或由原构建系统重建；不能把存在性校验视为内容完整性证明。发行包的 SHA-256 安装校验属于另一条交付边界。

{% /section %}

{% section id="cautest:dev:architecture:artifact-contract:workflow" title="与 Workflow 协作" %}

nativeArtifactJob 和 mcuArtifactJob 复用现有运行 Step Factory。

Provider/Adapter 经 artifactBuildStep 和 getArtifact 保存及读取构建产物，不引入独立调度器、CTP 引擎、Reporter 或编译缓存。

资源锁和 Board 的 owned/borrowed 清理由既有 Workflow 生命周期管理，详见[执行架构](overview.md)。

回归入口为 test/artifact.test.js，覆盖无效 Receipt、失败阻断、Native/模拟 MCU CTP 等价及 Board 准备失败清理。测试方法与实际环境边界见[测试策略](../acceptance/testing.md)。

{% /section %}

{% /section %}
