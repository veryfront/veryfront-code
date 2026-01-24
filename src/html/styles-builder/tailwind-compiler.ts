import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import {
  type CacheBackend,
  CacheBackends,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";

export interface TailwindResult {
  css: string;
  error?: string;
}

export interface GenerateOptions {
  minify?: boolean;
}

export interface CSSErrorInfo {
  title: string;
  message: string;
  suggestion: string;
}

let tailwindBaseCSS: string | null = null;
let compiler: Awaited<ReturnType<typeof compile>> | null = null;
let lastStylesheetHash = "";

const pluginCache = new Map<string, unknown>();
const pluginErrors = new Map<string, string>();

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;
const CSS_CACHE_TTL_SECONDS = 3600;

const localCssCache = new Map<string, string>();
const LOCAL_CACHE_MAX_SIZE = 100;

// Project-level CSS cache - uses distributed backend (API/Redis)
const PROJECT_CSS_CACHE_TTL_SECONDS = CSS_CACHE_TTL_SECONDS;
const PROJECT_CSS_LOCAL_FALLBACK_MAX = 50;

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;
const projectCSSLocalFallback = new Map<string, ProjectCSSCacheEntry>();

registerCache("project-css-cache", () => ({
  name: "project-css-cache",
  entries: projectCSSLocalFallback.size,
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  backend: projectCSSBackend?.type ?? "uninitialized",
}));

interface ProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

/**
 * Initialize project CSS distributed cache.
 * Call this at server startup alongside other distributed caches.
 *
 * @returns true if distributed backend was successfully initialized
 */
export async function initializeProjectCSSCache(): Promise<boolean> {
  if (projectCSSInitialized) {
    return projectCSSBackend?.type !== "memory";
  }

  if (!projectCSSInitPromise) {
    projectCSSInitPromise = (async () => {
      try {
        projectCSSBackend = await CacheBackends.projectCSS();
        logger.info("[ProjectCSSCache] Initialized", { backend: projectCSSBackend.type });
      } catch (error) {
        logger.warn("[ProjectCSSCache] Backend init failed, using memory", { error });
        projectCSSBackend = new MemoryCacheBackend(100);
      } finally {
        projectCSSInitialized = true;
      }
    })();
  }

  await projectCSSInitPromise;
  projectCSSInitPromise = null;

  return projectCSSBackend?.type !== "memory";
}

/**
 * Check if distributed project CSS cache is enabled.
 */
export function isProjectCSSCacheDistributed(): boolean {
  return projectCSSBackend?.type !== "memory" && projectCSSBackend !== null;
}

export async function getProjectCSS(
  projectSlug: string,
  stylesheet: string | undefined,
  candidates: Set<string>,
  options?: GenerateOptions,
): Promise<{ css: string; hash: string; fromCache: boolean }> {
  const stylesheetHash = hashString(stylesheet ?? DEFAULT_STYLESHEET);
  const candidatesHash = hashCandidates(candidates);
  const cacheKey = `${projectSlug}:${stylesheetHash}`;

  // 1. Try local fallback first (fastest)
  const localCached = projectCSSLocalFallback.get(cacheKey);
  if (localCached) {
    if (localCached.candidatesHash === candidatesHash) {
      logger.debug("[tailwind] Project CSS cache hit (local)", {
        projectSlug,
        hash: localCached.hash,
      });
      await cacheCSSAsync(localCached.css, localCached.hash);
      return { css: localCached.css, hash: localCached.hash, fromCache: true };
    }

    // Candidates changed; drop local entry
    projectCSSLocalFallback.delete(cacheKey);
  }

  if (!projectCSSInitialized) {
    await initializeProjectCSSCache();
  }

  // Try distributed cache (API/Redis)
  if (projectCSSBackend) {
    try {
      const raw = await projectCSSBackend.get(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as ProjectCSSCacheEntry;
        // Validate candidates hash matches (files may have changed)
        if (entry.candidatesHash === candidatesHash) {
          logger.debug("[tailwind] Project CSS cache hit (distributed)", {
            projectSlug,
            hash: entry.hash,
          });
          setProjectCSSLocalFallback(cacheKey, entry);
          await cacheCSSAsync(entry.css, entry.hash);
          return { css: entry.css, hash: entry.hash, fromCache: true };
        }
        logger.debug("[tailwind] Project CSS cache miss (candidates changed)", {
          projectSlug,
          cachedCandidatesHash: entry.candidatesHash,
          currentCandidatesHash: candidatesHash,
        });
      }
    } catch (error) {
      logger.debug("[tailwind] Failed to read from project CSS cache", { cacheKey, error });
    }
  }

  // Generate CSS (cache miss)
  const result = await generateTailwindCSS(stylesheet, candidates, options);

  if (result.error) {
    logger.error("[tailwind] Project CSS generation failed", { projectSlug, error: result.error });
    return { css: result.css, hash: "", fromCache: false };
  }

  const hash = hashCSS(result.css);
  const entry: ProjectCSSCacheEntry = { css: result.css, hash, candidatesHash };

  // Store in distributed cache
  if (projectCSSBackend) {
    projectCSSBackend.set(cacheKey, JSON.stringify(entry), PROJECT_CSS_CACHE_TTL_SECONDS).catch(
      (error) => {
        logger.debug("[tailwind] Failed to store in project CSS cache", { cacheKey, error });
      },
    );
  }

  // Also store in per-hash cache for getCSSByHash lookups
  setProjectCSSLocalFallback(cacheKey, entry);
  await cacheCSSAsync(result.css, hash);

  logger.debug("[tailwind] Project CSS generated", {
    projectSlug,
    hash,
    cssLength: result.css.length,
    candidateCount: candidates.size,
  });

  return { css: result.css, hash, fromCache: false };
}

/**
 * Hash candidates set to detect when Tailwind classes change.
 * Uses sorted array to ensure consistent hash regardless of Set iteration order.
 */
function hashCandidates(candidates: Set<string>): string {
  return hashString(Array.from(candidates).sort().join(","));
}

/**
 * Invalidate project CSS cache for a specific project.
 */
export function invalidateProjectCSS(projectSlug: string): void {
  // Clear local fallback
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      projectCSSLocalFallback.delete(key);
    }
  }

  // Fire off async cache clear (non-blocking)
  invalidateProjectCSSAsync(projectSlug).catch((error) => {
    logger.debug("[tailwind] Failed to invalidate project CSS cache", { projectSlug, error });
  });
}

/**
 * Invalidate project CSS cache for a specific project (async version).
 */
export async function invalidateProjectCSSAsync(projectSlug: string): Promise<void> {
  if (!projectCSSBackend?.delByPattern) return;

  try {
    const deleted = await projectCSSBackend.delByPattern(`${projectSlug}:*`);
    logger.debug("[tailwind] Cleared project CSS cache", { projectSlug, deleted });
  } catch (error) {
    logger.debug("[tailwind] Failed to clear project CSS cache", { projectSlug, error });
  }
}

function setProjectCSSLocalFallback(key: string, entry: ProjectCSSCacheEntry): void {
  projectCSSLocalFallback.set(key, entry);
  if (projectCSSLocalFallback.size > PROJECT_CSS_LOCAL_FALLBACK_MAX) {
    pruneProjectCSSLocalFallback();
  }
}

function pruneProjectCSSLocalFallback(): void {
  const excess = projectCSSLocalFallback.size - PROJECT_CSS_LOCAL_FALLBACK_MAX;
  if (excess <= 0) return;

  const keys = projectCSSLocalFallback.keys();
  for (let i = 0; i < excess; i++) {
    const result = keys.next();
    if (result.done) break;
    projectCSSLocalFallback.delete(result.value);
  }
}

const DEFAULT_STYLESHEET = `@import "tailwindcss";`;

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function hashCSS(css: string): string {
  return hashString(css).slice(0, 8);
}

function storeInLocalCache(hash: string, css: string): void {
  if (localCssCache.has(hash)) return;

  if (localCssCache.size >= LOCAL_CACHE_MAX_SIZE) {
    const firstKey = localCssCache.keys().next().value as string | undefined;
    if (firstKey) localCssCache.delete(firstKey);
  }

  localCssCache.set(hash, css);
}

function touchLocalCache(hash: string, css: string): void {
  localCssCache.delete(hash);
  localCssCache.set(hash, css);
}

function getCssCache(): Promise<CacheBackend> {
  if (cssCache) return Promise.resolve(cssCache);
  if (cssCacheInitPromise) return cssCacheInitPromise;

  cssCacheInitPromise = createCacheBackend({ keyPrefix: "css" })
    .then((backend) => {
      cssCache = backend;
      logger.debug("[tailwind] CSS cache initialized", { type: backend.type });
      return backend;
    })
    .catch((error) => {
      logger.warn("[tailwind] Failed to initialize distributed CSS cache, using memory", { error });
      cssCache = new MemoryCacheBackend(LOCAL_CACHE_MAX_SIZE);
      return cssCache;
    });

  return cssCacheInitPromise;
}

export async function cacheCSSAsync(css: string, hash?: string): Promise<string> {
  const resolvedHash = hash ?? hashCSS(css);
  storeInLocalCache(resolvedHash, css);

  try {
    const cache = await getCssCache();
    await cache.set(resolvedHash, css, CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("[tailwind] Failed to store CSS in distributed cache", {
      hash: resolvedHash,
      error,
    });
  }

  return resolvedHash;
}

export function getCSSByHash(hash: string): string | undefined {
  const css = localCssCache.get(hash);
  if (css) touchLocalCache(hash, css);
  return css;
}

export async function getCSSByHashAsync(hash: string): Promise<string | undefined> {
  return await withSpan(
    SpanNames.HTML_GET_CSS_BY_HASH,
    async () => {
      const local = localCssCache.get(hash);
      if (local) {
        touchLocalCache(hash, local);
        return local;
      }

      try {
        const cache = await getCssCache();
        const css = await cache.get(hash);
        if (!css) return undefined;

        storeInLocalCache(hash, css);
        logger.debug("[tailwind] CSS cache hit from distributed cache", { hash });
        return css;
      } catch (error) {
        logger.debug("[tailwind] Failed to read from distributed CSS cache", { hash, error });
        return undefined;
      }
    },
    { "css.hash": hash },
  );
}

export function clearCSSCache(): void {
  localCssCache.clear();
}

export function extractCandidates(content: string): string[] {
  const pattern = /[a-zA-Z0-9][a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^]+/g;
  const matches = content.match(pattern) ?? [];
  return [...new Set(matches)];
}

export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
): Set<string> {
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

  for (const file of files) {
    if (!file.content) continue;
    if (!sourceExtensions.some((ext) => file.path.endsWith(ext))) continue;

    for (const candidate of extractCandidates(file.content)) {
      candidates.add(candidate);
    }
  }

  return candidates;
}

async function loadPlugin(id: string): Promise<unknown> {
  if (pluginCache.has(id)) {
    const errorMsg = pluginErrors.get(id);
    if (errorMsg) throw new Error(errorMsg);
    return pluginCache.get(id);
  }

  const url = `https://esm.sh/${id}`;

  try {
    logger.debug("[tailwind] Loading plugin", { id, url });
    const mod = await import(url);
    const plugin = mod.default ?? mod;
    pluginCache.set(id, plugin);
    return plugin;
  } catch (error) {
    const errorMsg = `Failed to load plugin "${id}": ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.warn(`[tailwind] ${errorMsg}`);
    pluginErrors.set(id, errorMsg);
    throw new Error(errorMsg);
  }
}

export function clearPluginCache(id?: string): void {
  if (id) {
    pluginCache.delete(id);
    pluginErrors.delete(id);
    return;
  }

  pluginCache.clear();
  pluginErrors.clear();
}

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

async function getCompiler(stylesheet: string): Promise<Awaited<ReturnType<typeof compile>>> {
  const hash = hashString(stylesheet);
  if (compiler && hash === lastStylesheetHash) return compiler;

  logger.debug("[tailwind] Creating new compiler", { hash });

  const tailwindBase = await getTailwindBaseCSS();

  compiler = await compile(stylesheet, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (id === "tailwindcss") {
        return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
      }
      logger.debug("[tailwind] Unknown stylesheet import", { id });
      return Promise.resolve({ content: "", base: "/", path: "/" });
    },
    loadModule: async (id: string) => {
      const plugin = await loadPlugin(id);
      // deno-lint-ignore no-explicit-any
      return { module: plugin as any, base: "/", path: "/" };
    },
  });

  lastStylesheetHash = hash;
  return compiler;
}

export function invalidateCompiler(): void {
  compiler = null;
  lastStylesheetHash = "";
}

export async function generateTailwindCSS(
  stylesheet: string | undefined,
  candidates: string[] | Set<string>,
  options?: GenerateOptions,
): Promise<TailwindResult> {
  const candidateArray = Array.isArray(candidates) ? candidates : [...candidates];

  return await withSpan(
    SpanNames.HTML_GENERATE_TAILWIND_CSS,
    async () => {
      const css = stylesheet ?? DEFAULT_STYLESHEET;

      try {
        const comp = await getCompiler(css);
        let output = comp.build(candidateArray);

        if (options?.minify) {
          output = output.replace(/\n\s*\n/g, "\n");
        }

        logger.debug("[tailwind] Generated CSS", {
          candidateCount: candidateArray.length,
          outputLength: output.length,
        });

        return { css: output };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("[tailwind] Compilation failed", { error: errorMessage });
        return { css: "", error: errorMessage };
      }
    },
    {
      "tailwind.candidate_count": candidateArray.length,
      "tailwind.has_stylesheet": !!stylesheet,
      "tailwind.minify": options?.minify ?? false,
    },
  );
}

export function formatCSSError(error: Error | string): CSSErrorInfo {
  const msg = typeof error === "string" ? error : error.message;

  if (msg.includes("Could not resolve") || msg.includes("Failed to load plugin")) {
    const pluginMatch = msg.match(/plugin\s*["']([^"']+)["']/i) || msg.match(/"([^"]+)"/);
    const pluginName = pluginMatch?.[1] ?? "unknown";
    return {
      title: "Plugin Not Found",
      message: `Could not load plugin: ${pluginName}`,
      suggestion: `Check the plugin name is correct. Try: https://esm.sh/${pluginName}`,
    };
  }

  if (msg.includes("@theme") || msg.includes("Invalid theme")) {
    return {
      title: "Invalid @theme",
      message: msg,
      suggestion: "Check @theme syntax: @theme { --color-name: value; }",
    };
  }

  if (msg.includes("Unexpected") || msg.includes("Expected")) {
    return {
      title: "CSS Syntax Error",
      message: msg,
      suggestion: "Check for missing semicolons, brackets, or typos",
    };
  }

  return {
    title: "Tailwind CSS Error",
    message: msg,
    suggestion: "Check your stylesheet for errors",
  };
}

/** @deprecated Use generateTailwindCSS with explicit candidates instead */
export async function generateTailwind4CSS(html: string): Promise<string> {
  const candidates = extractCandidates(html);
  const result = await generateTailwindCSS(undefined, candidates);
  return result.css;
}

/** @deprecated Use generateTailwindCSS instead */
export async function compileGlobalsCSS(css: string): Promise<string> {
  const result = await generateTailwindCSS(css, []);
  if (result.error) throw new Error(result.error);
  return result.css;
}
