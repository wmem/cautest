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
import type { KernelModuleInput, UmlKernelEnvironment } from "./kernel.js";

/** Driver ABI Guest C Test 的构建参数。 */
export interface DriverGuestCTestInput {
  /** Guest Test C 源码；Cautest 自动生成 Registry 和入口。 */
  readonly tests: NonEmptyReadonlyArray<FilePattern>;

  /** Guest Test 依赖的产品/辅助源码。 */
  readonly sources?: readonly FilePattern[];

  /** 自动进入指纹和 Doctor 检查的 Header。 */
  readonly headers?: readonly FilePattern[];

  /** 自动登记的 Suite；省略时由 Job ID 最后一段推导。 */
  readonly suites?: readonly string[];

  readonly includeDirs?: readonly DirectoryPath[];
  readonly defines?: CDefines;
  readonly cflags?: readonly string[];
  readonly ldflags?: readonly string[];
  readonly compiler?: string;

  /** 是否静态链接 Guest Program。@defaultValue true */
  readonly static?: boolean;

  /** Guest Program Artifact 名称；省略时由 Job ID 生成。 */
  readonly name?: string;

  /** Guest Program Endpoint；省略时由 Artifact 名称生成。 */
  readonly endpoint?: string;

  /** Guest Program Build Step 超时，单位毫秒。 */
  readonly timeoutMs?: number;

  readonly cache?: BuildCacheInput;
}

/** Cautest Test-only Driver Probe 配置。 */
export interface DriverProbeInput {
  /** Target Driver 必须报告的 Build ID。 */
  readonly expectedBuildId?: string;

  /** 追加到 Driver Module Make 的变量。 */
  readonly makeVariables?: Readonly<Record<string, string | number | boolean>>;
}

/** `driverAbiCTestJob()` 的完整参数 Schema。 */
export interface DriverAbiCTestJobInput extends TestJobCommonInput {
  /** 与 Kernel C Test 共享的 UML 环境。 */
  readonly environment: UmlKernelEnvironment;

  /** 被测 Driver Module，至少一个；不接受字符串简写。 */
  readonly drivers: NonEmptyReadonlyArray<KernelModuleInput>;

  /** 在 UML Guest Userspace 执行的 C Test。 */
  readonly guest: DriverGuestCTestInput;

  /** Test-only Probe 和 Build ID 约束。 */
  readonly probe?: DriverProbeInput;

  /** Guest C Test 的选择、策略和超时。 */
  readonly run?: CTestRunInput;
}

/** `driverAbiCTestJob()` 的函数类型。 */
export type DriverAbiCTestJobConstructor = TestJobFactory<DriverAbiCTestJobInput>;

/** `driverAbiCTestJobFactory()` 的参数 Schema。 */
export interface DriverAbiCTestJobFactoryInput {
  readonly environment: UmlKernelEnvironment;
  readonly defaults?: Omit<Partial<DriverAbiCTestJobInput>, "id" | "environment" | "drivers" | "guest">;
}

/** `driverAbiCTestJobFactory()` 的返回类型。 */
export type DriverAbiCTestJobFactory = (
  input: Omit<DriverAbiCTestJobInput, "environment">,
) => TestJob;
