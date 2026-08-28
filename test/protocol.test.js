import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Ctp3Error, encodeCommand, escapeField, LineDecoder, parseProtocolLine, splitEscapedFields, StreamTransport } from "../dist/config/index.js";

test("CTP3 Command 使用 LF 且受 64 B 上限约束", () => {
  assert.equal(new TextDecoder().decode(encodeCommand("AT+CASE=1,0,0,0")), "AT+CASE=1,0,0,0\n");
  assert.throws(() => encodeCommand(`AT+CASE=${"1".repeat(64)}`), (error) => error instanceof Ctp3Error && error.code === "LINE_TOO_LONG");
  assert.throws(() => encodeCommand("AT\nAT"), /单行/u);
});

test("LineDecoder 支持任意分片、CRLF 及超长行恢复", () => {
  const decoder = new LineDecoder();
  const lines = [];
  for (const byte of new TextEncoder().encode("+HELLO:3,0,build,boot,64,512\r\nOK:HELLO\n")) lines.push(...decoder.push(Uint8Array.of(byte)).lines);
  assert.deepEqual(lines, ["+HELLO:3,0,build,boot,64,512", "OK:HELLO"]);
  const bounded = new LineDecoder({ maxLine: 8 });
  const result = bounded.push(new TextEncoder().encode("12345678tail\nOK:AT\n"));
  assert.equal(result.errors[0].code, "LINE_TOO_LONG");
  assert.deepEqual(result.lines, ["OK:AT"]);
});

test("字段转义和解析保持逗号、换行和反斜线", () => {
  const value = "hello, line\nnext\\end";
  const escaped = escapeField(value);
  assert.equal(escaped, "hello\\, line\\nnext\\\\end");
  assert.deepEqual(splitEscapedFields(`1,${escaped},`), ["1", value, ""]);
  assert.throws(() => splitEscapedFields("bad\\q"), /无效转义/u);
  assert.deepEqual(parseProtocolLine("+CASE:0,1,0,suite,test,"), { kind: "data", name: "CASE", fields: ["0", "1", "0", "suite", "test", ""], raw: "+CASE:0,1,0,suite,test," });
  assert.equal(parseProtocolLine("OK:CASE,7").kind, "ok");
  assert.equal(parseProtocolLine("ERROR:CASE,7,NOT_FOUND,missing").kind, "error");
});

test("StreamTransport 从任意 Chunk 还原完整协议行", async () => {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const transport = new StreamTransport({ readable, writable });
  await transport.open();
  readable.write(Buffer.from("+LOG:1,CASE,0"));
  readable.write(Buffer.from(",0,0,TARGET,INFO,hello\n"));
  assert.equal(await transport.nextLine(), "+LOG:1,CASE,0,0,0,TARGET,INFO,hello");
  await transport.close();
});
