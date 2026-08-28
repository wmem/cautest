import type { JobNamespaceInput, NamedJobDefinition, TestJob } from "./schema/common.js";
import { CautestError } from "../model/error.js";
import { setJobOrigin } from "./provenance.js";
import { isTestJob } from "./define.js";

const namespacePattern = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/u;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/**
 * 把同一 Schema 的扁平声明批量展开为普通 Test Job。返回值可以直接在
 * `testConfig({ jobs: [...] })` 中展开，不会引入第二种 Group/Job 节点。
 */
export function jobNamespace<TDefinition extends NamedJobDefinition>(
  input: JobNamespaceInput<TDefinition>,
): readonly TestJob[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CautestError("jobNamespace() 参数必须是对象", { code: "config_error" });
  }
  const unknown = Object.keys(input).filter((key) => !["namespace", "source", "factory", "definitions"].includes(key));
  if (unknown.length > 0) throw new CautestError(`jobNamespace() 包含未知字段: ${unknown.join(", ")}`, { code: "config_error" });
  if (typeof input.namespace !== "string" || !namespacePattern.test(input.namespace)) {
    throw new CautestError("jobNamespace.namespace 必须是点分隔的安全标识符", { code: "config_error" });
  }
  if (typeof input.factory !== "function") throw new CautestError("jobNamespace.factory 必须是函数", { code: "config_error" });
  if (!Array.isArray(input.definitions)) throw new CautestError("jobNamespace.definitions 必须是数组", { code: "config_error" });
  const names = new Set<string>();
  return Object.freeze(input.definitions.map((definition, index) => {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new CautestError(`jobNamespace.definitions[${index}] 必须是对象`, { code: "config_error" });
    }
    if (typeof definition.name !== "string" || !namePattern.test(definition.name)) {
      throw new CautestError(`jobNamespace.definitions[${index}].name 必须是安全短名称`, { code: "config_error" });
    }
    if (names.has(definition.name)) {
      throw new CautestError(`jobNamespace 定义名称重复: ${input.namespace}.${definition.name}`, { code: "config_error" });
    }
    names.add(definition.name);
    if ("id" in definition) throw new CautestError(`definitions[${index}] 不能显式设置 id`, { code: "config_error" });
    const { name: _name, ...fields } = definition;
    const id = `${input.namespace}.${definition.name}`;
    let job: TestJob;
    try {
      job = input.factory({ ...fields, id } as Omit<TDefinition, "name"> & { readonly id: string });
    } catch (cause) {
      throw new CautestError(`配置 jobs.${id} 无效: ${cause instanceof Error ? cause.message : String(cause)}`, {
        code: "config_error",
        cause,
      });
    }
    if (!isTestJob(job)) throw new CautestError(`jobs.${id} 的工厂没有返回 TestJob`, { code: "config_error" });
    if (job.id !== id) throw new CautestError(`jobs.${id} 的工厂返回了错误 ID: ${job.id}`, { code: "config_error" });
    setJobOrigin(job, { source: input.source, configPath: `jobs.${id}` });
    return job;
  }));
}
