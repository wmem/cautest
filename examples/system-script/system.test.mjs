import { defineScriptTest } from "@cautest/config.js";

export default defineScriptTest(async ({ test, signal, env }) => {
  await test.case("health endpoint returns ok", async (t) => {
    const response = await fetch(`${env.CAUTEST_EXAMPLE_URL}/health`, { signal });
    t.assertEqual(200, response.status);
    t.expectEqual('{"status":"ok"}\n', await response.text());
  });
});
