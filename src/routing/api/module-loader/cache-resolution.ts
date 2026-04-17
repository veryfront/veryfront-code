import * as pathHelper from "#veryfront/compat/path";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";

async function readPackageJson<T>(filePath: string, fs: FileSystem): Promise<T | null> {
  try {
    return JSON.parse(await fs.readTextFile(filePath)) as T;
  } catch (_) {
    return null;
  }
}

export async function readProjectDependencies(
  projectDir: string,
  fs: FileSystem,
): Promise<Map<string, string>> {
  const pkg = await readPackageJson<{ dependencies?: Record<string, string> }>(
    pathHelper.join(projectDir, "package.json"),
    fs,
  );

  return new Map(Object.entries(pkg?.dependencies ?? {}));
}

function resolveExportEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return undefined;

  const obj = entry as Record<string, unknown>;
  for (const key of ["import", "default"]) {
    const value = obj[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      if (typeof nested.default === "string") return nested.default;
    }
  }

  return undefined;
}

export function getNodeExternalPackagesToResolve(userDeps: Map<string, string>): string[] {
  return ["zod", ...userDeps.keys()].filter((name, index, list) => list.indexOf(name) === index);
}

export async function resolveNodePackageToFileUrl(
  projectDir: string,
  packageName: string,
  fs: FileSystem,
  pathToFileURL: typeof import("node:url").pathToFileURL,
): Promise<string | null> {
  const packagePath = pathHelper.join(projectDir, "node_modules", packageName);
  const pkgJson = await readPackageJson<
    { exports?: Record<string, unknown>; module?: string; main?: string }
  >(
    pathHelper.join(packagePath, "package.json"),
    fs,
  );

  if (!pkgJson) return null;

  const entryPoint = resolveExportEntry(pkgJson.exports?.["."]) ?? pkgJson.module ?? pkgJson.main ??
    "index.js";
  return pathToFileURL(pathHelper.join(packagePath, entryPoint)).href;
}

export async function loadVeryfrontExportsMap(
  projectDir: string,
  fs: FileSystem,
): Promise<Record<string, { import?: string }>> {
  const pkgJson = await readPackageJson<{ exports?: Record<string, { import?: string }> }>(
    pathHelper.join(projectDir, "node_modules", "veryfront", "package.json"),
    fs,
  );

  return pkgJson?.exports ?? {};
}
