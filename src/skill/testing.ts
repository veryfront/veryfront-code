/**
 * Skill test utilities
 *
 * Shared helpers for skill-related tests.
 *
 * @module
 */

import type { FileSystemAdapter, FileWatcher } from "#veryfront/platform/adapters/base.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";

/**
 * Create a lightweight in-memory FileSystemAdapter for tests.
 *
 * @param files - Map of absolute file paths to their string content
 */
export function createSkillTestAdapter(files: Record<string, string>): FileSystemAdapter {
  const allPaths = Object.keys(files);

  function getEntries(
    path: string,
  ): Array<{ name: string; isFile: boolean; isDirectory: boolean }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const entryMap = new Map<string, { isFile: boolean; isDirectory: boolean }>();

    for (const filePath of allPaths) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      if (!remainder) continue;

      const [head, ...rest] = remainder.split("/");
      if (!head) continue;

      const isDirectFile = rest.length === 0;
      const existing = entryMap.get(head);

      if (!existing) {
        entryMap.set(head, { isFile: isDirectFile, isDirectory: !isDirectFile });
        continue;
      }

      if (!isDirectFile) {
        existing.isDirectory = true;
        existing.isFile = false;
      }
    }

    return Array.from(entryMap.entries())
      .map(([name, type]) => ({ name, ...type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) throw FILE_NOT_FOUND.create({ detail: `File not found: ${path}` });
      return content;
    },
    async exists(path: string): Promise<boolean> {
      if (path in files) return true;
      return allPaths.some((filePath) => filePath.startsWith(`${path}/`));
    },
    async *readDir(path: string) {
      for (const entry of getEntries(path)) {
        yield { ...entry, isSymlink: false };
      }
    },
    async stat(path: string) {
      const isFile = path in files;
      const isDirectory = !isFile && allPaths.some((filePath) => filePath.startsWith(`${path}/`));
      return {
        size: isFile ? (files[path] ?? "").length : 0,
        isFile,
        isDirectory,
        isSymlink: false,
        mtime: new Date(),
      };
    },
    async writeFile() {},
    async mkdir() {},
    async remove() {},
    async makeTempDir() {
      return "/tmp/mock";
    },
    watch(): FileWatcher {
      return {
        close() {},
        async *[Symbol.asyncIterator]() {},
      };
    },
  } satisfies FileSystemAdapter;
}
