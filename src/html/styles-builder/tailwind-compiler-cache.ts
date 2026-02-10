/**
 * Tailwind compiler LRU cache management.
 *
 * Manages a bounded cache of compiled Tailwind CSS compilers, keyed by
 * stylesheet hash. Prevents race conditions when concurrent requests use
 * different stylesheets.
 *
 * @module html/styles-builder/tailwind-compiler-cache
 */

import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { hashString } from "./candidate-extractor.ts";
import { loadPlugin } from "./plugin-loader.ts";

/**
 * LRU cache for Tailwind compilers, keyed by stylesheet hash.
 * Each entry stores the compiler and its associated plugin state.
 */
interface CompilerCacheEntry {
  compiler: Awaited<ReturnType<typeof compile>>;
  createdAt: number;
  pluginCache: Map<string, unknown>;
  pluginErrors: Map<string, string>;
}

const compilerCache = new Map<string, CompilerCacheEntry>();
const MAX_CACHED_COMPILERS = 10;

let tailwindBaseCSS: string | null = null;

registerCache("tailwind-compiler-cache", () => ({
  name: "tailwind-compiler-cache",
  entries: compilerCache.size,
  maxEntries: MAX_CACHED_COMPILERS,
}));

async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS) return tailwindBaseCSS;

  const url = getTailwindCSSUrl();
  logger.debug("[tailwind] Fetching base CSS", { url });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Tailwind CSS: ${response.status} ${response.statusText}`);
  }

  tailwindBaseCSS = await response.text();
  return tailwindBaseCSS;
}

function evictOldestCompiler(): void {
  if (compilerCache.size < MAX_CACHED_COMPILERS) return;

  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of compilerCache) {
    if (entry.createdAt < oldestTime) {
      oldestTime = entry.createdAt;
      oldestKey = key;
    }
  }

  if (!oldestKey) return;

  compilerCache.delete(oldestKey);
  logger.debug("[tailwind] Evicted oldest compiler from cache", { hash: oldestKey });
}

export async function getCompiler(
  stylesheet: string,
): Promise<Awaited<ReturnType<typeof compile>>> {
  const hash = hashString(stylesheet);

  const cached = compilerCache.get(hash);
  if (cached) {
    logger.debug("[tailwind] Compiler cache hit", { hash });
    return cached.compiler;
  }

  logger.debug("[tailwind] Creating new compiler", { hash });

  const tailwindBase = await getTailwindBaseCSS();
  const pluginCache = new Map<string, unknown>();
  const pluginErrors = new Map<string, string>();

  const newCompiler = await compile(stylesheet, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (id === "tailwindcss") {
        return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
      }
      logger.debug("[tailwind] Unknown stylesheet import", { id });
      return Promise.resolve({ content: "", base: "/", path: "/" });
    },
    loadModule: async (id: string) => {
      const loaded = await loadPlugin(id, pluginCache, pluginErrors);
      if (!loaded) throw new Error(`Failed to load plugin "${id}": plugin not installed`);
      // deno-lint-ignore no-explicit-any
      return { module: loaded as any, base: "/", path: "/" };
    },
  });

  evictOldestCompiler();

  compilerCache.set(hash, {
    compiler: newCompiler,
    createdAt: Date.now(),
    pluginCache,
    pluginErrors,
  });

  return newCompiler;
}

export function invalidateCompiler(): void {
  compilerCache.clear();
  logger.debug("[tailwind] All compilers invalidated");
}

/**
 * Get compiler cache statistics for monitoring.
 */
export function getCompilerCacheStats(): {
  size: number;
  maxSize: number;
  entries: Array<{ hash: string; createdAt: number; pluginCount: number }>;
} {
  const entries = Array.from(compilerCache.entries()).map(([hash, entry]) => ({
    hash,
    createdAt: entry.createdAt,
    pluginCount: entry.pluginCache.size,
  }));

  return { size: compilerCache.size, maxSize: MAX_CACHED_COMPILERS, entries };
}

export function clearPluginCache(id?: string): void {
  if (id) {
    for (const entry of compilerCache.values()) {
      entry.pluginCache.delete(id);
      entry.pluginErrors.delete(id);
    }
    return;
  }

  for (const entry of compilerCache.values()) {
    entry.pluginCache.clear();
    entry.pluginErrors.clear();
  }
}
