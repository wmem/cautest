import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TypeScript 声明保留公共 Schema 和 JSDoc", async () => {
  const [common, kernel] = await Promise.all([
    readFile(new URL("../dist/config/schema/common.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../dist/config/schema/kernel.d.ts", import.meta.url), "utf8"),
  ]);
  assert.match(common, /export interface TestConfigInput/u);
  assert.match(common, /最终 Job 列表/u);
  assert.match(kernel, /export interface UmlKernelEnvironmentInput/u);
  assert.match(kernel, /三个独立指纹边界/u);
});
