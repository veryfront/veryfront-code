/**
 * Multi-source extension discovery.
 *
 * Discovers extensions from four sources with priority:
 *   config > package > project > local-file
 *
 * @module extensions/discovery
 */

import type { Capability, ResolvedExtension } from "./types.ts";

/**
 * Metadata extracted from a package.json that declares itself
 * as a veryfront extension.
 */
export interface PackageMetadata {
  isExtension: true;
  capabilities: Capability[];
}

/**
 * Parse veryfront extension metadata from a package.json-like object.
 *
 * Returns `PackageMetadata` when the package declares
 * `veryfront.extension: true`, otherwise `undefined`.
 */
export function parsePackageMetadata(
  pkg: Record<string, unknown>,
): PackageMetadata | undefined {
  const vf = pkg.veryfront;
  if (
    vf === null || vf === undefined || typeof vf !== "object" ||
    Array.isArray(vf)
  ) {
    return undefined;
  }

  const meta = vf as Record<string, unknown>;
  if (meta.extension !== true) {
    return undefined;
  }

  const capabilities: Capability[] = Array.isArray(meta.capabilities)
    ? (meta.capabilities as Capability[])
    : [];

  return { isExtension: true, capabilities };
}

/**
 * Merge extensions from all four sources in priority order.
 *
 * Priority (highest first): config > package > project > local-file.
 * Duplicates are resolved by keeping the highest-priority entry.
 * Disable directives (`{ name, enabled: false }`) remove matching
 * extensions regardless of source.
 */
export function mergeExtensions(
  config: ResolvedExtension[],
  packages: ResolvedExtension[],
  project: ResolvedExtension[],
  local: ResolvedExtension[],
  disableDirectives?: Array<{ name: string; enabled: false }>,
): ResolvedExtension[] {
  const disabledNames = new Set(
    (disableDirectives ?? []).map((d) => d.name),
  );

  const seen = new Map<string, ResolvedExtension>();

  // Process sources in priority order -- first write wins.
  const ordered: ResolvedExtension[] = [
    ...config,
    ...packages,
    ...project,
    ...local,
  ];

  for (const resolved of ordered) {
    const name = resolved.extension.name;
    if (disabledNames.has(name)) continue;
    if (!seen.has(name)) {
      seen.set(name, resolved);
    }
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Filesystem discovery helpers
// ---------------------------------------------------------------------------

async function readDir(
  path: string,
): Promise<Deno.DirEntry[]> {
  try {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(path)) {
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan `node_modules` (including `@scoped` packages) for packages
 * that declare veryfront extension metadata in their `package.json`.
 */
export async function discoverPackageExtensions(
  baseDir: string,
): Promise<Array<{ packageName: string; metadata: PackageMetadata }>> {
  const nmDir = `${baseDir}/node_modules`;
  const results: Array<{ packageName: string; metadata: PackageMetadata }> = [];
  const entries = await readDir(nmDir);

  for (const entry of entries) {
    // Accept symlinks so pnpm-style node_modules layouts are discovered.
    if (!entry.isDirectory && !entry.isSymlink) continue;

    if (entry.name.startsWith("@")) {
      // Scoped packages -- iterate one level deeper.
      const scopeDir = `${nmDir}/${entry.name}`;
      const scopeEntries = await readDir(scopeDir);
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory && !scopeEntry.isSymlink) continue;
        const pkgName = `${entry.name}/${scopeEntry.name}`;
        const meta = await tryReadPackageMeta(
          `${scopeDir}/${scopeEntry.name}`,
        );
        if (meta) results.push({ packageName: pkgName, metadata: meta });
      }
    } else {
      const meta = await tryReadPackageMeta(`${nmDir}/${entry.name}`);
      if (meta) results.push({ packageName: entry.name, metadata: meta });
    }
  }

  return results;
}

async function tryReadPackageMeta(
  pkgDir: string,
): Promise<PackageMetadata | undefined> {
  try {
    const raw = await Deno.readTextFile(`${pkgDir}/package.json`);
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return parsePackageMetadata(pkg);
  } catch {
    return undefined;
  }
}

/**
 * Discover project extensions living under `extensions/` in the project root.
 *
 * Looks for `extensions/<name>/src/index.ts` and `extensions/<name>/index.ts`.
 */
export async function discoverProjectExtensions(
  baseDir: string,
): Promise<string[]> {
  const extDir = `${baseDir}/extensions`;
  const entries = await readDir(extDir);
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const srcIndex = `${extDir}/${entry.name}/src/index.ts`;
    const rootIndex = `${extDir}/${entry.name}/index.ts`;

    if (await fileExists(srcIndex)) {
      results.push(srcIndex);
    } else if (await fileExists(rootIndex)) {
      results.push(rootIndex);
    }
  }

  return results;
}

/**
 * Find `*.extension.ts` files in the project root.
 */
export async function discoverLocalExtensions(
  baseDir: string,
): Promise<string[]> {
  const entries = await readDir(baseDir);
  return entries
    .filter((e) => !e.isDirectory && e.name.endsWith(".extension.ts"))
    .map((e) => `${baseDir}/${e.name}`);
}
