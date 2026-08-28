import { collectLogs, processStart, scriptSystemTestJob, testConfig, testJob } from "@cautest/config.js";

export function systemExampleJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  const port = Number(process.env.CAUTEST_EXAMPLE_PORT ?? 18765);
  const url = `http://127.0.0.1:${port}`;
  const script = scriptSystemTestJob({
    id: "system.example-api",
    file: fromExample("system.test.mjs"),
    env: { CAUTEST_EXAMPLE_URL: url },
  });

  return testJob({
    ...script,
    workflow: [
      processStart({
        name: "server",
        program: process.execPath,
        args: [fromExample("server.mjs")],
        env: { CAUTEST_EXAMPLE_PORT: String(port) },
        ready: { kind: "http", url: `${url}/health`, status: 200, bodyIncludes: '"status":"ok"' },
      }),
      ...script.workflow,
      collectLogs({ from: "server" }),
    ],
  });
}

export default testConfig({ jobs: [systemExampleJob()] });
