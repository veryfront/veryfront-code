/** Whether the copied harness can use the base checkout's dependency graph. */
export function baselineCompatible(
  headConfig: Record<string, unknown>,
  baseConfig: Record<string, unknown>,
  headLock: string,
  baseLock: string,
): boolean {
  if (headLock !== baseLock) return false;
  return [
    "imports",
    "scopes",
    "workspace",
    "importMap",
    "nodeModulesDir",
    "vendor",
    "unstable",
    "compilerOptions",
    "minimumDependencyAge",
    "links",
    "patch",
  ].every((key) =>
    JSON.stringify(headConfig[key]) === JSON.stringify(baseConfig[key])
  );
}

if (import.meta.main) {
  try {
    const base = Deno.args[0];
    if (!base) throw new Error("Missing base checkout");
    const [headConfig, baseConfig, headLock, baseLock] = await Promise.all([
      Deno.readTextFile("deno.json"),
      Deno.readTextFile(`${base}/deno.json`),
      Deno.readTextFile("deno.lock"),
      Deno.readTextFile(`${base}/deno.lock`),
    ]);
    Deno.exitCode = baselineCompatible(
        JSON.parse(headConfig),
        JSON.parse(baseConfig),
        headLock,
        baseLock,
      )
      ? 0
      : 1;
  } catch {
    console.error("Baseline dependency metadata could not be read");
    Deno.exitCode = 2;
  }
}
