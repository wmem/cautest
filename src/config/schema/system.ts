import type { TestJobCommonInput, TestJobFactory } from "./common.js";

/** `scriptSystemTestJob()` 的完整参数 Schema。 */
export interface ScriptSystemTestJobInput extends TestJobCommonInput {
  /** Default Export 为 Script Test Definition 的 JS Module。 */
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
