# Cautest

该目录由 Cautest Git 安装器生成，可以整体加入目标项目的 `.gitignore`。

```bash
./cautest.js --version
./cautest.js --help
```

项目配置通过稳定逻辑入口导入公共 API：

```js
import { defineStep, testConfig, testJob } from "@cautest/config";

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
负责把 `@cautest/config` 定位到本目录中的编译产物。
