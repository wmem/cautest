export type CautestErrorCode =
  | "config_error"
  | "selection_error"
  | "timeout_error"
  | "step_error";

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
