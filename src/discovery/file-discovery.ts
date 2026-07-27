/**
 * File Discovery
 *
 * Bounded, adapter-aware utilities for finding project-authored source files.
 */

import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import type { FileDiscoveryContext } from "./types.ts";

const MAX_DISCOVERY_DEPTH = 64;
export const MAX_PROJECT_DISCOVERY_ENTRIES = 100_000;
const COMMON_DISCOVERY_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
] as const;
const TYPESCRIPT_DISCOVERY_IGNORE_PATTERNS = [
  ...COMMON_DISCOVERY_IGNORE_PATTERNS,
  "*.test.*",
  "*.spec.*",
  "*.bench.*",
  "*.d.ts",
] as const;

/**
 * Find files with one of the requested extensions under a discovery root.
 *
 * Adapter paths remain opaque keys. Native paths are emitted as canonical file
 * URLs so spaces and literal percent signs round-trip through dynamic import.
 */
async function findFilesByExtension(
  dir: string,
  context: FileDiscoveryContext,
  extensions: readonly string[],
  ignorePatterns: readonly string[],
): Promise<string[]> {
  if (!(await discoveryFileExists(dir, context))) return [];

  const files = await collectFiles({
    baseDir: dir,
    extensions: [...extensions],
    recursive: true,
    maxDepth: MAX_DISCOVERY_DEPTH,
    maxEntries: MAX_PROJECT_DISCOVERY_ENTRIES,
    ignorePatterns: [...ignorePatterns],
    fsAdapter: context.fsAdapter,
    entryBudget: context.entryBudget,
  });

  if (context.fsAdapter) {
    // Adapter paths are opaque adapter keys, not native file URLs. Keeping
    // them raw also preserves literal percent signs and relative VFS roots.
    return files.map((file) => file.path);
  }

  const { path, url } = await getNodeDeps(context);
  return files.map((file) => url.pathToFileURL(path.resolve(file.path)).href);
}

/**
 * Get Node.js fs and path modules (cached on context).
 *
 * Only called for native filesystem operations.
 */
async function getNodeDeps(
  context: FileDiscoveryContext,
): Promise<{
  fs: typeof import("node:fs");
  path: typeof import("node:path");
  url: typeof import("node:url");
}> {
  if (context.nodeDeps) return context.nodeDeps;

  const [fsModule, pathModule, urlModule] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("node:url"),
  ]);
  context.nodeDeps = { fs: fsModule, path: pathModule, url: urlModule };
  return context.nodeDeps;
}

/** Find runtime TypeScript modules, excluding conventional test-only sources. */
export function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(
    dir,
    context,
    [".ts", ".tsx"],
    TYPESCRIPT_DISCOVERY_IGNORE_PATTERNS,
  );
}

export async function readDiscoveryTextFile(
  file: string,
  context: FileDiscoveryContext,
): Promise<string> {
  if (context.fsAdapter) {
    const path = file.startsWith("file://")
      ? decodeURIComponent(file.slice("file://".length))
      : file;
    return await context.fsAdapter.readFile(path);
  }

  const { fs, url } = await getNodeDeps(context);
  const path = file.startsWith("file://") ? url.fileURLToPath(file) : file;
  return await fs.promises.readFile(path, "utf-8");
}

/** A single top-level entry inside a discovery directory. */
export type DiscoveryDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

/** Lists immediate entries, rejecting unsafe adapter names and source failures. */
export async function listDiscoveryDirectoryEntries(
  dir: string,
  context: FileDiscoveryContext,
): Promise<DiscoveryDirectoryEntry[]> {
  if (!(await discoveryFileExists(dir, context))) return [];

  const entries = await collectFiles({
    baseDir: dir,
    recursive: false,
    maxDepth: 0,
    maxEntries: MAX_PROJECT_DISCOVERY_ENTRIES,
    includeDirs: true,
    fsAdapter: context.fsAdapter,
    entryBudget: context.entryBudget,
  });
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
  }));
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;
  }
  if (!(error instanceof Error)) return false;
  return error.name === "NotFound" || error.name === "NotFoundError";
}

/** Return true when a discovery path exists; operational failures propagate. */
export async function discoveryFileExists(
  path: string,
  context: FileDiscoveryContext,
): Promise<boolean> {
  if (context.fsAdapter) {
    return await context.fsAdapter.exists(path);
  }

  const { fs } = await getNodeDeps(context);
  try {
    await fs.promises.stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
