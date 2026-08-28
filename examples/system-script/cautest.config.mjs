import { collectLogs, processStart, scriptSystemTestJob, testConfig, testJob } from "@cautest/config.js";

const script = scriptSystemTestJob({ id: "system.example-api", file: "system.test.mjs" });
export default testConfig({ jobs: [testJob({
  ...script,
  workflow: [
    processStart({ name: "server", program: process.execPath, args: ["server.mjs"], ready: { kind: "file", path: ".cautest/server.ready" } }),
    ...script.workflow,
    collectLogs({ from: "server" }),
  ],
})] });
