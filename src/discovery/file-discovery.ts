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

  try {
    if (context.fsAdapter) {
      if (!(await context.fsAdapter.exists(dir))) return files;

      for await (const entry of context.fsAdapter.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && extensions.some((extension) => entry.name.endsWith(extension))) {
          files.push(`file://${filePath}`);
          continue;
        }

        if (entry.isDirectory) {
          files.push(...(await findFilesByExtension(filePath, context, extensions)));
        }
      }

      return files;
    }

    const { fs, path } = await getNodeDeps(context);
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);

      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(`file://${path.resolve(filePath)}`);
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...(await findFilesByExtension(filePath, context, extensions)));
      }
    }
  } catch (_) {
    /* expected: directory may not exist or be unreadable */
    return files;
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
): Promise<{ fs: typeof import("node:fs"); path: typeof import("node:path") }> {
  if (context.nodeDeps) return context.nodeDeps;

  const [fsModule, pathModule] = await Promise.all([import("node:fs"), import("node:path")]);
  context.nodeDeps = { fs: fsModule, path: pathModule };
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
  fileUrl: string,
  context: FileDiscoveryContext,
): Promise<string> {
  const path = fileUrl.replace(/^file:\/\//, "");

  if (context.fsAdapter) {
    return await context.fsAdapter.readFile(path);
  }

  const { fs } = await getNodeDeps(context);
  return fs.readFileSync(path, "utf-8");
}
