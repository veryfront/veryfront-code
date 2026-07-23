/****
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */

import { join } from "#veryfront/compat/path/index.ts";
import type { DirEntry, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
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

interface FileDiscoveryOptions {
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

interface FileDiscoveryResult {
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

/**
 * Match a glob against one directory-entry name without compiling caller input
 * as a regular expression. `*` matches zero or more characters and `?`
 * matches exactly one character; every other character is literal.
 */
function matchesEntryGlob(name: string, pattern: string): boolean {
  const nameTokens = [...name];
  let previous = new Uint8Array(nameTokens.length + 1);
  previous[0] = 1;

  for (const token of pattern) {
    const current = new Uint8Array(nameTokens.length + 1);
    if (token === "*") {
      current[0] = previous[0] ?? 0;
      for (let index = 1; index <= nameTokens.length; index++) {
        current[index] = (previous[index] || current[index - 1]) ? 1 : 0;
      }
    } else {
      for (let index = 1; index <= nameTokens.length; index++) {
        if (previous[index - 1] && (token === "?" || token === nameTokens[index - 1])) {
          current[index] = 1;
        }
      }
    }
    previous = current;
  }

  return previous[nameTokens.length] === 1;
}

function shouldIgnore(name: string, ignorePatterns: string[] | undefined): boolean {
  if (!ignorePatterns?.length) return false;
  return ignorePatterns.some((pattern) =>
    pattern.includes("*") || pattern.includes("?")
      ? matchesEntryGlob(name, pattern)
      : name.includes(pattern)
  );
}

function normalizePhysicalPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized || "/";
}

function isWithinPhysicalDirectory(baseDir: string, target: string): boolean {
  const base = normalizePhysicalPath(baseDir);
  const candidate = normalizePhysicalPath(target);
  return base === "/"
    ? candidate.startsWith("/")
    : candidate === base || candidate.startsWith(`${base}/`);
}

function matchesFile(
  entryName: string,
  extensions: string[] | undefined,
  patterns: string[] | undefined,
): boolean {
  return matchesExtensions(entryName, extensions) && matchesPatterns(entryName, patterns);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === code;
}

function isNotFoundError(error: unknown): boolean {
  if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "NotFound" || error.name === "NotFoundError";
}

async function* readDirectoryEntries(
  adapter: RuntimeAdapter,
  dir: string,
): AsyncIterable<DirEntry> {
  try {
    for await (const entry of adapter.fs.readDir(dir)) yield entry;
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
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

  if (
    maxDepth !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxDepth) || maxDepth < 0)
  ) {
    throw new RangeError("File discovery maxDepth must be a non-negative integer or Infinity");
  }

  const runtimeAdapter = adapter ?? (await getDefaultAdapter());
  let physicalBaseDir: string | undefined;
  if (followSymlinks) {
    if (typeof runtimeAdapter.fs.realPath !== "function") {
      throw new Error("File discovery requires adapter.fs.realPath when following symlinks");
    }
    try {
      physicalBaseDir = await runtimeAdapter.fs.realPath(baseDir);
    } catch (error) {
      if (isNotFoundError(error) || hasErrorCode(error, "ELOOP")) return;
      throw error;
    }
  }

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
    physicalBaseDir,
    visitedDirectories: new Set<string>(),
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
  physicalBaseDir: string | undefined;
  visitedDirectories: Set<string>;
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
    physicalBaseDir,
    visitedDirectories,
  } = options;

  if (currentDepth > maxDepth) return;

  if (followSymlinks) {
    let physicalDir: string;
    try {
      physicalDir = await adapter.fs.realPath!(dir);
    } catch (error) {
      if (isNotFoundError(error) || hasErrorCode(error, "ELOOP")) return;
      throw error;
    }

    if (!physicalBaseDir || !isWithinPhysicalDirectory(physicalBaseDir, physicalDir)) return;
    if (visitedDirectories.has(physicalDir)) return;
    visitedDirectories.add(physicalDir);
  }

  for await (const entry of readDirectoryEntries(adapter, dir)) {
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
      const physicalTarget = await adapter.fs.realPath!(fullPath);
      if (!physicalBaseDir || !isWithinPhysicalDirectory(physicalBaseDir, physicalTarget)) continue;
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
    } catch (error) {
      if (isNotFoundError(error) || hasErrorCode(error, "ELOOP")) continue;
      throw error;
    }
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
