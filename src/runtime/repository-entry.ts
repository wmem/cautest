import { register } from "node:module";

// Resolve @cautest/config to this checkout, never to a consumer's unrelated copy.
register("./repository-loader.js", import.meta.url);
const { main } = await import("./main.js");
await main();
