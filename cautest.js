#!/usr/bin/env node

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = new URL("./dist/runtime/repository-entry.js", import.meta.url);
if (!existsSync(entry)) {
  process.stderr.write(`Cautest 源码尚未构建：${fileURLToPath(new URL(".", import.meta.url))}\n请在该目录运行 npm ci；已有开发依赖时可运行 npm run prepare。\n本命令不会自动安装依赖或访问网络。\n`);
  process.exitCode = 2;
} else {
  try {
    await import(entry.href);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
