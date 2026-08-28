#!/usr/bin/env node

import { register } from "node:module";

register("./loader.mjs", import.meta.url);

const { runCli } = await import("./cli.js");
process.exitCode = await runCli(process.argv.slice(2));
