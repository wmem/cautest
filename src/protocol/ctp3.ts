import { CautestError } from "../model/error.js";

export const CTP_PROTOCOL_MAJOR = 3;
export const CTP_PROTOCOL_MINOR = 1;
export const TARGET_RX_LINE_MAX = 64;
export const TARGET_TX_LINE_MAX = 512;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class Ctp3Error extends Error {
  readonly code: "BAD_ARGUMENT" | "LINE_TOO_LONG" | "BAD_ENCODING" | "SYNTAX";
  readonly details?: unknown;

  constructor(code: Ctp3Error["code"], message: string, details?: unknown) {
    super(message);
    this.name = "Ctp3Error";
    this.code = code;
    this.details = details;
  }
}

export interface ParsedProtocolLine {
  readonly kind: "data" | "ok" | "error";
  readonly name: string;
  readonly fields: readonly string[];
  readonly raw: string;
}

export function encodeCommand(command: string): Uint8Array {
  if (typeof command !== "string" || command.length === 0 || /[\r\n\0]/u.test(command)) {
    throw new Ctp3Error("BAD_ARGUMENT", "CTP3 Command 必须是单行非空字符串");
  }
  const bytes = encoder.encode(`${command}\n`);
  if (bytes.length > TARGET_RX_LINE_MAX) throw new Ctp3Error("LINE_TOO_LONG", `CTP3 Command 超过 ${TARGET_RX_LINE_MAX} B`);
  return bytes;
}

export function escapeField(value = ""): string {
  if (typeof value !== "string") throw new Ctp3Error("BAD_ARGUMENT", "CTP3 字段必须是字符串");
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === "\\") output += "\\\\";
    else if (character === ",") output += "\\,";
    else if (character === "\n") output += "\\n";
    else if (character === "\r") output += "\\r";
    else if (code < 0x20 || code === 0x7f) output += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
    else output += character;
  }
  return output;
}

export function splitEscapedFields(value: string): readonly string[] {
  const fields: string[] = [];
  let field = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === ",") { fields.push(field); field = ""; continue; }
    if (character !== "\\") {
      if (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) throw new Ctp3Error("BAD_ENCODING", "CTP3 字段包含未转义控制字符");
      field += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === "\\" || escaped === ",") field += escaped;
    else if (escaped === "n") field += "\n";
    else if (escaped === "r") field += "\r";
    else if (escaped === "x" && /^[0-9A-F]{2}$/u.test(value.slice(index + 1, index + 3))) {
      field += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else throw new Ctp3Error("BAD_ENCODING", "CTP3 字段包含无效转义");
  }
  fields.push(field);
  return Object.freeze(fields);
}

export function parseProtocolLine(line: string): ParsedProtocolLine {
  if (typeof line !== "string" || line.length === 0) throw new Ctp3Error("SYNTAX", "CTP3 响应行为空");
  if (line.startsWith("OK:")) {
    const fields = splitEscapedFields(line.slice(3));
    return Object.freeze({ kind: "ok", name: fields[0] ?? "", fields: Object.freeze(fields.slice(1)), raw: line });
  }
  if (line.startsWith("ERROR:")) {
    const fields = splitEscapedFields(line.slice(6));
    return Object.freeze({ kind: "error", name: fields[0] ?? "", fields: Object.freeze(fields.slice(1)), raw: line });
  }
  if (line.startsWith("+")) {
    const separator = line.indexOf(":");
    if (separator < 2) throw new Ctp3Error("SYNTAX", `无效 CTP3 Data Line: ${line}`);
    return Object.freeze({ kind: "data", name: line.slice(1, separator), fields: splitEscapedFields(line.slice(separator + 1)), raw: line });
  }
  throw new Ctp3Error("SYNTAX", `未知 CTP3 Line: ${line}`);
}

export class LineDecoder {
  readonly maxLine: number;
  #buffer: number[] = [];
  #discarding = false;

  constructor(options: { readonly maxLine?: number } = {}) {
    const maxLine = options.maxLine ?? TARGET_TX_LINE_MAX;
    if (!Number.isInteger(maxLine) || maxLine < 2) throw new Ctp3Error("BAD_ARGUMENT", "maxLine 无效");
    this.maxLine = maxLine;
  }

  reset(): void { this.#buffer = []; this.#discarding = false; }

  push(data: Uint8Array | ArrayBuffer): { readonly lines: readonly string[]; readonly errors: readonly Ctp3Error[] } {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const lines: string[] = [];
    const errors: Ctp3Error[] = [];
    for (const byte of bytes) {
      if (this.#discarding) { if (byte === 0x0a) this.#discarding = false; continue; }
      if (byte === 0x0a) {
        if (this.#buffer.at(-1) === 0x0d) this.#buffer.pop();
        try { lines.push(decoder.decode(Uint8Array.from(this.#buffer))); }
        catch (cause) { errors.push(new Ctp3Error("BAD_ENCODING", "CTP3 Line 不是有效 UTF-8", { cause })); }
        this.#buffer = [];
      } else if (this.#buffer.length >= this.maxLine - 1) {
        this.#buffer = [];
        this.#discarding = true;
        errors.push(new Ctp3Error("LINE_TOO_LONG", `CTP3 Line 超过 ${this.maxLine} B`));
      } else this.#buffer.push(byte);
    }
    return Object.freeze({ lines: Object.freeze(lines), errors: Object.freeze(errors) });
  }
}

export function protocolError(error: unknown): CautestError {
  if (error instanceof CautestError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new CautestError(cause.message, { code: "protocol_error", cause });
}
