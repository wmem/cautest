import { testConfig } from "@cautest/config.js";
import native from "../c-lib/cautest.config.mjs";
import kernel from "../kernel-lib/cautest.config.mjs";
import driver from "../linux-driver/cautest.config.mjs";
import mcu from "../mcu-sim/cautest.config.mjs";
import system from "../system-script/cautest.config.mjs";

export default testConfig({
  profiles: [{ id: "ci", reporters: ["json", "junit"] }],
  jobs: [
    ...native.jobs,
    ...kernel.jobs,
    ...driver.jobs,
    ...mcu.jobs,
    ...system.jobs,
  ],
});
