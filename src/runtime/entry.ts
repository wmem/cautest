#!/usr/bin/env node

import { register } from "node:module";

register("./loader.mjs", import.meta.url);

const cliEntrypoint = "./lib/runtime/cli.js";
const { runCli } = await import(cliEntrypoint);
process.exitCode = await runCli(process.argv.slice(2));
