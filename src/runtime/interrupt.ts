export interface SignalEmitter {
  on(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export interface InterruptHandling {
  readonly signal: AbortSignal;
  close(): void;
}

/** 首次 SIGINT 请求协作取消，第二次 SIGINT 立即强制退出。 */
export function installInterruptHandling(options: {
  readonly emitter?: SignalEmitter;
  readonly onFirst?: () => void;
  readonly forceExit?: (code: number) => void;
} = {}): InterruptHandling {
  const emitter = options.emitter ?? process;
  const controller = new AbortController();
  let count = 0;
  const interrupt = (): void => {
    count += 1;
    if (count === 1) {
      controller.abort(new Error("收到 SIGINT，运行已取消"));
      options.onFirst?.();
    } else {
      (options.forceExit ?? ((code) => process.exit(code)))(130);
    }
  };
  emitter.on("SIGINT", interrupt);
  return Object.freeze({ signal: controller.signal, close() { emitter.off("SIGINT", interrupt); } });
}
