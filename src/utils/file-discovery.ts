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
import { serverLogger } from "./logger/index.ts";

const logger = serverLogger.component("file-discovery");

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
  return patterns.some((pattern) => matchesEntryPattern(fileName, pattern));
}

/**
 * Match a glob against one directory-entry name without compiling caller input
 * as a regular expression. `*` matches zero or more characters and `?`
 * matches exactly one character; every other character is literal.
 */
function matchesEntryGlob(name: string, pattern: string): boolean {
  const nameTokens = [...name];
  const patternTokens = [...pattern];
  let nameIndex = 0;
  let patternIndex = 0;
  let lastStarIndex = -1;
  let lastStarMatchIndex = -1;

  while (nameIndex < nameTokens.length) {
    const token = patternTokens[patternIndex];
    if (token === "?" || token === nameTokens[nameIndex]) {
      nameIndex++;
      patternIndex++;
      continue;
    }

    if (token === "*") {
      lastStarIndex = patternIndex++;
      lastStarMatchIndex = nameIndex;
      continue;
    }

    if (lastStarIndex === -1) return false;
    patternIndex = lastStarIndex + 1;
    nameIndex = ++lastStarMatchIndex;
  }

  while (patternTokens[patternIndex] === "*") patternIndex++;
  return patternIndex === patternTokens.length;
}

const warnedPathShapedPatterns = new Set<string>();

// Normalize a caller pattern to entry-name form. Patterns are matched against
// one directory-entry name, so a leading "**/" (match at any depth) is
// redundant and stripped: "**/*.ts" means "*.ts at any depth", which is
// exactly what entry-name matching during the recursive walk provides. Any
// other path-shaped pattern (containing "/") can never match a bare entry
// name; returning undefined disables it, after warning once so the
// misconfiguration is visible instead of silently matching nothing.
function toEntryPattern(pattern: string): string | undefined {
  let entryPattern = pattern;
  while (entryPattern.startsWith("**/") || entryPattern.startsWith("**\\")) {
    entryPattern = entryPattern.slice(3);
  }

  if (
    entryPattern.length > 0 &&
    !entryPattern.includes("/") &&
    !entryPattern.includes("\\")
  ) {
    return entryPattern;
  }

  if (!warnedPathShapedPatterns.has(pattern) && warnedPathShapedPatterns.size < 1000) {
    warnedPathShapedPatterns.add(pattern);
    logger.warn(
      "File discovery patterns match single directory-entry names; an empty or path-shaped pattern is ignored",
      { pattern },
    );
  }
  return undefined;
}

function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function matchesNormalizedEntryPattern(name: string, entryPattern: string): boolean {
  return isGlobPattern(entryPattern)
    ? matchesEntryGlob(name, entryPattern)
    : name.includes(entryPattern);
}

function matchesEntryPattern(name: string, pattern: string): boolean {
  const entryPattern = toEntryPattern(pattern);
  if (entryPattern === undefined) return false;
  return matchesNormalizedEntryPattern(name, entryPattern);
}

function shouldIgnore(
  name: string,
  ignorePatterns: string[] | undefined,
  isDirectory: boolean,
): boolean {
  if (!ignorePatterns?.length) return false;
  return ignorePatterns.some((pattern) => {
    const entryPattern = toEntryPattern(pattern);
    if (entryPattern === undefined) return false;
    // Glob ignores (e.g. `*.test.*`) describe file names; matching them
    // against directory names would silently prune entire subtrees (a
    // directory named `fixtures.test.data` would vanish). Subtree pruning is
    // reserved for directory-name patterns like `node_modules` or `.git`.
    if (isDirectory && isGlobPattern(entryPattern)) return false;
    return matchesNormalizedEntryPattern(name, entryPattern);
  });
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
      if (shouldIgnore(entry.name, ignorePatterns, entry.isDirectory)) continue;

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
      } catch (_) {
        /* expected: broken symlinks cannot be stat'd */
      }
    }
  } catch (_) {
    /* expected: directory may be missing or inaccessible */
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
