/**
 * Shared file-system utilities for CLI commands and MCP tools.
 */

import { createFileSystem, type FileSystem } from "veryfront/platform";

let cachedFs: FileSystem | null = null;

export function getFs(): FileSystem {
  cachedFs ??= createFileSystem();
  return cachedFs;
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await getFs().mkdir(path, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await getFs().stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  return getFs().exists(path);
}
