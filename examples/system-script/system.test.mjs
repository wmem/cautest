import { defineScriptTest } from "@cautest/config.js";
import { getJson } from "./client.mjs";

export default defineScriptTest(async ({ test, signal, env }) => {
  await test.case("health endpoint returns ok", async (t) => {
    const response = await getJson(`${env.CAUTEST_EXAMPLE_URL}/health`, signal);
    t.assertEqual(200, response.status);
    t.expectEqual("ok", response.body.status);
  });

  await test.case("version endpoint returns release", async (t) => {
    const response = await getJson(`${env.CAUTEST_EXAMPLE_URL}/version`, signal);
    t.assertEqual(200, response.status);
    t.expectEqual("1.0.0", response.body.version);
  });
});
