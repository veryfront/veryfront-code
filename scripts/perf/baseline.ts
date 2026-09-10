import { resolve } from "node:path";

const DEPENDENCY_FIELDS = [
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
];

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
  return DEPENDENCY_FIELDS.every((key) =>
    JSON.stringify(headConfig[key]) === JSON.stringify(baseConfig[key])
  );
}

async function optionalText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function parseDenoConfig(source: string): Record<string, unknown> | null {
  try {
    return JSON.parse(source);
  } catch {
    // Deno accepts JSONC in both config extensions. Uncertain metadata
    // establishes a baseline instead of using a partial parser.
    return null;
  }
}

async function workspaceMetadata(
  directory: string,
  config: Record<string, unknown>,
) {
  const workspace = config.workspace;
  const members = Array.isArray(workspace)
    ? workspace
    : workspace && typeof workspace === "object" && "members" in workspace
    ? workspace.members
    : [];
  if (
    !Array.isArray(members) ||
    members.some((member) =>
      typeof member !== "string" || /[*?\[{]/.test(member)
    )
  ) {
    return null;
  }
  const metadata: unknown[] = [];
  for (const member of [".", ...members]) {
    const memberDir = resolve(directory, member);
    for (const file of ["deno.json", "deno.jsonc", "package.json"]) {
      if (member === "." && file !== "package.json") continue;
      const source = await optionalText(resolve(memberDir, file));
      if (source === null) {
        metadata.push([member, file, null]);
        continue;
      }
      const parsed = file === "package.json"
        ? JSON.parse(source)
        : parseDenoConfig(source);
      if (parsed === null) return null;
      const fields = file === "package.json"
        ? [
          "name",
          "version",
          "type",
          "exports",
          "imports",
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
          "overrides",
          "resolutions",
        ]
        : [...DEPENDENCY_FIELDS, "name", "version", "exports"];
      metadata.push([
        member,
        file,
        fields.map((field) => [field, parsed[field]]),
      ]);
      if (parsed.workspace || parsed.links || parsed.patch) return null;
      if (parsed.importMap) {
        if (
          typeof parsed.importMap !== "string" ||
          /^https?:/.test(parsed.importMap)
        ) return null;
        metadata.push(
          await Deno.readTextFile(resolve(memberDir, parsed.importMap)),
        );
      }
    }
  }
  if (config.links || config.patch) return null;
  if (config.importMap) {
    if (
      typeof config.importMap !== "string" || /^https?:/.test(config.importMap)
    ) return null;
    metadata.push(
      await Deno.readTextFile(resolve(directory, config.importMap)),
    );
  }
  return metadata;
}

async function dependencyMetadata(directory: string) {
  const config = parseDenoConfig(
    await optionalText(resolve(directory, "deno.json")) ??
      await Deno.readTextFile(resolve(directory, "deno.jsonc")),
  );
  if (config === null) return { config: {}, lock: null, workspace: null };
  const workspace = await workspaceMetadata(directory, config);
  if (config.lock === false || workspace === null) {
    return { config, lock: null, workspace };
  }
  const setting = config.lock;
  const path = typeof setting === "string"
    ? setting
    : setting && typeof setting === "object" && "path" in setting
    ? setting.path
    : "deno.lock";
  if (typeof path !== "string") throw new Error("Invalid lockfile path");
  return {
    config,
    lock: await Deno.readTextFile(resolve(directory, path)),
    workspace,
  };
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
      ) &&
        JSON.stringify(headMetadata.workspace) ===
          JSON.stringify(baseMetadata.workspace)
      ? 0
      : 1;
  } catch {
    console.error("Baseline dependency metadata could not be read");
    Deno.exitCode = 2;
  }
}
