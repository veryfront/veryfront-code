
import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";

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
  if (!extensions || extensions.length === 0) {
    return true;
  }
  return extensions.some((ext) => fileName.endsWith(ext));
}

function matchesPatterns(fileName: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => fileName.includes(pattern));
}

function shouldIgnore(name: string, ignorePatterns: string[] | undefined): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }
  return ignorePatterns.some((pattern) => name.includes(pattern));
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
    adapter = denoAdapter,
  } = options;

  yield* walkDirectory(
    baseDir,
    0,
    maxDepth,
    extensions,
    patterns,
    ignorePatterns,
    includeDirs,
    recursive,
    followSymlinks,
    adapter,
  );
}

async function* walkDirectory(
  dir: string,
  currentDepth: number,
  maxDepth: number,
  extensions: string[] | undefined,
  patterns: string[] | undefined,
  ignorePatterns: string[] | undefined,
  includeDirs: boolean,
  recursive: boolean,
  followSymlinks: boolean,
  adapter: RuntimeAdapter,
): AsyncGenerator<FileDiscoveryResult> {
  if (currentDepth > maxDepth) {
    return;
  }

  try {
    const entries = adapter.fs.readDir(dir);

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (shouldIgnore(entry.name, ignorePatterns)) {
        continue;
      }

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

        if (recursive) {
          yield* walkDirectory(
            fullPath,
            currentDepth + 1,
            maxDepth,
            extensions,
            patterns,
            ignorePatterns,
            includeDirs,
            recursive,
            followSymlinks,
            adapter,
          );
        }
      }
      else if (entry.isFile) {
        if (
          matchesExtensions(entry.name, extensions) &&
          matchesPatterns(entry.name, patterns)
        ) {
          yield {
            path: fullPath,
            name: entry.name,
            isFile: true,
            isDirectory: false,
            depth: currentDepth,
          };
        }
      }
      else if (entry.isSymlink && followSymlinks) {
        try {
          const stat = await adapter.fs.stat(fullPath);

          if (stat.isDirectory && recursive) {
            yield* walkDirectory(
              fullPath,
              currentDepth + 1,
              maxDepth,
              extensions,
              patterns,
              ignorePatterns,
              includeDirs,
              recursive,
              followSymlinks,
              adapter,
            );
          } else if (stat.isFile) {
            if (
              matchesExtensions(entry.name, extensions) &&
              matchesPatterns(entry.name, patterns)
            ) {
              yield {
                path: fullPath,
                name: entry.name,
                isFile: true,
                isDirectory: false,
                depth: currentDepth,
              };
            }
          }
        } catch {
        }
      }
    }
  } catch {
  }
}

export async function collectFiles(
  options: FileDiscoveryOptions,
): Promise<FileDiscoveryResult[]> {
  const results: FileDiscoveryResult[] = [];
  for await (const file of discoverFiles(options)) {
    results.push(file);
  }
  return results;
}

export async function hasMatchingFiles(
  options: FileDiscoveryOptions,
): Promise<boolean> {
  for await (const _file of discoverFiles(options)) {
    return true;
  }
  return false;
}

export async function countFiles(options: FileDiscoveryOptions): Promise<number> {
  let count = 0;
  for await (const _file of discoverFiles(options)) {
    count++;
  }
  return count;
}
