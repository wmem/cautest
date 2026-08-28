import type {
  CTestRunInput,
  CommandInput,
  DirectoryPath,
  EnvironmentVariables,
  FilePattern,
  NonEmptyReadonlyArray,
  TestJobCommonInput,
  TestJobFactory,
} from "./common.js";

/** 使用已经存在的 Firmware 文件。 */
export interface ExistingFirmwareInput {
  readonly kind: "existing";
  readonly file: string;
  readonly fingerprintInputs?: Readonly<Record<string, unknown>>;
}

/** 使用 Cautest 内置 Host Freestanding 模拟构建。 */
export interface HostSimulatedFirmwareInput {
  readonly kind: "host-simulated";
  readonly output: string;
  readonly sources: NonEmptyReadonlyArray<FilePattern>;
  readonly headers?: readonly FilePattern[];
  readonly compiler?: string;
  readonly cflags?: readonly string[];
  readonly env?: EnvironmentVariables;
  readonly timeoutMs?: number;
}

/** 使用外部命令构建 Firmware。 */
export interface CommandFirmwareInput extends CommandInput {
  readonly kind: "command";
  readonly output: string;
  readonly fingerprintInputs?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

/**
 * Firmware 输入始终是带 `kind` 的对象；不会根据字符串或对象形状隐式猜测。
 */
export type McuFirmwareInput = ExistingFirmwareInput | HostSimulatedFirmwareInput | CommandFirmwareInput;

/** 使用 Cautest 内置 Host Process 模拟 Board。 */
export interface SimulatedMcuBoardInput {
  readonly kind: "simulated";
  /** Event Stream 每次喂给 Decoder 的最大字节数。@defaultValue 7 */
  readonly maxReadSize?: number;
  /** Command Stream 单次写入 Target 的最大字节数。@defaultValue 5 */
  readonly maxWriteSize?: number;
  /** 第一个 Transport 读取超过指定 Chunk 数后模拟一次断线。 */
  readonly disconnectOnce?: number;
  /** 第一次写命令时先注入一份损坏 Frame。@defaultValue false */
  readonly corruptWriteOnce?: boolean;
}

/** 外部 Board Adapter 必须实现的最小接口。 */
export interface McuCtpTransport {
  open?(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): void | Promise<void>;
  write(data: string): void | Promise<void>;
  nextLine(options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): string | Promise<string>;
  close?(): void | Promise<void>;
}

export interface McuBoardAdapter {
  flash(firmware: { readonly path: string; readonly buildId: string }): void | Promise<void>;
  reset(): string | Promise<string>;
  openTransport(options?: Readonly<Record<string, unknown>>): McuCtpTransport | Promise<McuCtpTransport>;
  close?(): void | Promise<void>;
}

/** 使用项目提供的外部 Board Adapter。 */
export interface ExternalMcuBoardInput {
  readonly kind: "external";
  readonly adapter: McuBoardAdapter;
  readonly ownership?: "owned" | "borrowed";
}

/** Board 输入始终是带 `kind` 的对象。 */
export type McuBoardInput = SimulatedMcuBoardInput | ExternalMcuBoardInput;

/** MCU 串口 Adapter 的运行参数。 */
export interface McuSerialInput {
  readonly cwd?: DirectoryPath;
  readonly env?: EnvironmentVariables;
  readonly options?: Readonly<Record<string, unknown>>;
}

/** `mcuCTestJob()` 的完整参数 Schema。 */
export interface McuCTestJobInput extends TestJobCommonInput {
  /** Firmware 来源和构建方式。 */
  readonly firmware: McuFirmwareInput;

  /** Board Adapter；省略时使用无故障注入的内置模拟 Board。 */
  readonly board?: McuBoardInput;

  /** Firmware Artifact 名称。@defaultValue "firmware" */
  readonly firmwareName?: string;

  /** Board Resource 名称。@defaultValue "board" */
  readonly boardName?: string;

  /** Case 选择、Session 策略和超时。 */
  readonly run?: CTestRunInput;

  /** Transport/Session 失败后的最大重连次数。@defaultValue 0 */
  readonly reconnects?: number;

  /** 是否把 timeout_error 视为可重连错误。@defaultValue false */
  readonly recoverTimeouts?: boolean;

  /** 串口或模拟进程参数。 */
  readonly serial?: McuSerialInput;

  /** Collect 阶段额外发布的日志文件。 */
  readonly logFiles?: readonly FilePattern[];
}

/** `mcuCTestJob()` 的函数类型。 */
export type McuCTestJobConstructor = TestJobFactory<McuCTestJobInput>;
