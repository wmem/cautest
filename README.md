# Cautest

Cautest 是面向 Native C、Linux Kernel/Driver、MCU 和系统脚本的工程测试工具。它用 JavaScript 配置统一不同目标环境的构建、运行、筛选和结果收集，并把所有测试组织为可由 `plan` 检查的 `TestJob → Workflow → Result`。

## 环境要求

- Node.js 20.6 或更新版本；
- Native C 示例需要可用的 C99 Compiler；
- Kernel UML 和 Linux Driver 示例还需要 Linux Kernel、BusyBox 源码及 UML 构建依赖。

## 从 Git 安装到项目

安装器会创建一个自包含目录。Git URL 应固定到完整 Commit，使开发环境和 CI 使用同一版本：

```bash
npx --yes 'git+ssh://<Cautest Git URL>#<完整 Commit>' ./tools/cautest
npx --yes 'git+ssh://git@gitlab.kunyi.local:mem-tools/cautest.git' ./tools/cautest
```

pnpm 11 需要显式允许安装脚本：

```bash
cautest_spec='git+ssh://<Cautest Git URL>#<完整 Commit>'
pnpm dlx --allow-build="cautest@${cautest_spec}" "${cautest_spec}" ./tools/cautest
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
pnpm install
pnpm pack:portable
```

将归档解压到目标项目即可运行：

```bash
mkdir -p ./tools
tar -xzf cautest-<版本>-<commit>.tar.gz -C ./tools
./tools/cautest/cautest.js --version
```

## 下一步

- 第一次使用或需要选择测试类型，从[使用指南](docs/usage/index.md)开始；
- 开发、维护或诊断 Cautest 本身，从[开发者文档](docs/index.md)开始。

安装目录会携带 `docs/usage/`、可运行的 `examples/`、配置 `.d.ts` 和 C 公共头文件；架构、协议与测试策略等开发者资料只保留在源码仓库中。
