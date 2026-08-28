# Cautest V2

Cautest V2 使用 TypeScript 维护公共配置 Schema 和运行实现。所有配置最终生成
`TestJob`，所有 `TestJob` 最终展开为可以由 `plan` 打印的线性 Workflow。

当前仓库从 V2 Schema 和便携安装链开始独立演进，不继承 Cautest V1 的 Git 历史。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
```

## 从 Git 安装

```bash
npx --yes 'git+ssh://example/cautest.git#<commit>' ./tools/cautest

# 或（pnpm 需要按完整 Git Spec 显式允许编译脚本）
cautest_spec='git+ssh://example/cautest.git#<commit>'
pnpm dlx --allow-build="cautest@${cautest_spec}" "${cautest_spec}" ./tools/cautest
```

Git 安装阶段会编译 TypeScript。生成的便携目录只包含 JavaScript、`.d.ts`、使用文档
和运行资产，不包含 `node_modules` 或 TypeScript 源码。

pnpm 11 默认禁止 Git Package 执行 `prepare`。由于 Cautest 明确选择在安装阶段编译，
pnpm 命令中的 `--allow-build` 必须包含与安装参数相同、固定到完整 Commit 的 Git
Spec。只写包名不足以批准 Git Package 的 `prepare`。
