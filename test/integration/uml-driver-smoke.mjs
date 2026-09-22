import path from "node:path";
import { fileURLToPath } from "node:url";
import { driverUmlSmokeConfig } from "./uml-configs.mjs";
import { executeRealUml, inspectUmlPrerequisites, reportBlockedUml } from "./uml-support.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prerequisites = await inspectUmlPrerequisites();
if (!prerequisites.ok) {
  reportBlockedUml(prerequisites, "npm run test:driver:uml");
} else {
  await executeRealUml(driverUmlSmokeConfig(prerequisites), project);
}
