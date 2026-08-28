# Native C Test

最小声明只需要 Job ID 和测试源码：

```js
nativeCTestJob({
  id: "unit.math",
  tests: ["test/unit/math_test.c"],
});
```

产品源码、Header、宏、Compiler、Flag、选择规则和 GCOV 都可以覆盖：

```js
nativeCTestJob({
  id: "unit.utils.queue",
  tests: ["test/unit/utils/*_test.c", "!test/unit/utils/slow_*"],
  sources: ["src/utils/cm_queue.c"],
  headers: ["src/utils/cm_queue.h"],
  suites: ["cm_queue"],
  build: {
    compiler: "clang",
    defines: { UNIT_TEST: 1 },
    cflags: ["-Werror"],
    cache: { fingerprintEnv: ["CCACHE_DIR"] },
  },
  run: { include: ["cm_queue/*"], caseTimeoutMs: 1000 },
  coverage: { tool: "gcov" },
});
```

调用链：`nativeCTestJob` → `nativeCompile`（生成 Registry/入口、指纹、编译和 Cache Manifest）→ `cTestRun`（FD3/FD4 CTP3）→ 可选 `nativeCoverage`。结构化结果保留 Suite、Case、Assertion 的 expected/actual。

权威 Schema：`NativeCTestJobInput`、`NativeCBuildInput`、`NativeCoverageInput`，见源码 `src/config/schema/native.ts` 或安装后的 `lib/config/schema/native.d.ts`。
