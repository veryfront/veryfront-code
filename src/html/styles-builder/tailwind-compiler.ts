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
import { minifyCSS } from "#veryfront/build/asset-pipeline/tailwind-processor/css-utils.ts";

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

/**
 * CSS inputs cache - stores the inputs needed to regenerate CSS.
 * Keyed by CSS hash, stores candidates and stylesheet for JIT regeneration.
 * This allows any pod to regenerate CSS without fetching all project files.
 */
interface CSSInputsCacheEntry {
  candidates: string[];
  stylesheet: string;
}

let cssInputsCache: CacheBackend | null = null;
let cssInputsCacheInitPromise: Promise<CacheBackend> | null = null;
const localCssInputsCache = new Map<string, CSSInputsCacheEntry>();
const LOCAL_CSS_INPUTS_CACHE_MAX = 50;

// Project-level CSS cache - uses distributed backend (API/Redis)
const PROJECT_CSS_CACHE_TTL_SECONDS = CSS_CACHE_TTL_SECONDS;
const PROJECT_CSS_LOCAL_FALLBACK_MAX = 50;
const PROJECT_CSS_LOCAL_TTL_MS = PROJECT_CSS_CACHE_TTL_SECONDS * 1000;

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;

interface ProjectCSSLocalEntry extends ProjectCSSCacheEntry {
  expiresAt: number;
}

const projectCSSLocalFallback = new Map<string, ProjectCSSLocalEntry>();

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
        logger.debug("[ProjectCSSCache] Initialized", { backend: projectCSSBackend.type });
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
    if (Date.now() > localCached.expiresAt) {
      projectCSSLocalFallback.delete(cacheKey);
    } else if (localCached.candidatesHash === candidatesHash) {
      logger.debug("[tailwind] Project CSS cache hit (local)", {
        projectSlug,
        hash: localCached.hash,
      });
      await cacheCSSAsync(localCached.css, localCached.hash);
      return { css: localCached.css, hash: localCached.hash, fromCache: true };
    } else {
      // Candidates changed; drop local entry
      projectCSSLocalFallback.delete(cacheKey);
    }
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

  // Store CSS inputs for JIT regeneration (allows any pod to regenerate)
  const resolvedStylesheet = stylesheet ?? DEFAULT_STYLESHEET;
  await storeCSSInputsAsync(hash, candidates, resolvedStylesheet);

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
  const expiresAt = Date.now() + PROJECT_CSS_LOCAL_TTL_MS;
  projectCSSLocalFallback.set(key, { ...entry, expiresAt });
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

const DEFAULT_STYLESHEET = `@import "tailwindcss";
@custom-variant dark (&:is(.dark, [data-theme="dark"]) *, &:is(.dark, [data-theme="dark"]));`;

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
  localCssInputsCache.clear();
}

// ============================================================================
// CSS Inputs Cache - for JIT regeneration
// ============================================================================

function getCssInputsCache(): Promise<CacheBackend> {
  if (cssInputsCache) return Promise.resolve(cssInputsCache);
  if (cssInputsCacheInitPromise) return cssInputsCacheInitPromise;

  cssInputsCacheInitPromise = createCacheBackend({ keyPrefix: "css-inputs" })
    .then((backend) => {
      cssInputsCache = backend;
      logger.debug("[tailwind] CSS inputs cache initialized", { type: backend.type });
      return backend;
    })
    .catch((error) => {
      logger.warn("[tailwind] Failed to initialize CSS inputs cache, using memory", { error });
      cssInputsCache = new MemoryCacheBackend(LOCAL_CSS_INPUTS_CACHE_MAX);
      return cssInputsCache;
    });

  return cssInputsCacheInitPromise;
}

function storeInLocalCssInputsCache(hash: string, entry: CSSInputsCacheEntry): void {
  if (localCssInputsCache.has(hash)) return;

  if (localCssInputsCache.size >= LOCAL_CSS_INPUTS_CACHE_MAX) {
    const firstKey = localCssInputsCache.keys().next().value as string | undefined;
    if (firstKey) localCssInputsCache.delete(firstKey);
  }

  localCssInputsCache.set(hash, entry);
}

/**
 * Store CSS generation inputs alongside the CSS for JIT regeneration.
 * This allows any pod to regenerate CSS without fetching all project files.
 */
async function storeCSSInputsAsync(
  hash: string,
  candidates: string[] | Set<string>,
  stylesheet: string,
): Promise<void> {
  const candidatesArray = Array.isArray(candidates) ? candidates : [...candidates];
  const entry: CSSInputsCacheEntry = { candidates: candidatesArray, stylesheet };

  storeInLocalCssInputsCache(hash, entry);

  try {
    const cache = await getCssInputsCache();
    await cache.set(hash, JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("[tailwind] Failed to store CSS inputs in distributed cache", { hash, error });
  }
}

/**
 * Get CSS generation inputs by hash for JIT regeneration.
 */
async function getCSSInputsByHash(hash: string): Promise<CSSInputsCacheEntry | undefined> {
  // Try local cache first
  const local = localCssInputsCache.get(hash);
  if (local) return local;

  // Try distributed cache
  try {
    const cache = await getCssInputsCache();
    const raw = await cache.get(hash);
    if (!raw) return undefined;

    const entry = JSON.parse(raw) as CSSInputsCacheEntry;
    storeInLocalCssInputsCache(hash, entry);
    logger.debug("[tailwind] CSS inputs cache hit from distributed cache", { hash });
    return entry;
  } catch (error) {
    logger.debug("[tailwind] Failed to read CSS inputs from distributed cache", { hash, error });
    return undefined;
  }
}

/**
 * Regenerate CSS by hash using cached inputs.
 * This is the JIT regeneration path - any pod can regenerate without fetching files.
 *
 * @param expectedHash - The CSS hash to regenerate
 * @returns The regenerated CSS if inputs are cached and hash matches, undefined otherwise
 */
export async function regenerateCSSByHash(expectedHash: string): Promise<string | undefined> {
  return await withSpan(
    SpanNames.HTML_REGENERATE_CSS_BY_HASH,
    async () => {
      // Get cached inputs
      const inputs = await getCSSInputsByHash(expectedHash);
      if (!inputs) {
        logger.debug("[tailwind] Cannot regenerate CSS - no cached inputs", { hash: expectedHash });
        return undefined;
      }

      // Regenerate CSS from cached inputs
      const result = await generateTailwindCSS(inputs.stylesheet, inputs.candidates, {
        minify: true,
      });

      if (result.error) {
        logger.warn("[tailwind] CSS regeneration failed", {
          hash: expectedHash,
          error: result.error,
        });
        return undefined;
      }

      // Verify hash matches (protects against stale inputs)
      const regeneratedHash = hashCSS(result.css);
      if (regeneratedHash !== expectedHash) {
        logger.debug("[tailwind] CSS regeneration hash mismatch", {
          expected: expectedHash,
          got: regeneratedHash,
        });
        return undefined;
      }

      // Store regenerated CSS in cache
      storeInLocalCache(regeneratedHash, result.css);
      try {
        const cache = await getCssCache();
        await cache.set(regeneratedHash, result.css, CSS_CACHE_TTL_SECONDS);
      } catch {
        // Ignore cache write failure - we have the CSS
      }

      logger.info("[tailwind] CSS regenerated via JIT", {
        hash: expectedHash,
        cssLength: result.css.length,
        candidateCount: inputs.candidates.length,
      });

      return result.css;
    },
    { "css.hash": expectedHash },
  );
}

/**
 * Extract Tailwind CSS v4 class candidates from content.
 *
 * Supports all Tailwind v4 features including:
 * - Basic utilities: mt-4, bg-blue-500
 * - Negative values: -mt-4, -translate-x-1/2
 * - Important modifier: !mt-4, !text-red-500
 * - Responsive/state variants: sm:mt-4, hover:bg-blue, dark:text-white
 * - Arbitrary values: w-[100px], bg-[#ff0000], bg-[var(--color)]
 * - Arbitrary properties: [mask-type:alpha], [--my-var:value]
 * - Arbitrary variants: [&>*]:mt-4, [&:hover]:bg-blue
 * - Container queries: @container, @lg:flex, @[200px]:grid
 * - Opacity modifier: bg-black/50
 * - Fractions: w-1/2
 * - CSS variable utilities: text-[--my-color], bg-[--theme-bg]
 * - 3D transforms: rotate-x-45, perspective-500
 */
export function extractCandidates(content: string): string[] {
  // Pattern breakdown:
  // - !? - optional important prefix
  // - -? - optional negative prefix
  // - @? - optional @ for container queries
  // - (?:[a-zA-Z0-9]|\[&?) - start with alphanumeric OR [ (with optional & for arbitrary variants)
  // - [...] - continuation characters including all Tailwind syntax
  // - ~ for sibling selectors [&~*]
  const pattern = /!?-?@?(?:[a-zA-Z0-9]|\[&?)[a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^~]*/g;
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
          output = minifyCSS(output);
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
