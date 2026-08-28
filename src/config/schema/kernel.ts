import type {
  BuildCacheInput,
  CDefines,
  CommandInput,
  CTestRunInput,
  DirectoryPath,
  EnvironmentVariables,
  FilePattern,
  NonEmptyReadonlyArray,
  TestJob,
  TestJobCommonInput,
  TestJobFactory,
} from "./common.js";

/** Linux Kernel 源码和 Kbuild 配置。此对象只决定 Kernel Artifact。 */
export interface LinuxKernelBuildInput {
  /** Linux Kernel 源码目录。 */
  readonly sourceDir: DirectoryPath;

  /** 项目需要追加的 Kconfig Fragment。 */
  readonly configFragments?: readonly FilePattern[];

  /** Kernel ARCH。UML 环境默认使用 `um`。@defaultValue "um" */
  readonly arch?: string;

  /** Cross Compiler 前缀，例如 `aarch64-linux-gnu-`。 */
  readonly crossCompile?: string;

  /** Make 命令。@defaultValue "make" */
  readonly make?: string;

  /** Defconfig Target。@defaultValue "x86_64_defconfig" */
  readonly configTarget?: string;

  /** Kernel Build Target。@defaultValue "linux" */
  readonly target?: string;

  /** 是否准备外部 Module 所需的 Symbols。@defaultValue true */
  readonly prepareModules?: boolean;

  /** Make 并行度。@defaultValue 4 */
  readonly jobs?: number;

  /** 追加到 Make 命令的参数。 */
  readonly makeArgs?: readonly string[];

  /** 仅注入 Kernel Build 的环境变量。 */
  readonly env?: EnvironmentVariables;

  /** Kernel Build Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** Kernel Artifact 缓存策略。 */
  readonly cache?: BuildCacheInput;
}

/** BusyBox 源码和构建配置。此对象只决定 BusyBox Artifact。 */
export interface BusyBoxBuildInput {
  /** BusyBox 源码目录。 */
  readonly sourceDir: DirectoryPath;

  /** 项目需要追加的 BusyBox Config Fragment。 */
  readonly configFragments?: readonly FilePattern[];

  /** 是否静态链接。@defaultValue true */
  readonly static?: boolean;

  /** Make 命令。@defaultValue "make" */
  readonly make?: string;

  /** Make 并行度。@defaultValue 4 */
  readonly jobs?: number;

  /** 追加到 Make 命令的参数。 */
  readonly makeArgs?: readonly string[];

  /** 仅注入 BusyBox Build 的环境变量。 */
  readonly env?: EnvironmentVariables;

  /** BusyBox Build Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** BusyBox Artifact 缓存策略。 */
  readonly cache?: BuildCacheInput;
}

/** 所有 Kernel Module 共用、但不影响 Kernel/BusyBox Artifact 的默认值。 */
export interface KernelModuleDefaultsInput {
  /** 自动进入指纹，并自动推导 Include 目录的公共 Header。 */
  readonly headers?: readonly FilePattern[];

  /** 所有自动生成 Test Module 共用的 Include 目录。 */
  readonly includeDirs?: readonly DirectoryPath[];

  /** 所有自动生成 Test Module 共用的宏。具体 Job 的同名宏优先。 */
  readonly defines?: CDefines;

  /** 所有自动生成 Test Module 共用的额外 C Flag。 */
  readonly cflags?: readonly string[];

  /** Module Make 默认命令。@defaultValue "make" */
  readonly make?: string;

  /** Module Make 默认并行度。@defaultValue 4 */
  readonly jobs?: number;

  /** Module Build 默认超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** Module Artifact 默认缓存策略。 */
  readonly cache?: BuildCacheInput;
}

/** Cautest Kernel Runtime 的容量配置。 */
export interface KernelRuntimeInput {
  /** Registry 最大数量。@defaultValue 16 */
  readonly maxRegistries?: number;

  /** Event Queue 容量。@defaultValue 128 */
  readonly eventCapacity?: number;

  /** Runtime Workspace 大小，单位字节。@defaultValue 16384 */
  readonly workspaceSize?: number;
}

/** UML 虚拟机启动参数。 */
export interface UmlMachineInput {
  /** UML Guest 内存，例如 `256M`。 */
  readonly memory?: string;

  /** 追加到 Kernel Command Line 的参数。 */
  readonly kernelArgs?: readonly string[];

  /** 等待 Guest Ready 的超时，单位毫秒。 */
  readonly readyTimeoutMs?: number;

  /** UML Start Step 总超时，单位毫秒。 */
  readonly startTimeoutMs?: number;

  /** Console/日志收集超时，单位毫秒。 */
  readonly collectTimeoutMs?: number;
}

/** UML Rootfs 的公共配置。 */
export interface UmlRootfsInput {
  /** 按顺序覆盖到 Rootfs 的目录。 */
  readonly overlays?: readonly DirectoryPath[];

  /** CPIO 命令。@defaultValue "cpio" */
  readonly cpio?: string;

  /** Rootfs Build Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  /** Rootfs Artifact 缓存策略。 */
  readonly cache?: BuildCacheInput;
}

/**
 * `umlKernelEnvironment()` 的参数 Schema。
 *
 * `kernel`、`busybox`、`moduleDefaults` 是三个独立指纹边界。修改 Module 的
 * Header、Define 或 C Flag 不会导致 Kernel 或 BusyBox 重新构建。
 */
export interface UmlKernelEnvironmentInput {
  readonly kernel: LinuxKernelBuildInput;
  readonly busybox: BusyBoxBuildInput;
  readonly moduleDefaults?: KernelModuleDefaultsInput;
  readonly runtime?: KernelRuntimeInput;
  readonly rootfs?: UmlRootfsInput;
  readonly machine?: UmlMachineInput;
}

declare const UML_KERNEL_ENVIRONMENT_TYPE: unique symbol;

/** 由 `umlKernelEnvironment()` 创建并可在多个 Job 之间复用的环境。 */
export interface UmlKernelEnvironment {
  readonly [UML_KERNEL_ENVIRONMENT_TYPE]: true;
}

/** 已有 Kbuild Module 的完整声明，不接受字符串简写。 */
export interface KernelModuleInput {
  /** Artifact 名称，也是 `extraModules` 使用的依赖名称。 */
  readonly name: string;

  /** 包含 Kbuild/Makefile 的 Module 源码目录。 */
  readonly sourceDir: DirectoryPath;

  /** 相对于 Module 构建目录的 `.ko` 输出路径。 */
  readonly output: string;

  /** 包含 Module 及其相对产品源码的最小 Sandbox 根目录。 */
  readonly sandboxRoot?: DirectoryPath;

  /** Sandbox 外额外进入指纹的文件或 Glob。 */
  readonly inputs?: readonly FilePattern[];

  /** Sandbox 外额外递归进入指纹的目录。 */
  readonly inputRoots?: readonly DirectoryPath[];

  /** 外部 `Module.symvers` 文件。 */
  readonly extraSymbols?: readonly FilePattern[];

  /** 当前 Workflow 中先构建的 Module Artifact 名称。 */
  readonly extraModules?: readonly string[];

  /** Make 变量；值会转换为 `NAME=value`。 */
  readonly makeVariables?: Readonly<Record<string, string | number | boolean>>;

  /** 无法用 `makeVariables` 表达时使用的原始 Make 参数。 */
  readonly makeArgs?: readonly string[];

  readonly make?: string;
  readonly jobs?: number;
  readonly timeoutMs?: number;
  readonly cache?: BuildCacheInput;
}

/** 放入 UML Rootfs 的额外 Guest Program。 */
export interface UmlGuestProgramInput {
  readonly name: string;
  readonly sources: NonEmptyReadonlyArray<FilePattern>;
  readonly headers?: readonly FilePattern[];
  readonly includeDirs?: readonly DirectoryPath[];
  readonly defines?: CDefines;
  readonly cflags?: readonly string[];
  readonly ldflags?: readonly string[];
  readonly compiler?: string;
  readonly static?: boolean;
  readonly endpoint?: string;
  readonly installPath?: string;
  readonly timeoutMs?: number;
  readonly cache?: BuildCacheInput;
}

/** 自动生成 Kernel Test Module 的 Module 级覆盖项。 */
export interface GeneratedKernelTestModuleInput {
  /** Module Artifact 名称；省略时由 Job ID 生成。 */
  readonly name?: string;

  /** Module License。@defaultValue "GPL" */
  readonly license?: string;

  /** Module Description。 */
  readonly description?: string;

  /** 当前 Test Module 追加的 Include 目录。 */
  readonly includeDirs?: readonly DirectoryPath[];

  /** 当前 Test Module 追加或覆盖的宏。 */
  readonly defines?: CDefines;

  /** 当前 Test Module 追加的 C Flag。 */
  readonly cflags?: readonly string[];

  /** 当前 Module 的 Make 变量。 */
  readonly makeVariables?: Readonly<Record<string, string | number | boolean>>;

  readonly makeArgs?: readonly string[];
  readonly jobs?: number;
  readonly timeoutMs?: number;
  readonly cache?: BuildCacheInput;
}

/** UML Kernel GCOV 配置。 */
export interface KernelCoverageInput {
  /** Host GCOV 命令。@defaultValue "gcov" */
  readonly tool?: string;

  /** Coverage Collect Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;
}

/** `kernelCTestJob()` 的完整参数 Schema。 */
export interface KernelCTestJobInput extends TestJobCommonInput {
  /** 复用的 Kernel、BusyBox、Rootfs 和 UML 环境。 */
  readonly environment: UmlKernelEnvironment;

  /** Kernel Test C 源码；支持路径和 Glob，至少匹配一个文件。 */
  readonly tests: NonEmptyReadonlyArray<FilePattern>;

  /** 被测 Kernel/Driver 产品源码；编入自动生成的 Test Module。 */
  readonly sources?: readonly FilePattern[];

  /** 自动进入 Module 指纹和 Doctor 检查的 Header。 */
  readonly headers?: readonly FilePattern[];

  /** 自动登记的 Suite；省略时由 Job ID 最后一段推导。 */
  readonly suites?: readonly string[];

  /** 自动生成 Test Module 的覆盖项。 */
  readonly module?: GeneratedKernelTestModuleInput;

  /** Test Module 之外还需要构建并装载的 Kernel Module。 */
  readonly extraModules?: readonly KernelModuleInput[];

  /** 放入 Rootfs 的额外 Guest Program。 */
  readonly guestPrograms?: readonly UmlGuestProgramInput[];

  /** Case 选择、Session 策略和超时。 */
  readonly run?: CTestRunInput;

  /** 提供该对象时启用 UML Kernel GCOV。 */
  readonly coverage?: KernelCoverageInput;
}

/** `kernelCTestJob()` 的函数类型。 */
export type KernelCTestJobConstructor = TestJobFactory<KernelCTestJobInput>;

/** `kernelCTestJobFactory()` 的参数 Schema。 */
export interface KernelCTestJobFactoryInput {
  readonly environment: UmlKernelEnvironment;

  /**
   * 所有具体 Job 共用的默认值。文件集合和 Flag 依次拼接并去重，宏浅合并，
   * 其他字段由具体 Job 覆盖。
   */
  readonly defaults?: Omit<Partial<KernelCTestJobInput>, "id" | "environment" | "tests">;
}

/** `kernelCTestJobFactory()` 的返回类型。 */
export type KernelCTestJobFactory = (
  input: Omit<KernelCTestJobInput, "environment">,
) => TestJob;

/** 自定义环境准备命令的预留 Schema；标准环境通常不需要。 */
export interface KernelEnvironmentHookInput extends CommandInput {
  readonly phase: "before-build" | "after-build";
}
