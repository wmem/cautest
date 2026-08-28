import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installInterruptHandling } from "../dist/runtime/interrupt.js";

test("SIGINT 首次触发 Abort，第二次强制退出 130，并可移除监听", () => {
  const emitter = new EventEmitter();
  const forced = [];
  let first = 0;
  const handling = installInterruptHandling({ emitter, onFirst() { first += 1; }, forceExit(code) { forced.push(code); } });
  emitter.emit("SIGINT");
  assert.equal(handling.signal.aborted, true);
  assert.match(String(handling.signal.reason), /SIGINT/u);
  assert.equal(first, 1);
  assert.deepEqual(forced, []);
  emitter.emit("SIGINT");
  assert.deepEqual(forced, [130]);
  handling.close();
  assert.equal(emitter.listenerCount("SIGINT"), 0);
});
