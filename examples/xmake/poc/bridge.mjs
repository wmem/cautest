import { spawnSync } from "node:child_process";
const program = process.env.CAUTEST_XMAKE;
if (!program) throw new Error("CAUTEST_XMAKE must point to the real Xmake executable");
const result = spawnSync(program, ["build", "-y", "app"], { stdio: "inherit", timeout: 15000 });
if (result.error) console.error(result.error);
process.exit(result.status ?? 2);
