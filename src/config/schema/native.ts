import type {
  BuildCacheInput,
  CDefines,
  CTestRunInput,
  DirectoryPath,
  FilePattern,
  NonEmptyReadonlyArray,
  TestJob,
  TestJobCommonInput,
  TestJobFactory,
} from "./common.js";

/** Native C Compiler、参数和缓存配置。 */
export interface NativeCBuildInput {
  /** C Compiler 命令。@defaultValue "cc" */
  readonly compiler?: string;

  /** 显式 Include 目录；`headers` 的父目录会在此基础上自动追加。 */
  readonly includeDirs?: readonly DirectoryPath[];

  /** 传给 C Compiler 的预处理宏。 */
  readonly defines?: CDefines;

  /** 额外编译参数。 */
  readonly cflags?: readonly string[];

  /** 额外链接参数。 */
  readonly ldflags?: readonly string[];

  /** C Runtime Workspace 大小，单位字节。@defaultValue 65536 */
  readonly workspaceSize?: number;

  /** Registry 和入口源码生成目录。 */
  readonly generatedDir?: DirectoryPath;

  /** Compile Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** 构建缓存策略。 */
  readonly cache?: BuildCacheInput;
}

/** Native GCOV 覆盖率收集参数。 */
export interface NativeCoverageInput {
  /** Host GCOV 命令。@defaultValue "gcov" */
  readonly tool?: string;

  /** Coverage Collect Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;
}

/** `nativeCTestJob()` 的完整参数 Schema。 */
export interface NativeCTestJobInput extends TestJobCommonInput {
  /**
   * 测试 C 源码；支持具体路径和 Glob，至少匹配一个文件。
   *
   * @example ["test/unit/utils/cm_queue_test.c"]
   */
  readonly tests: NonEmptyReadonlyArray<FilePattern>;

  /** 被测产品源码；支持具体路径和 Glob。 */
  readonly sources?: readonly FilePattern[];

  /**
   * 直接或间接参与编译的 Header。
   *
   * Header 自动进入构建指纹和 Doctor 检查，其父目录自动追加到 Include 路径。
   */
  readonly headers?: readonly FilePattern[];

  /**
   * 需要生成 Registry 的 Suite C 标识符。
   *
   * 省略时，从 Job ID 最后一段推导一个 Suite。
   */
  readonly suites?: readonly string[];

  /** Artifact/Step 名称；省略时由 Job ID 生成安全名称。 */
  readonly artifactName?: string;

  /** Native 编译配置。 */
  readonly build?: NativeCBuildInput;

  /** Case 选择、Session 策略和超时。 */
  readonly run?: CTestRunInput;

  /** 提供该对象时启用 Native GCOV。 */
  readonly coverage?: NativeCoverageInput;
}

/** `nativeCTestJob()` 的函数类型。 */
export type NativeCTestJobConstructor = TestJobFactory<NativeCTestJobInput>;

/** Native Job Factory 可复用的默认参数；具体 Job 的同名配置优先。 */
export type NativeCTestJobDefaults = Omit<Partial<NativeCTestJobInput>, "id" | "tests">;

/** `nativeCTestJobFactory()` 的参数 Schema。 */
export interface NativeCTestJobFactoryInput {
  readonly defaults?: NativeCTestJobDefaults;
}

/** `nativeCTestJobFactory()` 的返回类型。 */
export type NativeCTestJobFactory = (input: NativeCTestJobInput) => TestJob;
