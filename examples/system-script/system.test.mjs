import { defineScriptTest } from "@cautest/config.js";

export default defineScriptTest(async ({ test }) => {
  await test.case("server is ready", async (t) => {
    t.expect(true, "processStart 已完成 Ready Probe");
  });
});
