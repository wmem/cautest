# Cautest V2

Cautest 把 Native、Kernel/UML、Linux Driver ABI、MCU 和 Script System Test 统一为一种顶层对象：`TestJob`。项目配置的 `jobs` 只能是 `TestJob[]`；每个 Job 在创建时已经展开成有序 Workflow，`plan` 打印的顺序就是实际执行顺序。

配置继续使用 JavaScript，公共 API 从稳定逻辑入口导入：

```js
import { nativeCTestJob, testConfig } from "@cautest/config.js";

export default testConfig({
  jobs: [
    nativeCTestJob({
      id: "unit.utils.queue",
      tests: ["test/unit/utils/queue_test.c"],
      sources: ["src/utils/queue.c"],
      headers: ["src/utils/queue.h"],
    }),
  ],
});
```

## 安装和运行

Cautest 要求 Node.js 20.6 或更新版本。Git 安装阶段执行项目自带的 TypeScript Compiler；生成目录不包含 TypeScript 源码或 `node_modules`，只包含 JavaScript、`.d.ts`、文档和运行资产。

```bash
npx --yes 'git+ssh://example/cautest.git#<commit>' ./tools/cautest

# pnpm 11 必须对固定到完整 Commit 的 Git Spec 显式允许 prepare
cautest_spec='git+ssh://example/cautest.git#<commit>'
pnpm dlx --allow-build="cautest@${cautest_spec}" "${cautest_spec}" ./tools/cautest

./tools/cautest/cautest.js --version
./tools/cautest/cautest.js doctor
./tools/cautest/cautest.js plan
./tools/cautest/cautest.js run --json
```

版本输出同时包含 `package.json` 版本和构建 Commit。`run --json` 的 stdout 只有 Run 摘要；实时 Job/Step、heartbeat、Cache Hit/Miss 和 `--verbose` 构建日志写 stderr。

## 文档

- [配置模型与分层组织](docs/configuration.md)
- [Native C Test](docs/jobs/native.md)
- [Kernel/UML C Test](docs/jobs/kernel.md)
- [Linux Driver ABI Test](docs/jobs/driver.md)
- [MCU C Test](docs/jobs/mcu.md)
- [Script System Test](docs/jobs/system.md)
- [C Assertion API](docs/c-assertions.md)
- [CLI、Doctor 与结果](docs/cli.md)
- [Linux Driver Unit 迁移说明](usage/linux-driver/unit.md)

权威参数 Schema 位于 `src/config/schema/*.ts`，构建后保留 JSDoc 生成 `dist/config/schema/*.d.ts`；便携安装中对应 `lib/config/schema/*.d.ts`。

## 开发验证

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e
```

本仓库从 V2 Schema 和便携安装链开始独立演进，不继承 Cautest V1 的 Git 历史。
