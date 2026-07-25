/**
 * File Discovery
 *
 * Utilities for finding TypeScript files in directories.
 */

import type { FileDiscoveryContext } from "./types.ts";

/**
 * Find all TypeScript files in a directory recursively
 */
async function findFilesByExtension(
  dir: string,
  context: FileDiscoveryContext,
  extensions: readonly string[],
): Promise<string[]> {
  const files: string[] = [];

  if (context.fsAdapter) {
    if (!(await context.fsAdapter.exists(dir))) return files;

    for await (const entry of context.fsAdapter.readDir(dir)) {
      const filePath = `${dir}/${entry.name}`;

      if (entry.isFile && extensions.some((extension) => entry.name.endsWith(extension))) {
        // Adapter paths are opaque adapter keys, not native file URLs. Keeping
        // them raw also preserves literal percent signs and relative VFS roots.
        files.push(filePath);
        continue;
      }

      if (entry.isDirectory) {
        files.push(...(await findFilesByExtension(filePath, context, extensions)));
      }
    }

    return files;
  }

  const { fs, path, url } = await getNodeDeps(context);
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);

    if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(url.pathToFileURL(path.resolve(filePath)).href);
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await findFilesByExtension(filePath, context, extensions)));
    }
  }

  return files;
}

/**
 * Get Node.js fs and path modules (cached on context).
 *
 * Only called when no fsAdapter is present — callers must guard accordingly.
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

/**
 * Find all TypeScript files in a directory recursively.
 */
export function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(dir, context, [".ts", ".tsx"]);
}

/**
 * Find all Markdown files in a directory recursively.
 */
export function findMarkdownFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(dir, context, [".md"]);
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
  return fs.readFileSync(path, "utf-8");
}

/** A single top-level entry inside a discovery directory. */
export type DiscoveryDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

/** Lists the immediate (non-recursive) entries of a discovery directory. */
export async function listDiscoveryDirectoryEntries(
  dir: string,
  context: FileDiscoveryContext,
): Promise<DiscoveryDirectoryEntry[]> {
  const entries: DiscoveryDirectoryEntry[] = [];

  try {
    if (context.fsAdapter) {
      if (!(await context.fsAdapter.exists(dir))) return entries;

      for await (const entry of context.fsAdapter.readDir(dir)) {
        entries.push({
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
        });
      }

      return entries;
    }

    const { fs } = await getNodeDeps(context);
    if (!fs.existsSync(dir)) return entries;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      entries.push({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      });
    }
  } catch (_) {
    /* expected: directory may not exist or be unreadable */
    return entries;
  }

  return entries;
}

/** Returns true when a discovery file exists (fsAdapter-aware). */
export async function discoveryFileExists(
  path: string,
  context: FileDiscoveryContext,
): Promise<boolean> {
  try {
    if (context.fsAdapter) {
      return await context.fsAdapter.exists(path);
    }
    const { fs } = await getNodeDeps(context);
    return fs.existsSync(path);
  } catch (_) {
    return false;
  }
}
