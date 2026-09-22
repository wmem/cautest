import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionsFile = path.join(root, "versions.json");
const versions = JSON.parse(await readFile(versionsFile, "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lockfile = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const cManifest = JSON.parse(await readFile(path.join(root, "assets/cautest-c/package.json"), "utf8"));

function uint(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`versions.json ${label} 必须是非负整数`);
  return value;
}

function pair(value, label) {
  if (typeof value !== "object" || value === null) throw new Error(`versions.json ${label} 必须是对象`);
  uint(value.major, `${label}.major`);
  uint(value.minor, `${label}.minor`);
}

if (typeof versions.release !== "string" || !/^\d+\.\d+\.\d+$/u.test(versions.release)) throw new Error("versions.json release 必须是 SemVer");
for (const name of ["cApi", "ctp", "kernelAbi", "probeAbi"]) pair(versions[name], name);
for (const [name, value] of Object.entries(versions.schemas ?? {})) uint(value, `schemas.${name}`);
for (const [name, value] of Object.entries(versions.caches ?? {})) uint(value, `caches.${name}`);
if (manifest.version !== versions.release) throw new Error(`Release 版本漂移: versions.json=${versions.release}, package.json=${String(manifest.version)}`);
if (lockfile.lockfileVersion !== 3 || lockfile.version !== versions.release || lockfile.packages?.[""]?.version !== versions.release) throw new Error("npm 锁文件版本漂移: package-lock.json");
if (JSON.stringify(lockfile.packages[""].devDependencies) !== JSON.stringify(manifest.devDependencies)) throw new Error("npm 锁文件开发依赖漂移: package-lock.json");
if (cManifest.version !== versions.release) throw new Error(`C Kit 版本漂移: versions.json=${versions.release}, assets/cautest-c/package.json=${String(cManifest.version)}`);
const makefile = await readFile(path.join(root, "assets/cautest-c/Makefile"), "utf8");
if (!makefile.includes(`CAUTEST_C_VERSION := ${versions.release}\n`)) throw new Error(`C Kit Makefile 版本漂移: expected=${versions.release}`);

const ts = `/** 由 versions.json 生成；请运行 \`npm run versions:sync\`，不要手工修改。 */
export const CAUTEST_VERSIONS = Object.freeze({
  release: ${JSON.stringify(versions.release)},
  cApi: ${JSON.stringify(versions.cApi)},
  ctp: ${JSON.stringify(versions.ctp)},
  kernelAbi: ${JSON.stringify(versions.kernelAbi)},
  probeAbi: ${JSON.stringify(versions.probeAbi)},
  schemas: ${JSON.stringify(versions.schemas)},
  caches: ${JSON.stringify(versions.caches)},
} as const);

export const CAUTEST_RELEASE_VERSION = CAUTEST_VERSIONS.release;
export const CAUTEST_CONFIG_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.config;
export const CAUTEST_RESULT_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.result;
export const CAUTEST_EVENT_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.event;
export const CAUTEST_CLI_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.cli;
export const CAUTEST_BUILD_INFO_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.buildInfo;
export const CAUTEST_PORTABLE_MANIFEST_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.portableManifest;
export const CAUTEST_CACHE_VERSIONS = CAUTEST_VERSIONS.caches;
`;

const c = `#ifndef CAUTEST_VERSION_H
#define CAUTEST_VERSION_H

/* 由 versions.json 生成；请运行 \`npm run versions:sync\`，不要手工修改。 */
#define CAUTEST_RELEASE_VERSION ${JSON.stringify(versions.release)}
#define CAUTEST_C_API_MAJOR ${versions.cApi.major}U
#define CAUTEST_C_API_MINOR ${versions.cApi.minor}U
#define CAUTEST_CTP_PROTOCOL_MAJOR ${versions.ctp.major}U
#define CAUTEST_CTP_PROTOCOL_MINOR ${versions.ctp.minor}U
#define CAUTEST_KERNEL_ABI_MAJOR ${versions.kernelAbi.major}U
#define CAUTEST_KERNEL_ABI_MINOR ${versions.kernelAbi.minor}U
#define CAUTEST_KERNEL_ABI_MAGIC ${versions.kernelAbi.magic}
#define CAUTEST_PROBE_ABI_MAJOR ${versions.probeAbi.major}U
#define CAUTEST_PROBE_ABI_MINOR ${versions.probeAbi.minor}U
#define CAUTEST_PROBE_ABI_MAGIC ${versions.probeAbi.magic}

#endif
`;

const generated = [
  [path.join(root, "src/config/versions.ts"), ts],
  [path.join(root, "assets/cautest-c/include/cautest/version.h"), c],
];
const write = process.argv.includes("--write");
for (const [file, expected] of generated) {
  if (write) await writeFile(file, expected);
  else {
    const actual = await readFile(file, "utf8").catch(() => "");
    if (actual !== expected) throw new Error(`版本生成文件漂移: ${path.relative(root, file)}；请运行 npm run versions:sync`);
  }
}
