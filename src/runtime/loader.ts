const entrypoints = new Map([
  ["@cautest/config", new URL("./lib/config/index.js", import.meta.url).href],
]);

export async function resolve(
  specifier: string,
  context: object,
  nextResolve: (specifier: string, context: object) => Promise<unknown>,
): Promise<unknown> {
  const url = entrypoints.get(specifier);
  if (url !== undefined) return { url, shortCircuit: true };
  return nextResolve(specifier, context);
}
