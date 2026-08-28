import { mcuCTestJob, testConfig } from "@cautest/config.js";

export function mcuSimJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  return mcuCTestJob({
    id: "component.mcu-sim",
    firmware: {
      kind: "host-simulated",
      output: ".cautest/generated/mcu-sim-target",
      sources: [fromExample("firmware_cases.c")],
    },
    run: { include: ["mcu_example/passes"] },
  });
}

export default testConfig({ jobs: [mcuSimJob()] });
