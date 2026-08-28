import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".cautest", { recursive: true });
await writeFile(".cautest/server.ready", "ready\n");
process.stdout.write("example server ready\n");
setInterval(() => {}, 60_000);
