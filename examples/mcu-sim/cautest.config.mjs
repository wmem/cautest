import { mcuCTestJob, testConfig } from "@cautest/config.js";

export default testConfig({ jobs: [mcuCTestJob({
  id: "component.mcu-sim",
  firmware: {
    kind: "host-simulated",
    output: ".cautest/generated/mcu-sim-target",
    sources: ["firmware_cases.c"],
  },
  run: { include: ["mcu_example/passes"] },
})] });
