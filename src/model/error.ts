export type CautestErrorCode =
  | "config_error"
  | "selection_error"
  | "timeout_error"
  | "step_error"
  | "tooling_error"
  | "build_error"
  | "cache_error"
  | "protocol_error"
  | "target_error"
  | "transport_error"
  | "provision_error"
  | "collect_error"
  | "cleanup_error"
  | "doctor_error";

export interface SerializedError {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly stack?: string;
}

/** 具有稳定机器错误码的 Cautest 错误。 */
export class CautestError extends Error {
  readonly code: CautestErrorCode;
  readonly details?: unknown;

  constructor(message: string, options: { readonly code: CautestErrorCode; readonly cause?: unknown; readonly details?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "CautestError";
    this.code = options.code;
    this.details = options.details;
  }
}

/** 将任意异常转换为可写入 Result 的稳定结构。 */
export function serializeError(value: unknown, fallbackCode: CautestErrorCode = "step_error"): SerializedError {
  const error = value instanceof Error ? value : new Error(String(value));
  const code = error instanceof CautestError ? error.code : fallbackCode;
  return Object.freeze({
    name: error.name,
    code,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  });
}
