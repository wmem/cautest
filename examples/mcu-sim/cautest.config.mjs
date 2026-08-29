import { mcuCTestJob, testConfig } from "@cautest/config.js";

export function mcuSimJob(baseDir = ".") {
  const fromExample = (relative) => baseDir === "." ? relative : `${baseDir}/${relative}`;
  return mcuCTestJob({
    id: "component.mcu-sim",
    firmware: {
      kind: "host-simulated",
      output: ".cautest/generated/mcu-sim-target",
      sources: [fromExample("src/**/*.c"), fromExample("test/**/*.c")],
      headers: [fromExample("include/**/*.h")],
    },
  });
}

export default testConfig({ jobs: [mcuSimJob()] });
