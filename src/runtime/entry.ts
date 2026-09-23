#!/usr/bin/env node

import { register } from "node:module";

register("./loader.mjs", import.meta.url);
const entrypoint = "./lib/runtime/main.js";
const { main } = await import(entrypoint);
await main();
