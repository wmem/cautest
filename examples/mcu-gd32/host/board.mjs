import path from "node:path";
import { pathToFileURL } from "node:url";

// 延迟加载 MSP 板外适配器；普通 list/plan 不连接硬件。
export function gd32Board(settings) {
  let adapter;
  return {
    async flash(firmware) {
      const module = await import(pathToFileURL(path.join(settings.msp, "tools/cautest/board.mjs")).href);
      adapter = module.gd32Board(settings);
      await adapter.flash(firmware);
    },
    reset: () => adapter.reset(),
    openTransport: (options) => adapter.openTransport(options),
    close: () => adapter?.close(),
  };
}
