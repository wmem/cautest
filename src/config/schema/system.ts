import type { TestJobCommonInput, TestJobFactory } from "./common.js";

/** Script System Test 单个 Case。抛出异常表示 ERROR。 */
export interface ScriptSystemTestCase {
  readonly name: string;
  readonly run: (context: { readonly signal: AbortSignal; readonly env: Readonly<Record<string, string>> }) => void | Promise<void>;
}

/** Script Test Module 的 Default Export Schema。 */
export interface ScriptSystemTestDefinition {
  readonly cases: readonly ScriptSystemTestCase[];
}

/** `scriptSystemTestJob()` 的完整参数 Schema。 */
export interface ScriptSystemTestJobInput extends TestJobCommonInput {
  /** Default Export 为 `defineScriptTest()` 结果或静态 `cases[]` 的 JS Module。 */
  readonly file: string;

  /** Result Group 和 Run Step 名称；省略时由文件名推导。 */
  readonly name?: string;

  /** 单个 Script Case 超时，单位毫秒。 */
  readonly caseTimeoutMs?: number;

  /** Script Run Step 超时，单位毫秒。 */
  readonly stepTimeoutMs?: number;
}

/** `scriptSystemTestJob()` 的函数类型。 */
export type ScriptSystemTestJobConstructor = TestJobFactory<ScriptSystemTestJobInput>;
