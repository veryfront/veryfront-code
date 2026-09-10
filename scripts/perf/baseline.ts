import { resolve } from "node:path";

/** Whether the copied harness can use the base checkout's dependency graph. */
export function baselineCompatible(
  headConfig: Record<string, unknown>,
  baseConfig: Record<string, unknown>,
  headLock: string | null,
  baseLock: string | null,
): boolean {
  if (headLock === null || baseLock === null || headLock !== baseLock) {
    return false;
  }
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
    "lock",
  ].every((key) =>
    JSON.stringify(headConfig[key]) === JSON.stringify(baseConfig[key])
  );
}

async function dependencyMetadata(directory: string) {
  const config: Record<string, unknown> = JSON.parse(
    await Deno.readTextFile(resolve(directory, "deno.json")),
  );
  if (config.lock === false) return { config, lock: null };
  const setting = config.lock;
  const path = typeof setting === "string"
    ? setting
    : setting && typeof setting === "object" && "path" in setting
    ? setting.path
    : "deno.lock";
  if (typeof path !== "string") throw new Error("Invalid lockfile path");
  return { config, lock: await Deno.readTextFile(resolve(directory, path)) };
}

if (import.meta.main) {
  try {
    const base = Deno.args[0];
    if (!base) throw new Error("Missing base checkout");
    const [headMetadata, baseMetadata] = await Promise.all([
      dependencyMetadata("."),
      dependencyMetadata(base),
    ]);
    Deno.exitCode = baselineCompatible(
        headMetadata.config,
        baseMetadata.config,
        headMetadata.lock,
        baseMetadata.lock,
      )
      ? 0
      : 1;
  } catch {
    console.error("Baseline dependency metadata could not be read");
    Deno.exitCode = 2;
  }
}
