import path from "node:path";
import { fileURLToPath } from "node:url";
import { kernelUmlSmokeConfig } from "./uml-configs.mjs";
import { executeRealUml, inspectUmlPrerequisites, reportBlockedUml } from "./uml-support.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prerequisites = await inspectUmlPrerequisites();
if (!prerequisites.ok) {
  reportBlockedUml(prerequisites, "pnpm test:uml");
} else {
  await executeRealUml(kernelUmlSmokeConfig(prerequisites), project);
}
