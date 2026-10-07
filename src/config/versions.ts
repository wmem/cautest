/** 由 versions.json 生成；请运行 `npm run versions:sync`，不要手工修改。 */
export const CAUTEST_VERSIONS = Object.freeze({
  release: "0.6.1",
  cApi: {"major":2,"minor":2},
  ctp: {"major":3,"minor":1},
  kernelAbi: {"major":3,"minor":0,"magic":"0xca7e57U"},
  probeAbi: {"major":1,"minor":0,"magic":"0xca7e50U"},
  schemas: {"config":2,"result":1,"event":1,"cli":1,"buildInfo":1,"portableManifest":1,"cacheManifest":2,"fingerprint":2,"xmakeManifest":4,"artifactReceipt":2,"kernelContext":2},
  caches: {"nativeFingerprint":2,"nativeManifest":3,"kernelFingerprint":6,"busyboxFingerprint":5,"mcuFingerprint":2,"moduleFingerprint":3,"moduleManifest":5,"agentFingerprint":3,"guestFingerprint":5,"rootfsFingerprint":5,"umlManifest":2},
} as const);

export const CAUTEST_RELEASE_VERSION = CAUTEST_VERSIONS.release;
export const CAUTEST_CONFIG_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.config;
export const CAUTEST_RESULT_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.result;
export const CAUTEST_EVENT_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.event;
export const CAUTEST_CLI_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.cli;
export const CAUTEST_BUILD_INFO_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.buildInfo;
export const CAUTEST_PORTABLE_MANIFEST_SCHEMA_VERSION = CAUTEST_VERSIONS.schemas.portableManifest;
export const CAUTEST_CACHE_VERSIONS = CAUTEST_VERSIONS.caches;
