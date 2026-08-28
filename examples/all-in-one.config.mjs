import { testConfig } from "@cautest/config.js";
import { exampleMathJob } from "./c-lib/cautest.config.mjs";
import { kernelCounterJob } from "./kernel-lib/cautest.config.mjs";
import { driverUnitJob } from "./linux-driver-unit/cautest.config.mjs";
import { driverAbiJob } from "./linux-driver/cautest.config.mjs";
import { mcuSimJob } from "./mcu-sim/cautest.config.mjs";
import { systemExampleJob } from "./system-script/cautest.config.mjs";

export default testConfig({
  profiles: [{ id: "ci", reporters: ["json", "junit"] }],
  jobs: [
    exampleMathJob("c-lib"),
    kernelCounterJob("kernel-lib"),
    driverUnitJob("linux-driver-unit"),
    driverAbiJob("linux-driver"),
    mcuSimJob("mcu-sim"),
    systemExampleJob("system-script"),
  ],
});
