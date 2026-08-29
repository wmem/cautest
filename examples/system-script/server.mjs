import http from "node:http";

const port = Number(process.env.CAUTEST_EXAMPLE_PORT ?? 18765);
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}\n');
    return;
  }
  if (request.method === "GET" && request.url === "/version") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"version":"1.0.0"}\n');
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"status":"not-found"}\n');
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`example server ready: http://127.0.0.1:${port}\n`);
});
