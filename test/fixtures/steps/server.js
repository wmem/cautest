import http from "node:http";
import { writeFile } from "node:fs/promises";

const readyFile = process.argv[2];
const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ready");
});
server.listen(0, "127.0.0.1", async () => {
  await writeFile(readyFile, String(server.address().port));
  console.log(`server:${server.address().port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
