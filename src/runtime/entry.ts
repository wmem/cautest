#!/usr/bin/env node

import { register } from "node:module";

register("./loader.mjs", import.meta.url);

const cliEntrypoint = "./lib/runtime/cli.js";
const interruptEntrypoint = "./lib/runtime/interrupt.js";
const { runCli } = await import(cliEntrypoint);
const { installInterruptHandling } = await import(interruptEntrypoint);
const interrupts = installInterruptHandling({ onFirst() { process.stderr.write("收到 SIGINT，正在取消并清理；再次按 Ctrl-C 将强制退出\n"); } });
try {
  process.exitCode = await runCli(process.argv.slice(2), process, { signal: interrupts.signal });
} finally {
  interrupts.close();
}
