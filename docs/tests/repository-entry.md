# 源码检出入口验证

本增量面向直接把源码仓库 clone 到消费工程 `tools/cautest` 的方式。新增根 `cautest.js` 与 `npm run cli`，使用同仓库的编译产物和 C Runtime；不需要先运行安装器创建第二个便携树。

## 已验证

- 已准备 `dist` 的源码目录在其他 cwd 可执行 `--help`、`--version`。
- 将源码布局迁移到含空格、中文的 `tools/cautest`，不复制 `node_modules`，仍可使用 `@cautest/config.js`，真实构建和运行旧 Native C 测试，通过 CTP 获得多个 Case 结果及 JSON/JUnit。
- list 不创建结果或构建目录；结果路径以消费工程配置目录为基准，不落在工具自身目录。
- 缺失 `dist` 的检出返回 2，并提示在工具目录运行 `npm ci` / `npm run prepare`；不自动安装依赖。
- 真实向源码 CLI 进程发送 SIGINT，执行已注册 Cleanup 后退出 130。源码和便携安装共用 `runtime/main.js`，没有另建一套执行器。
- 全新消费项目的离线 npm tarball 安装后，ESM 的 `cautest` 和 `cautest/config.js` 公共导出可用；原 `cautest-install` bin 不变。

独立记录：[源码/安装器/中断验证](evidence/repository-entry-20260923.log)。完整门禁包含 TypeScript 编译、公开类型、C Runtime 与 117/117 Node 测试：[完整结果](evidence/repository-full-20260923.log)。

## 边界

这些验证是 npm/Node 源码入口及旧 JS Native 的验证，不是 Xmake Build Provider。尚未提供 root `xmake.lua`、`ctest.*` DSL 或 `xmake ct` 命令；XT-002 的真实 Xmake PoC 缺少可读取的二进制，G0 未通过。
