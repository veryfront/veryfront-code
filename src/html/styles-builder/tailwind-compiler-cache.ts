/**
 * Tailwind compiler LRU cache management.
 *
 * Manages a bounded cache of compiled Tailwind CSS compilers, keyed by the
 * processor, project, stylesheet, and exact candidate snapshot. Prevents
 * stateful build sessions from leaking candidates across CSS identities.
 *
 * The actual tailwindcss `compile()` call is routed through the
 * `CSSProcessor` extension contract (default implementation:
 * `@veryfront/ext-css-tailwind`). When no `CSSProcessor` is registered, the
 * compile path returns a no-op compiler that emits empty CSS and logs an
 * actionable install message.
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
import { hashCandidates, hashString } from "./css-identity.ts";
import { loadPlugin } from "./plugin-loader.ts";

const logger = serverLogger.component("tailwind");

type CssTailwindExtensionModule = {
  default: ExtensionFactory;
};

/**
 * LRU cache for Tailwind compilers, keyed by every compilation identity input.
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
const CSS_COMPILATION_IDENTITY_SCHEMA = "veryfront.css-compilation.v1";
const NOOP_PROCESSOR_IDENTITY = "veryfront.css-processor.none.v1";
const MAX_PROCESSOR_CACHE_IDENTITY_LENGTH = 256;

let tailwindBaseCSS: string | null = null;

registerCache("tailwind-compiler-cache", () => ({
  name: "tailwind-compiler-cache",
  entries: compilerCache.size,
  maxEntries: MAX_CACHED_COMPILERS,
}));

async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS) return tailwindBaseCSS;

  const url = getTailwindCSSUrl();
  logger.debug("Fetching base CSS", { url });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw NETWORK_ERROR.create({
        detail: `Failed to fetch Tailwind CSS: ${response.status} ${response.statusText}`,
      });
    }
    tailwindBaseCSS = await response.text();
  } catch (error) {
    logger.warn("Failed to fetch Tailwind base CSS, using empty fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    tailwindBaseCSS = "";
  }

  return tailwindBaseCSS;
}

async function resolveCSSProcessor(): Promise<CSSProcessor | undefined> {
  const registeredProcessor = tryResolveContract<CSSProcessor>("CSSProcessor");
  if (registeredProcessor) return registeredProcessor;

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
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return tryResolveContract<CSSProcessor>("CSSProcessor");
}

function createCSSCompilationCacheIdentity(processor: CSSProcessor | undefined): string {
  if (!processor) {
    return JSON.stringify([CSS_COMPILATION_IDENTITY_SCHEMA, NOOP_PROCESSOR_IDENTITY]);
  }

  const processorIdentity = processor.cacheIdentity;
  if (
    typeof processorIdentity !== "string" ||
    processorIdentity.length === 0 ||
    processorIdentity.length > MAX_PROCESSOR_CACHE_IDENTITY_LENGTH ||
    processorIdentity.trim() !== processorIdentity ||
    /\p{Cc}/u.test(processorIdentity)
  ) {
    throw new TypeError("Resolved CSSProcessor must declare a bounded stable cacheIdentity");
  }

  return JSON.stringify([
    CSS_COMPILATION_IDENTITY_SCHEMA,
    processorIdentity,
    getTailwindCSSUrl(),
  ]);
}

/** Identity of every processor and base-stylesheet input that can change emitted CSS. */
export async function getCSSCompilationCacheIdentity(): Promise<string> {
  return createCSSCompilationCacheIdentity(await resolveCSSProcessor());
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
  logger.debug("Evicted oldest compiler from cache", { hash: oldestKey });
}

export async function getCompiler(
  stylesheet: string,
  projectSlug: string | undefined,
  candidates: readonly string[],
): Promise<CSSCompiler> {
  // Tailwind v4's compile().build() is stateful and accumulates candidates.
  // Scope each compiler to the exact immutable candidate snapshot so a later
  // build cannot inherit utilities that are absent from its cache identity.
  const stylesheetHash = hashString(stylesheet);
  const projectIdentity = projectSlug ? hashString(projectSlug) : "shared";
  const candidatesHash = hashCandidates(new Set(candidates));
  const processor = await resolveCSSProcessor();
  const compilationIdentityHash = hashString(createCSSCompilationCacheIdentity(processor));
  const hash =
    `v4:${compilationIdentityHash}:${projectIdentity}:${stylesheetHash}:${candidatesHash}`;

  const cached = compilerCache.get(hash);
  if (cached) {
    logger.debug("Compiler cache hit", { hash, projectSlug });
    return cached.compiler;
  }

  logger.debug("Creating new compiler", { hash, projectSlug });

  if (!processor) {
    logger.warn(
      "No CSSProcessor extension registered — CSS output will be empty. Install it with: deno add @veryfront/ext-css-tailwind",
    );
    const noopCompiler: CSSCompiler = { build: () => "" };
    compilerCache.set(hash, {
      compiler: noopCompiler,
      createdAt: Date.now(),
      pluginCache: new Map(),
      pluginErrors: new Map(),
    });
    return noopCompiler;
  }

  const tailwindBase = await getTailwindBaseCSS();
  const pluginCache = new Map<string, unknown>();
  const pluginErrors = new Map<string, Error>();

  const newCompiler = await processor.compile(stylesheet, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (id === "tailwindcss") {
        return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
      }
      logger.debug("Unknown stylesheet import", { id });
      return Promise.resolve({ content: "", base: "/", path: "/" });
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
