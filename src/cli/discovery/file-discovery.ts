/**
 * File Discovery
 *
 * Utilities for finding TypeScript files in directories.
 */

import type { FileDiscoveryContext } from "./types.ts";

/**
 * Find all TypeScript files in a directory recursively
 */
export async function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  const files: string[] = [];

  try {
    if (context.fsAdapter) {
      if (!(await context.fsAdapter.exists(dir))) return files;

      for await (const entry of context.fsAdapter.readDir(dir)) {
        const filePath = `${dir}/${entry.name}`;

        if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          files.push(`file://${filePath}`);
          continue;
        }

        if (entry.isDirectory) {
          files.push(...(await findTypeScriptFiles(filePath, context)));
        }
      }

      return files;
    }

    const { fs, path } = await getNodeDeps(context);
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);

      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        files.push(`file://${path.resolve(filePath)}`);
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...(await findTypeScriptFiles(filePath, context)));
      }
    }
  } catch {
    return files;
  }

  return files;
}

/**
 * Get Node.js fs and path modules (cached on context)
 */
export async function getNodeDeps(
  context: FileDiscoveryContext,
): Promise<{ fs: typeof import("node:fs"); path: typeof import("node:path") }> {
  if (context.nodeDeps) return context.nodeDeps;

  if (context.fsAdapter) {
    context.nodeDeps = {
      fs: {} as typeof import("node:fs"),
      path: {} as typeof import("node:path"),
    };
    return context.nodeDeps;
  }

  const [fsModule, pathModule] = await Promise.all([import("node:fs"), import("node:path")]);
  context.nodeDeps = { fs: fsModule, path: pathModule };
  return context.nodeDeps;
}
