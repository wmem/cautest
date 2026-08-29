# 已安装的 Cautest

这是由 Cautest 安装器或便携包生成的自包含目录。请从[使用指南](index.md)选择测试类型，或直接进入 `examples/` 运行对应示例。

在本目录检查便携包本身：

```bash
./cautest.js --version
./cautest.js --help
```

接入项目时返回项目根目录，并按实际安装位置定义命令；以下是推荐目录 `./tools/cautest`：

```bash
CAUTEST=./tools/cautest/cautest.js
"$CAUTEST" doctor
```

项目配置必须通过这个便携目录中的 `cautest.js` 加载，并统一从 `@cautest/config.js` 导入配置 API。`lib/` 保存运行所需 JavaScript 和该公开入口可达的 `.d.ts`，内部目录结构不是导入接口；精确类型从 `lib/config/index.d.ts` 和 `lib/config/schema/*.d.ts` 查询。`assets/cautest-c/` 提供 C Runtime 和公共头文件。
