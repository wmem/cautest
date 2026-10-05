# Cautest

## Xmake Addon 命令

本仓库提供 Addon `cautest`，安装后可以在消费工程中直接运行 `xmake ctest`，无需复制工具源码或在工程中 `includes()`。默认读取工程根目录 `ctest.lua`，`--config=<路径>` 可选择其他配置；相对路径按工程根目录定位，其他目录执行时使用 `-P <工程目录>`。

分发配方位于 [xmake-addons-repo](../xmake-addons-repo/README.md)，由工具自己的 [准备脚本](scripts/prepare-addon.lua)安装运行资源。现有工程内接入入口保持可用。以下说明只涉及新插件命令，公开规则和模块的 Addon 接入尚未迁移。

```sh
xmake ctest
xmake ctest --config=ctest.lua
xmake ctest -P /path/to/project --help
```

新命令为 `ctest`，配置继续使用现有 `ctest.*` 声明。插件只在命令运行时为子进程注入工程接入文件，复用既有 `ct` 执行链路及退出码；内部构建和产物查询继承该接入环境。普通 Xmake 命令不因此自动读取 `ctest.lua`。安装时按 npm lock 编译 TS，运行时仅需 Node，不携带编译依赖。Native 测试需要消费工程自己的 `xmake.lua`，测试目标可在 `ctest.lua` 中声明。

本地开发需先准备完整插件目录，再交给 Xmake 安装。直接从源码 Git URL 或原始目录安装只会复制 Addon 内容，不执行分发配方，因此不会自动准备运行资源。

```sh
xmake lua scripts/prepare-addon.lua /tmp/cautest-addon-stage
xmake addon --install /tmp/cautest-addon-stage
```

准备脚本拒绝覆盖已有输出目录。验证统一由索引仓库的 [插件集成测试](../xmake-addons-repo/tests/test_addons.py)覆盖，原有工具测试仍可独立执行。

Cautest 是面向 Native C、Linux Kernel/Driver、MCU 和系统脚本的工程测试工具。它用 JavaScript 配置统一不同目标环境的构建、运行、筛选和结果收集，并把所有测试组织为可由 `plan` 检查的 `TestJob → Workflow → Result`。

## 环境要求

- Node.js 20.6 或更新版本；
- Native C 示例需要可用的 C99 Compiler；
- Kernel UML 和 Linux Driver 示例还需要 Linux Kernel、BusyBox 源码及 UML 构建依赖。

## npm 开发方式

源码仓库使用 npm 与 `package-lock.json`，不需要 pnpm。首次检出后执行：

```bash
npm ci
npm test
```

`npm ci` 的 `prepare` 会检查版本、编译 TypeScript 并生成 Build Info；如果显式使用 `--ignore-scripts`，随后执行 `npm run prepare`。只有开发依赖需要安装，便携包运行时没有 npm 依赖；离线开发需要预先缓存锁文件中的依赖，不会自动改用其他包管理器。

## 直接 clone 到 tools/cautest

消费工程无需成为 npm 工程。将本仓库克隆到 `tools/cautest`，只在工具自身目录准备开发依赖和 `dist`：

```bash
git clone <Cautest仓库或git.bundle路径> tools/cautest
npm --prefix tools/cautest ci
node tools/cautest/cautest.js --version
node tools/cautest/cautest.js --config ./cautest.config.mjs list
node tools/cautest/cautest.js --config ./cautest.config.mjs run --level unit
```

这里使用的是已有 JS 配置入口；项目仍可 `import { testConfig } from "@cautest/config.js"`。运行时只需 Node，不依赖工具目录中的 `node_modules`。缺少 `dist` 时给出 npm 准备命令，不自动安装。

Xmake 工程可以在自己的 `xmake.lua` 中加入 `includes(os.files("tools/cautest/xmake.lua"))`。工具存在时自动读取项目根目录的 `ctest.lua`，使用分散的 `ctest.*` 声明与 `xmake ct`；也可以用 `xmake ct --config=xxx.lua` 选择其他配置。工具尚未安装时不会读取测试配置，便于项目先运行初始化任务。Native、MCU SPI 软件行为模拟，以及 Linux 6.6.157 真实 UML 的 Kernel Test / Driver ABI 已执行验证；实板 MCU/SPI 按当前范围延期，模拟不代表物理硬件验收。详见 [Xmake 使用说明](docs/usage/xmake.md)和 [Kernel/Driver 接入说明](docs/usage/xmake-kernel-driver.md)。

使用 xspm 时，将 Cautest 声明在项目 `xspm.json` 的 `devDependencies` 中，固定包含
[安装钩子](xspm.lua) 的提交。xspm 安装或升级该包时自动执行 `on_install`，在工具目录
按 npm lock 安装开发依赖并构建 `dist`；宿主 `init` 无需包含 npm 操作。首次安装需要
npm Registry 访问权限或锁定依赖的本机缓存。构建失败由 xspm 报告，下次同步会重试；
相同提交重复同步不重建。手动删除 `dist` 后可执行 `xmake xspm --reinit cautest`
重新准备。普通 `xmake ct` 不安装依赖。

如果项目选择把 Cautest 作为 npm 依赖安装，ESM 可从 `"cautest"` 或 `"cautest/config.js"` 导入公共 API；这不代表已向公共 Registry 发布该私有包。`npx <Git URL>` 仍选择原来的 `cautest-install` 安装器，不改成测试执行命令。

## 从 Git 安装到项目

安装器会创建一个自包含目录。Git URL 应固定到完整 Commit，使开发环境和 CI 使用同一版本：

```bash
npx --yes 'git+ssh://<Cautest Git URL>#<完整 Commit>' ./tools/cautest
npx --yes 'git+ssh://git@gitlab.kunyi.local:mem-tools/cautest.git' ./tools/cautest
```

目标目录必须不存在或为空，安装器不会覆盖已有内容。建议把生成的 `tools/cautest/` 加入 `.gitignore`，只提交项目配置和测试源码。

安装后先验证可执行文件：

```bash
./tools/cautest/cautest.js --version
./tools/cautest/cautest.js --help
```

创建 `cautest.config.mjs` 后，再用 `./tools/cautest/cautest.js doctor` 检查当前项目环境。

## 使用便携包

维护者可在仓库中生成带 SHA-256 校验文件的便携包：

```bash
npm ci
npm run pack:portable
```

将归档解压到目标项目即可运行：

```bash
mkdir -p ./tools
tar -xzf cautest-<版本>-<commit>.tar.gz -C ./tools
./tools/cautest/cautest.js --version
```

## 下一步

- 第一次使用或需要选择测试类型，从[使用指南](docs/usage/index.md)开始；
- 开发、维护或诊断 Cautest 本身，从[开发者文档](docs/index.md)开始；
- 评估升级影响或准备发布时，查看[版本记录](docs/changelog.md)和[版本维护流程](docs/tests/testing.md#版本维护与发布)。

安装目录会携带 `docs/usage/`、可运行的 `examples/`、配置 `.d.ts` 和 C 公共头文件；架构、协议与测试策略等开发者资料只保留在源码仓库中。

## 许可

本项目使用 [MIT 许可证](LICENSE)。从 Git 安装或解压便携包后，许可文本位于工具目录的 `LICENSE`。

## Xmake 工程内使用

准备源码依赖后，在工程中加入 `includes(os.files("tools/cautest/xmake.lua"))`，
通过分散的 `ctest.*` 声明和 `xmake ct` 运行既有 Workflow。
参见 [Xmake 使用说明](docs/usage/xmake.md)；当前真实验证平台是 Xmake 3.1.1 / Linux x86_64（Native、MCU SPI 软件模拟，以及 Linux 6.6.157 / BusyBox 1.36.1 的真实 UML），不代表其他宿主、工具链或实板通过。
