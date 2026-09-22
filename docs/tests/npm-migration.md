# npm 迁移验证（2026-09-23）

本次增量基于 `062044d`（Cautest 0.2.1），只修改开发和安装工具链，不升级 Release、C API、CTP、ABI、结果或缓存版本。当前仍为未发布开发增量。

## 已验证

验证环境：Linux x86_64，Node 22.16.0，npm 10.9.2，GCC，未安装 pnpm。没有访问互联网或 npm Registry。

原始源码重新编译 TypeScript 后运行旧默认门禁：C Runtime 通过，Node 102/103 通过；唯一失败是 `npm pack` 的 `prepare` 调用不存在的 pnpm。详见 [原始基线](evidence/xmake-baseline-20260923.log)。

迁移后 `npm test` 包含 105 项 Node 测试、公开类型门禁与 C Runtime 门禁，全部通过；`npm run typecheck` 通过。详见 [完整门禁](evidence/npm-migration-20260923.log)。

[隔离 npm 测试](evidence/npm-isolated-20260923.log) 在全新、含空格和中文的消费项目中，使用空 npm Cache、`npm_config_offline=true`、本地 npm tarball 安装并执行真实 Workflow；确认消费方未安装 TypeScript，再通过 `npm exec --package=<本地包> -- cautest-install` 安装并启动第二个便携目录。

`package-lock.json` 使用 npm lockfileVersion 3，三个依赖的版本和 SHA-512 完整性摘要从原 pnpm 锁文件原样迁入；`npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund` 验证通过。版本同步脚本同时检查 npm 锁文件根版本及开发依赖。

## 验证边界

开发构建复用了上传归档中的依赖文件。没有声称在空缓存下从 npm Registry 执行 `npm ci` 成功；离线 `npm ci` 必须预先缓存所有锁定包。单独的 `npm run test:e2e` 测试固定 Git Commit 的 npx/npm exec 源码安装，可能需要 Registry Cache，本轮未执行该联网相关入口。

xmake 二进制只有文件记录，无法从本轮授权文件接口取得原始字节，且系统未安装 xmake。因此这些 npm 结果不是 Xmake PoC、Native Xmake 构建或完整 G0/G7 的验收证据。
