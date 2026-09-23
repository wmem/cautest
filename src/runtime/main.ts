import { runCli } from "./cli.js";
import { installInterruptHandling } from "./interrupt.js";

/** Shared process entry for source checkouts and portable installations. */
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const interrupts = installInterruptHandling({ onFirst() {
    process.stderr.write("收到 SIGINT，正在取消并清理；再次按 Ctrl-C 将强制退出\n");
  } });
  try {
    process.exitCode = await runCli(args, process, { signal: interrupts.signal });
  } finally {
    interrupts.close();
  }
}
