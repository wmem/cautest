import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CautestError } from "../model/error.js";

const packageRoot = fileURLToPath(new URL("../../assets/cautest-c", import.meta.url));
const platformMap = Object.freeze({
  common: ["core/cautest.c", "protocol/ctp3.c"],
  posix: ["platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c"],
  "linux-kernel": ["target/linux-kernel/runtime.c", "kernel/cautest-kernel"],
  freestanding: ["platform/freestanding/cautest_freestanding.c", "target/mcu-reference/mcu_reference.c"],
  mcu: ["target/mcu/mcu.c"],
});

export type CautestCPlatform = keyof typeof platformMap;

/** 返回只读 C Kit 入口，供自定义 Managed Build 定位同版本资产。 */
export function resolveCautestC(options: { readonly platform?: CautestCPlatform } = {}) {
  const platform = options.platform ?? "common";
  if (!(platform in platformMap)) throw new CautestError(`未知 Cautest C Platform: ${String(platform)}`, { code: "config_error" });
  const includeDir = path.join(packageRoot, "include");
  const sources = [...platformMap.common, ...(platform === "common" ? [] : platformMap[platform])].map((item) => path.join(packageRoot, item));
  if (!existsSync(path.join(includeDir, "cautest/cautest.h")) || sources.some((source) => !existsSync(source))) throw new CautestError("Cautest C Kit 不完整", { code: "tooling_error" });
  return Object.freeze({ packageRoot, includeDir, platform, sources: Object.freeze(sources) });
}
