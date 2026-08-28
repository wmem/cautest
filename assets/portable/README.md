# Cautest

该目录由 Cautest Git 安装器生成，可以整体加入目标项目的 `.gitignore`。

```bash
./cautest.js --version
./cautest.js --help
```

项目配置通过稳定逻辑入口导入公共 API：

```js
import { defineStep, testConfig, testJob } from "@cautest/config.js";

const run = defineStep({
  kind: "example",
  phase: "run",
  execute() {},
});

export default testConfig({
  jobs: [testJob({ id: "system.example", level: "system", workflow: [run] })],
});
```

配置必须通过本目录中的 `cautest.js` 加载，不能直接使用 `node` 执行；便携 Loader
负责把 `@cautest/config.js` 定位到本目录中的编译产物。`lib/vendor/picomatch`
是用于文件 Glob 的 MIT 许可运行时依赖，许可证随文件一同发布。

完整文档：

- [`docs/configuration.md`](docs/configuration.md)：配置模型、公共 Factory 和分层片段；
- [`docs/jobs/`](docs/jobs/)：Native、Kernel、Driver、MCU 和 System Job；
- [`docs/c-assertions.md`](docs/c-assertions.md)：C Assertion API；
- [`docs/cli.md`](docs/cli.md)：CLI、Doctor、实时进度和结果目录；
- [`usage/linux-driver/unit.md`](usage/linux-driver/unit.md)：Linux Driver Unit 写法。

函数参数的权威类型与注释位于 `lib/config/schema/*.d.ts`。项目可以在
`jsconfig.json` 中把 `@cautest/config.js` 映射到 `lib/config/index.d.ts`，从而在
JavaScript 配置中获得补全和类型检查。
