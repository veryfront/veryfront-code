/**
 * Tailwind compiler LRU cache management.
 *
 * Manages a bounded cache of compiled Tailwind CSS compilers, keyed by
 * stylesheet hash. Prevents race conditions when concurrent requests use
 * different stylesheets.
 *
 * The actual tailwindcss `compile()` call is routed through the
 * `CSSProcessor` extension contract (default implementation:
 * `@veryfront/ext-css-tailwind`). When no `CSSProcessor` is registered, the
 * compile path fails with an actionable dependency error.
 *
 * @module html/styles-builder/tailwind-compiler-cache
 */

import {
  register as registerContract,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import type { ExtensionFactory } from "veryfront/extensions";
import type { CSSCompiler, CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { serverLogger } from "#veryfront/utils";
import { DEPENDENCY_MISSING, INITIALIZATION_ERROR, NETWORK_ERROR } from "#veryfront/errors";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { hashString } from "./candidate-extractor.ts";
import { loadPlugin } from "./plugin-loader.ts";
import { readResponseTextWithinLimit } from "./bounded-response-reader.ts";

const logger = serverLogger.component("tailwind");

type CssTailwindExtensionModule = {
  default: ExtensionFactory;
};

/**
 * LRU cache for Tailwind compilers, keyed by stylesheet hash.
 * Each entry stores the compiler and its associated plugin state.
 */
interface CompilerCacheEntry {
  compiler: CSSCompiler;
  createdAt: number;
  pluginCache: Map<string, unknown>;
  pluginErrors: Map<string, Error>;
}

const compilerCache = new Map<string, CompilerCacheEntry>();
const MAX_CACHED_COMPILERS = 10;
const MAX_PENDING_COMPILERS = 16;
const MAX_TAILWIND_BASE_CSS_BYTES = 4 * 1024 * 1024;
const TAILWIND_BASE_CSS_TIMEOUT_MS = 15_000;

let tailwindBaseCSS: string | null = null;
let tailwindBaseCSSPromise: Promise<string> | null = null;
let tailwindBaseCSSAbortController: AbortController | null = null;
let cssProcessorResolutionPromise: Promise<CSSProcessor | undefined> | null = null;
let cacheGeneration = 0;
const pendingCompilers = new Map<string, Promise<CSSCompiler>>();

registerCache("tailwind-compiler-cache", () => ({
  name: "tailwind-compiler-cache",
  entries: compilerCache.size,
  maxEntries: MAX_CACHED_COMPILERS,
}));

async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS !== null) return tailwindBaseCSS;
  if (tailwindBaseCSSPromise) return await tailwindBaseCSSPromise;

  const url = getTailwindCSSUrl();
  const generation = cacheGeneration;
  const request = (async () => {
    const controller = new AbortController();
    tailwindBaseCSSAbortController = controller;
    const timeout = setTimeout(() => controller.abort(), TAILWIND_BASE_CSS_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw NETWORK_ERROR.create({
          detail: `Tailwind base stylesheet request failed with status ${response.status}`,
        });
      }

      const css = await readResponseTextWithinLimit(
        response,
        MAX_TAILWIND_BASE_CSS_BYTES,
        () =>
          NETWORK_ERROR.create({
            detail: "Tailwind base stylesheet exceeded the size limit",
          }),
      );
      if (css.length === 0) {
        throw NETWORK_ERROR.create({
          detail: "Tailwind base stylesheet response was empty",
        });
      }

      if (generation === cacheGeneration) tailwindBaseCSS = css;
      return css;
    } catch (error) {
      logger.warn("Failed to fetch Tailwind base stylesheet", {
        error: errorName(error),
      });
      if (
        error instanceof Error &&
        (error.message.includes("Tailwind base stylesheet") ||
          error.message.includes("size limit"))
      ) {
        throw error;
      }
      throw NETWORK_ERROR.create({ detail: "Failed to fetch Tailwind base stylesheet" });
    } finally {
      clearTimeout(timeout);
      if (tailwindBaseCSSAbortController === controller) {
        tailwindBaseCSSAbortController = null;
      }
    }
  })();

  tailwindBaseCSSPromise = request;
  try {
    return await request;
  } finally {
    if (tailwindBaseCSSPromise === request) tailwindBaseCSSPromise = null;
  }
}

async function resolveCSSProcessor(): Promise<CSSProcessor | undefined> {
  const registeredProcessor = tryResolveContract<CSSProcessor>("CSSProcessor");
  if (registeredProcessor) return registeredProcessor;
  if (cssProcessorResolutionPromise) return await cssProcessorResolutionPromise;

  const resolution = (async () => {
    try {
      const { default: createTailwindExtension } = await importFirstPartyExtensionModule<
        CssTailwindExtensionModule
      >(
        "ext-css-tailwind",
        "@veryfront/ext-css-tailwind",
      );
      const extension = createTailwindExtension();
      await extension.setup?.({
        config: {},
        logger,
        provide: (name: string, impl: unknown) => registerContract(name, impl),
        get: () => undefined,
        require: <T>(name: string): T => {
          const contract = tryResolveContract<T>(name);
          if (contract === undefined) {
            throw INITIALIZATION_ERROR.create({
              detail: `Missing required extension contract: ${name}`,
            });
          }
          return contract;
        },
      });
    } catch (error) {
      logger.warn("Failed to register built-in CSSProcessor extension", {
        error: errorName(error),
      });
    }

    return tryResolveContract<CSSProcessor>("CSSProcessor");
  })();

  cssProcessorResolutionPromise = resolution;
  try {
    return await resolution;
  } finally {
    if (cssProcessorResolutionPromise === resolution) cssProcessorResolutionPromise = null;
  }
}

function evictOldestCompiler(): void {
  if (compilerCache.size < MAX_CACHED_COMPILERS) return;

  const oldestKey = compilerCache.keys().next().value;
  if (typeof oldestKey !== "string") return;
  compilerCache.delete(oldestKey);
  logger.debug("Evicted least recently used compiler");
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function compilerCacheKey(
  stylesheet: string,
  projectSlug?: string,
  candidateScopeHash?: string,
): string {
  const stylesheetHash = hashString(stylesheet);
  return hashString(
    JSON.stringify({
      stylesheetHash,
      projectSlug: projectSlug ?? null,
      candidateScopeHash: candidateScopeHash ?? null,
    }),
  );
}

async function createCompiler(stylesheet: string): Promise<{
  compiler: CSSCompiler;
  pluginCache: Map<string, unknown>;
  pluginErrors: Map<string, Error>;
}> {
  const processor = await resolveCSSProcessor();
  if (!processor) {
    throw DEPENDENCY_MISSING.create({
      detail:
        "No CSSProcessor extension is available. Install it with: deno add @veryfront/ext-css-tailwind",
    });
  }

  const tailwindBase = await getTailwindBaseCSS();
  const pluginCache = new Map<string, unknown>();
  const pluginErrors = new Map<string, Error>();
  const compiler = await processor.compile(stylesheet, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (id === "tailwindcss") {
        return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
      }
      throw DEPENDENCY_MISSING.create({ detail: "Unsupported stylesheet import" });
    },
    loadModule: async (id: string) => {
      const loaded = await loadPlugin(id, pluginCache, pluginErrors);
      if (!loaded) {
        throw DEPENDENCY_MISSING.create({
          detail: `Failed to load plugin "${id}": plugin not installed`,
        });
      }
      return { module: loaded, base: "/", path: "/" };
    },
  });

  return { compiler, pluginCache, pluginErrors };
}

export async function getCompiler(
  stylesheet: string,
  projectSlug?: string,
  candidateScopeHash?: string,
): Promise<CSSCompiler> {
  // Tailwind v4's compile().build() is stateful. It accumulates candidates
  // across calls. Without per-project isolation, projects sharing the same
  // stylesheet on the shared pool contaminate each other's CSS output.
  const hash = compilerCacheKey(stylesheet, projectSlug, candidateScopeHash);

  const cached = compilerCache.get(hash);
  if (cached) {
    compilerCache.delete(hash);
    compilerCache.set(hash, cached);
    logger.debug("Compiler cache hit");
    return cached.compiler;
  }

  const generation = cacheGeneration;
  const pendingKey = `${generation}:${hash}`;
  const pending = pendingCompilers.get(pendingKey);
  if (pending) return await pending;
  if (pendingCompilers.size >= MAX_PENDING_COMPILERS) {
    throw INITIALIZATION_ERROR.create({
      detail: "Too many concurrent CSS compiler initializations",
    });
  }

  logger.debug("Creating new compiler");
  const creation = (async () => {
    const { compiler, pluginCache, pluginErrors } = await createCompiler(stylesheet);
    if (generation === cacheGeneration) {
      evictOldestCompiler();
      compilerCache.set(hash, {
        compiler,
        createdAt: Date.now(),
        pluginCache,
        pluginErrors,
      });
    }
    return compiler;
  })();

  pendingCompilers.set(pendingKey, creation);
  try {
    return await creation;
  } finally {
    if (pendingCompilers.get(pendingKey) === creation) pendingCompilers.delete(pendingKey);
  }
}

export function invalidateCompiler(): void {
  cacheGeneration++;
  compilerCache.clear();
  tailwindBaseCSSAbortController?.abort();
  tailwindBaseCSSAbortController = null;
  tailwindBaseCSS = null;
  tailwindBaseCSSPromise = null;
  logger.debug("All compilers invalidated");
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
