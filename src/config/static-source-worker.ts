/** Executed in a parse-only subprocess. Never link/evaluate a provider module. */
import {readFile, realpath} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {SourceTextModule} from "node:vm";

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("Expected an absolute provider module");
const visited = new Set<string>();
const files = new Set<string>();
const pending = [pathToFileURL(root).href];
while (pending.length > 0) {
  const url = pending.pop()!;
  if (visited.has(url)) continue;
  visited.add(url);
  if (visited.size > 10000) throw new Error("Provider static dependency graph exceeds 10000 modules; declare a smaller provider");
  if (!url.startsWith("file:")) continue;
  const file = await realpath(fileURLToPath(url));
  files.add(file);
  // JSON and native/CommonJS dependencies are content-addressed but not
  // evaluated. Their dynamic/transitive inputs belong in provider.inputs.
  if ([".json", ".node", ".cjs"].includes(path.extname(file))) continue;
  const code = await readFile(file, "utf8");
  const module = new SourceTextModule(code.replace(/^#![^\n]*(?:\n|$)/u, "\n"), {identifier: url});
  for (const specifier of module.dependencySpecifiers) {
    // Reserved Cautest aliases are supplied by the runtime loader and are
    // covered by the kit version/adapter sources, not by project resolution.
    if (specifier === "@cautest/config" || specifier === "@cautest/config.js") continue;
    pending.push(import.meta.resolve(specifier, url));
  }
}
process.stdout.write(JSON.stringify([...files].sort()) + "\n");
