/****
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

async function getDefaultAdapter(): Promise<RuntimeAdapter> {
  if (isDeno) {
    const { denoAdapter } = await import("#veryfront/platform/adapters/runtime/deno/index.ts");
    return denoAdapter;
  }

  if (isBun) {
    const { bunAdapter } = await import("#veryfront/platform/adapters/runtime/bun/index.ts");
    return bunAdapter;
  }

  const { nodeAdapter } = await import("#veryfront/platform/adapters/runtime/node/index.ts");
  return nodeAdapter;
}

export interface FileDiscoveryOptions {
  baseDir: string;
  extensions?: string[];
  patterns?: string[];
  recursive?: boolean;
  maxDepth?: number;
  ignorePatterns?: string[];
  includeDirs?: boolean;
  followSymlinks?: boolean;
  adapter?: RuntimeAdapter;
}

export interface FileDiscoveryResult {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  depth: number;
}

function matchesExtensions(fileName: string, extensions: string[] | undefined): boolean {
  if (!extensions?.length) return true;
  return extensions.some((ext) => fileName.endsWith(ext));
}

function matchesPatterns(fileName: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return true;
  return patterns.some((pattern) => fileName.includes(pattern));
}

function shouldIgnore(name: string, ignorePatterns: string[] | undefined): boolean {
  if (!ignorePatterns?.length) return false;
  return ignorePatterns.some((pattern) => name.includes(pattern));
}

function matchesFile(
  entryName: string,
  extensions: string[] | undefined,
  patterns: string[] | undefined,
): boolean {
  return matchesExtensions(entryName, extensions) && matchesPatterns(entryName, patterns);
}

export async function* discoverFiles(
  options: FileDiscoveryOptions,
): AsyncGenerator<FileDiscoveryResult> {
  const {
    baseDir,
    extensions,
    patterns,
    recursive = true,
    maxDepth = Infinity,
    ignorePatterns,
    includeDirs = false,
    followSymlinks = false,
    adapter,
  } = options;

  const runtimeAdapter = adapter ?? (await getDefaultAdapter());

  yield* walkDirectory({
    dir: baseDir,
    currentDepth: 0,
    maxDepth,
    extensions,
    patterns,
    ignorePatterns,
    includeDirs,
    recursive,
    followSymlinks,
    adapter: runtimeAdapter,
  });
}

interface WalkDirectoryOptions {
  dir: string;
  currentDepth: number;
  maxDepth: number;
  extensions: string[] | undefined;
  patterns: string[] | undefined;
  ignorePatterns: string[] | undefined;
  includeDirs: boolean;
  recursive: boolean;
  followSymlinks: boolean;
  adapter: RuntimeAdapter;
}

async function* walkDirectory(options: WalkDirectoryOptions): AsyncGenerator<FileDiscoveryResult> {
  const {
    dir,
    currentDepth,
    maxDepth,
    extensions,
    patterns,
    ignorePatterns,
    includeDirs,
    recursive,
    followSymlinks,
    adapter,
  } = options;

  if (currentDepth > maxDepth) return;

  try {
    const entries = adapter.fs.readDir(dir);

    for await (const entry of entries) {
      if (shouldIgnore(entry.name, ignorePatterns)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (includeDirs) {
          yield {
            path: fullPath,
            name: entry.name,
            isFile: false,
            isDirectory: true,
            depth: currentDepth,
          };
        }

        if (!recursive) continue;

        yield* walkDirectory({
          ...options,
          dir: fullPath,
          currentDepth: currentDepth + 1,
        });
        continue;
      }

      if (entry.isFile) {
        if (!matchesFile(entry.name, extensions, patterns)) continue;

        yield {
          path: fullPath,
          name: entry.name,
          isFile: true,
          isDirectory: false,
          depth: currentDepth,
        };
        continue;
      }

      if (!entry.isSymlink || !followSymlinks) continue;

      try {
        const stat = await adapter.fs.stat(fullPath);

        if (stat.isDirectory) {
          if (!recursive) continue;

          yield* walkDirectory({
            ...options,
            dir: fullPath,
            currentDepth: currentDepth + 1,
          });
          continue;
        }

        if (!stat.isFile) continue;
        if (!matchesFile(entry.name, extensions, patterns)) continue;

        yield {
          path: fullPath,
          name: entry.name,
          isFile: true,
          isDirectory: false,
          depth: currentDepth,
        };
      } catch {
        // Ignore broken symlinks
      }
    }
  } catch {
    // Silently skip missing/inaccessible directories
  }
}

export async function collectFiles(options: FileDiscoveryOptions): Promise<FileDiscoveryResult[]> {
  return await withSpan(
    "utils.collectFiles",
    async () => {
      const results: FileDiscoveryResult[] = [];
      for await (const file of discoverFiles(options)) results.push(file);
      return results;
    },
    {
      "discovery.baseDir": options.baseDir,
      "discovery.recursive": options.recursive ?? true,
      "discovery.extensions": options.extensions?.join(",") ?? "*",
    },
  );
}

export async function hasMatchingFiles(options: FileDiscoveryOptions): Promise<boolean> {
  return await withSpan(
    "utils.hasMatchingFiles",
    async () => {
      for await (const _file of discoverFiles(options)) return true;
      return false;
    },
    {
      "discovery.baseDir": options.baseDir,
      "discovery.patterns": options.patterns?.join(",") ?? "*",
    },
  );
}

export async function countFiles(options: FileDiscoveryOptions): Promise<number> {
  return await withSpan(
    "utils.countFiles",
    async () => {
      let count = 0;
      for await (const _file of discoverFiles(options)) count++;
      return count;
    },
    {
      "discovery.baseDir": options.baseDir,
    },
  );
}
