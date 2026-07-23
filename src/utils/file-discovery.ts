/****
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */

import { isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";

const DEFAULT_MAX_DEPTH = 64;
const MAX_FILTER_COUNT = 128;
const MAX_FILTER_LENGTH = 256;
const MAX_ENTRY_NAME_LENGTH = 1024;

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

interface FileDiscoveryOptions {
  baseDir: string;
  extensions?: readonly string[];
  patterns?: readonly string[];
  recursive?: boolean;
  maxDepth?: number;
  ignorePatterns?: readonly string[];
  includeDirs?: boolean;
  followSymlinks?: boolean;
  adapter?: RuntimeAdapter;
}

interface FileDiscoveryResult {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  depth: number;
}

interface SnapshotFileDiscoveryOptions {
  baseDir: string;
  extensions: readonly string[] | undefined;
  patterns: readonly string[] | undefined;
  recursive: boolean;
  maxDepth: number;
  ignorePatterns: readonly string[] | undefined;
  includeDirs: boolean;
  followSymlinks: boolean;
  adapter: RuntimeAdapter | undefined;
}

function invalidDiscoveryArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message, detail: message });
}

function snapshotStringList(name: string, value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_FILTER_COUNT) {
    invalidDiscoveryArgument(`${name} must be an array with at most ${MAX_FILTER_COUNT} entries`);
  }

  const snapshot: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_FILTER_LENGTH) {
      invalidDiscoveryArgument(
        `${name} entries must be non-empty strings no longer than ${MAX_FILTER_LENGTH} characters`,
      );
    }
    snapshot.push(item);
  }
  return Object.freeze(snapshot);
}

function snapshotDiscoveryOptions(options: FileDiscoveryOptions): SnapshotFileDiscoveryOptions {
  let baseDir: unknown;
  let extensions: unknown;
  let patterns: unknown;
  let recursive: unknown;
  let maxDepth: unknown;
  let ignorePatterns: unknown;
  let includeDirs: unknown;
  let followSymlinks: unknown;
  let adapter: RuntimeAdapter | undefined;

  try {
    baseDir = options.baseDir;
    extensions = options.extensions;
    patterns = options.patterns;
    recursive = options.recursive ?? true;
    maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    ignorePatterns = options.ignorePatterns;
    includeDirs = options.includeDirs ?? false;
    followSymlinks = options.followSymlinks ?? false;
    adapter = options.adapter;
  } catch {
    invalidDiscoveryArgument("File discovery options could not be read");
  }

  if (typeof baseDir !== "string" || baseDir.length === 0) {
    invalidDiscoveryArgument("baseDir must be a non-empty string");
  }
  if (
    typeof recursive !== "boolean" || typeof includeDirs !== "boolean" ||
    typeof followSymlinks !== "boolean"
  ) {
    invalidDiscoveryArgument("File discovery flags must be booleans");
  }
  if (typeof maxDepth !== "number" || !Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    invalidDiscoveryArgument("maxDepth must be a non-negative integer");
  }

  return {
    baseDir,
    extensions: snapshotStringList("extensions", extensions),
    patterns: snapshotStringList("patterns", patterns),
    recursive,
    maxDepth,
    ignorePatterns: snapshotStringList("ignorePatterns", ignorePatterns),
    includeDirs,
    followSymlinks,
    adapter,
  };
}

function matchesExtensions(fileName: string, extensions: readonly string[] | undefined): boolean {
  if (!extensions?.length) return true;
  return extensions.some((ext) => fileName.endsWith(ext));
}

function matchesPatterns(fileName: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns?.length) return true;
  return patterns.some((pattern) => fileName.includes(pattern));
}

function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`).test(value);
}

function shouldIgnore(name: string, ignorePatterns: readonly string[] | undefined): boolean {
  if (!ignorePatterns?.length) return false;
  return ignorePatterns.some((pattern) =>
    pattern.includes("*") || pattern.includes("?")
      ? matchesGlob(name, pattern)
      : name.includes(pattern)
  );
}

function matchesFile(
  entryName: string,
  extensions: readonly string[] | undefined,
  patterns: readonly string[] | undefined,
): boolean {
  return matchesExtensions(entryName, extensions) && matchesPatterns(entryName, patterns);
}

export function discoverFiles(options: FileDiscoveryOptions): AsyncGenerator<FileDiscoveryResult> {
  return discoverFilesFromSnapshot(snapshotDiscoveryOptions(options));
}

async function* discoverFilesFromSnapshot(
  options: SnapshotFileDiscoveryOptions,
): AsyncGenerator<FileDiscoveryResult> {
  const runtimeAdapter = options.adapter ?? (await getDefaultAdapter());
  let canonicalRoot: string | undefined;
  const visitedCanonicalPaths = new Set<string>();

  if (options.followSymlinks && !runtimeAdapter.fs.realPath) {
    invalidDiscoveryArgument(
      "followSymlinks requires a filesystem adapter with canonical path support",
    );
  }

  if (options.followSymlinks && runtimeAdapter.fs.realPath) {
    try {
      canonicalRoot = await runtimeAdapter.fs.realPath(options.baseDir);
      visitedCanonicalPaths.add(canonicalRoot);
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }

  yield* walkDirectory({
    dir: options.baseDir,
    currentDepth: 0,
    maxDepth: options.maxDepth,
    extensions: options.extensions,
    patterns: options.patterns,
    ignorePatterns: options.ignorePatterns,
    includeDirs: options.includeDirs,
    recursive: options.recursive,
    followSymlinks: options.followSymlinks,
    adapter: runtimeAdapter,
    canonicalRoot,
    visitedCanonicalPaths,
  });
}

interface WalkDirectoryOptions {
  dir: string;
  currentDepth: number;
  maxDepth: number;
  extensions: readonly string[] | undefined;
  patterns: readonly string[] | undefined;
  ignorePatterns: readonly string[] | undefined;
  includeDirs: boolean;
  recursive: boolean;
  followSymlinks: boolean;
  adapter: RuntimeAdapter;
  canonicalRoot: string | undefined;
  visitedCanonicalPaths: Set<string>;
}

function validateEntryName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" || name.length === 0 || name.length > MAX_ENTRY_NAME_LENGTH ||
    name === "." || name === ".." || name.includes("/") || name.includes("\\") ||
    name.includes("\0")
  ) {
    invalidDiscoveryArgument("Filesystem entries must use a single valid path segment");
  }
}

function isWithinCanonicalRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\"));
}

async function shouldVisitCanonicalPath(
  path: string,
  options: WalkDirectoryOptions,
): Promise<boolean> {
  const realPath = options.adapter.fs.realPath;
  if (!realPath || !options.canonicalRoot) {
    invalidDiscoveryArgument(
      "followSymlinks requires a filesystem adapter with canonical path support",
    );
  }

  const canonicalPath = await realPath.call(options.adapter.fs, path);
  if (!isWithinCanonicalRoot(options.canonicalRoot, canonicalPath)) return false;
  if (options.visitedCanonicalPaths.has(canonicalPath)) return false;
  options.visitedCanonicalPaths.add(canonicalPath);
  return true;
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
      validateEntryName(entry.name);
      if (shouldIgnore(entry.name, ignorePatterns)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isSymlink) {
        if (!followSymlinks) continue;

        try {
          const stat = await adapter.fs.stat(fullPath);
          if (!stat.isDirectory && !stat.isFile) continue;
          if (!(await shouldVisitCanonicalPath(fullPath, options))) continue;

          if (stat.isDirectory) {
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

          if (!matchesFile(entry.name, extensions, patterns)) continue;
          yield {
            path: fullPath,
            name: entry.name,
            isFile: true,
            isDirectory: false,
            depth: currentDepth,
          };
        } catch (error) {
          if (isNotFoundError(error)) continue;
          throw error;
        }
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

        if (!recursive) continue;

        if (followSymlinks && !(await shouldVisitCanonicalPath(fullPath, options))) continue;

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

      invalidDiscoveryArgument("Filesystem entries must identify one supported entry type");
    }
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

export async function collectFiles(options: FileDiscoveryOptions): Promise<FileDiscoveryResult[]> {
  const snapshot = snapshotDiscoveryOptions(options);
  return await withSpan(
    "utils.collectFiles",
    async () => {
      const results: FileDiscoveryResult[] = [];
      for await (const file of discoverFilesFromSnapshot(snapshot)) results.push(file);
      return results;
    },
    {
      "discovery.recursive": snapshot.recursive,
      "discovery.extensionCount": snapshot.extensions?.length ?? 0,
      "discovery.followSymlinks": snapshot.followSymlinks,
    },
  );
}

export async function hasMatchingFiles(options: FileDiscoveryOptions): Promise<boolean> {
  const snapshot = snapshotDiscoveryOptions(options);
  return await withSpan(
    "utils.hasMatchingFiles",
    async () => {
      for await (const _file of discoverFilesFromSnapshot(snapshot)) return true;
      return false;
    },
    {
      "discovery.recursive": snapshot.recursive,
      "discovery.patternCount": snapshot.patterns?.length ?? 0,
    },
  );
}

export async function countFiles(options: FileDiscoveryOptions): Promise<number> {
  const snapshot = snapshotDiscoveryOptions(options);
  return await withSpan(
    "utils.countFiles",
    async () => {
      let count = 0;
      for await (const _file of discoverFilesFromSnapshot(snapshot)) count++;
      return count;
    },
    {
      "discovery.recursive": snapshot.recursive,
    },
  );
}
