import type { EnvironmentVariables, StepExecutionContext } from "../config/schema/common.js";

/** 进程环境优先级：Host < Job（已合并 Profile）< 当前 Step 专属环境。 */
export function effectiveEnvironment(context: Pick<StepExecutionContext, "job">, local?: EnvironmentVariables): NodeJS.ProcessEnv {
  return { ...process.env, ...context.job.env, ...local };
}

/** 仅保留声明式环境，供构建指纹使用，避免把不相关的 Host 环境全部纳入 Cache Key。 */
export function declaredEnvironment(context: Pick<StepExecutionContext, "job">, local?: EnvironmentVariables): Readonly<Record<string, unknown>> {
  return Object.freeze({ job: context.job.env, local: local ?? {} });
}
