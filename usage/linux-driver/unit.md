# Linux Driver Unit Test

新版接口不要求测试作者手写 `Makefile`/Kbuild、Registry、模块入口、`module_init/module_exit`、`MODULE_LICENSE` 或 Cautest Runtime 注册代码。普通 Kernel/Driver 模块单元测试只声明测试源码、产品源码和 Header：

```js
// test/unit/utils/jobs.js
import { jobNamespace } from "@cautest/config.js";
import { kernelUnitJob } from "../../environments/kernel-unit.js";

export default jobNamespace({
  namespace: "unit.utils",
  source: import.meta.url,
  factory: kernelUnitJob,
  definitions: [{
    name: "cm_queue",
    tests: ["test/unit/utils/cm_queue_test.c"],
    sources: ["src/utils/cm_queue.c"],
    headers: ["src/utils/cm_queue.h"],
  }],
});
```

`kernelUnitJob` 在公共环境文件中由 `kernelCTestJobFactory({ environment, defaults })` 创建。新增同类测试只增加一条定义；Job ID 推导为 `unit.utils.cm_queue`，Suite 默认推导为 `cm_queue`，测试选择默认覆盖该 Suite，Header 父目录自动成为 Include 路径。

需要特殊宏、Flag、Suite 或 Module 参数时，在同一个声明中覆盖 `suites` 和 `module`：

```js
{
  name: "cm_queue",
  tests: ["test/unit/utils/cm_queue_test.c"],
  sources: ["src/utils/cm_queue.c"],
  headers: ["src/utils/cm_queue.h"],
  suites: ["queue_fast", "queue_fault"],
  module: {
    defines: { CM_QUEUE_FAULT_INJECTION: 1 },
    cflags: ["-Werror"],
  },
  run: { include: ["queue_fast/*"] },
}
```

公共 Kernel/BusyBox 配置与 Module 宏属于不同缓存边界；修改这里的 `module.defines` 不会重编 Kernel。完整说明见 [Kernel/UML C Test](../../docs/jobs/kernel.md) 和 [配置模型](../../docs/configuration.md)。
