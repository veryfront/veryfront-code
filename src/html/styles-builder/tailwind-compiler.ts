import { compile } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import defaultTheme from "tailwindcss/defaultTheme";
import colors from "tailwindcss/colors";
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

// Provide localStorage shim for plugins that use util-deprecate (which checks localStorage)
// This prevents "LocalStorage is not supported in this context" errors in Deno.
// In Deno, localStorage is a GETTER that throws - simple assignment doesn't override it.
// We must use Object.defineProperty to properly replace the getter with our shim.
try {
  // deno-lint-ignore no-explicit-any
  const _test = (globalThis as any).localStorage;
  // If we get here, localStorage exists (browser or already shimmed)
} catch {
  // localStorage access threw - use defineProperty to override the throwing getter
  const localStorageShim = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageShim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// Set up global shims for tailwindcss subpaths - used by dynamically loaded plugins
(globalThis as Record<string, unknown>).__tailwindPluginShim = {
  default: plugin,
  __esModule: true,
};
(globalThis as Record<string, unknown>).__tailwindDefaultThemeShim = {
  default: defaultTheme,
  __esModule: true,
};
(globalThis as Record<string, unknown>).__tailwindColorsShim = {
  default: colors,
  __esModule: true,
};

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

/**
 * Unified CSS cache entry - stores CSS and inputs together.
 * This ensures CSS and its regeneration inputs always expire together,
 * enabling reliable JIT regeneration across pods.
 */
interface CSSCacheEntry {
  css: string;
  candidates: string[];
  stylesheet: string;
}

let tailwindBaseCSS: string | null = null;

/**
 * LRU cache for Tailwind compilers, keyed by stylesheet hash.
 * Prevents race conditions when multiple concurrent requests use different stylesheets.
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

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;
// CSS cache TTL: 24 hours (API maximum) for content-addressed immutable resources.
// Hash is derived from content, so same content = same hash = safe to cache long-term.
// Limited to 86400 seconds due to API cache validation constraint.
const CSS_CACHE_TTL_SECONDS = 24 * 3600; // 24 hours (86400 seconds - API max)

const localCssCache = new Map<string, CSSCacheEntry>();
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

interface ProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

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

registerCache("tailwind-compiler-cache", () => ({
  name: "tailwind-compiler-cache",
  entries: compilerCache.size,
  maxEntries: MAX_CACHED_COMPILERS,
}));

/**
 * Initialize project CSS distributed cache.
 * Call this at server startup alongside other distributed caches.
 *
 * @returns true if distributed backend was successfully initialized
 */
export async function initializeProjectCSSCache(): Promise<boolean> {
  if (projectCSSInitialized) return projectCSSBackend?.type !== "memory";

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
  return projectCSSBackend !== null && projectCSSBackend.type !== "memory";
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
      // Store in per-hash cache with inputs for JIT regeneration
      await cacheCSSAsync(localCached.css, localCached.hash, {
        candidates,
        stylesheet: stylesheet ?? DEFAULT_STYLESHEET,
      });
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
          // Store in per-hash cache with inputs for JIT regeneration
          await cacheCSSAsync(entry.css, entry.hash, {
            candidates,
            stylesheet: stylesheet ?? DEFAULT_STYLESHEET,
          });
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
    const formatted = formatCSSError(result.error);
    logger.error("[tailwind] Project CSS generation failed", {
      projectSlug,
      error: formatted.message,
      suggestion: formatted.suggestion,
    });
    throw new Error(
      `[tailwind] ${formatted.title}: ${formatted.message} Suggestion: ${formatted.suggestion}`,
    );
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
  // CSS and inputs are stored together for reliable JIT regeneration
  setProjectCSSLocalFallback(cacheKey, entry);
  await cacheCSSAsync(result.css, hash, {
    candidates,
    stylesheet: stylesheet ?? DEFAULT_STYLESHEET,
  });

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
  projectCSSLocalFallback.set(key, { ...entry, expiresAt: Date.now() + PROJECT_CSS_LOCAL_TTL_MS });
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

function storeInLocalCache(hash: string, entry: CSSCacheEntry): void {
  if (localCssCache.has(hash)) return;

  if (localCssCache.size >= LOCAL_CACHE_MAX_SIZE) {
    const firstKey = localCssCache.keys().next().value as string | undefined;
    if (firstKey) localCssCache.delete(firstKey);
  }

  localCssCache.set(hash, entry);
}

function touchLocalCache(hash: string, entry: CSSCacheEntry): void {
  localCssCache.delete(hash);
  localCssCache.set(hash, entry);
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

/**
 * Cache CSS with its generation inputs for JIT regeneration.
 * Stores CSS and inputs together so they expire at the same time,
 * ensuring any pod can regenerate the CSS if needed.
 */
export async function cacheCSSAsync(
  css: string,
  hash?: string,
  inputs?: { candidates: string[] | Set<string>; stylesheet: string },
): Promise<string> {
  const resolvedHash = hash ?? hashCSS(css);
  const entry: CSSCacheEntry = {
    css,
    candidates: inputs
      ? (Array.isArray(inputs.candidates) ? inputs.candidates : [...inputs.candidates])
      : [],
    stylesheet: inputs?.stylesheet ?? DEFAULT_STYLESHEET,
  };

  storeInLocalCache(resolvedHash, entry);

  try {
    const cache = await getCssCache();
    await cache.set(resolvedHash, JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("[tailwind] Failed to store CSS in distributed cache", {
      hash: resolvedHash,
      error,
    });
  }

  return resolvedHash;
}

export function getCSSByHash(hash: string): string | undefined {
  const entry = localCssCache.get(hash);
  if (entry) {
    touchLocalCache(hash, entry);
    return entry.css;
  }
  return undefined;
}

export async function getCSSByHashAsync(hash: string): Promise<string | undefined> {
  return await withSpan(
    SpanNames.HTML_GET_CSS_BY_HASH,
    async () => {
      const local = localCssCache.get(hash);
      if (local) {
        touchLocalCache(hash, local);
        return local.css;
      }

      try {
        const cache = await getCssCache();
        const raw = await cache.get(hash);
        if (!raw) return undefined;

        // Parse the unified cache entry (CSS + inputs)
        const entry = parseCSSCacheEntry(raw);
        if (!entry) return undefined;

        storeInLocalCache(hash, entry);
        logger.debug("[tailwind] CSS cache hit from distributed cache", { hash });
        return entry.css;
      } catch (error) {
        logger.debug("[tailwind] Failed to read from distributed CSS cache", { hash, error });
        return undefined;
      }
    },
    { "css.hash": hash },
  );
}

/**
 * Parse CSS cache entry, handling both old format (plain CSS string)
 * and new format (JSON with CSS + inputs).
 */
function parseCSSCacheEntry(raw: string): CSSCacheEntry | undefined {
  // Try parsing as JSON first (new format)
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<CSSCacheEntry>;
      if (parsed.css) {
        return {
          css: parsed.css,
          candidates: parsed.candidates ?? [],
          stylesheet: parsed.stylesheet ?? DEFAULT_STYLESHEET,
        };
      }
    } catch {
      // Fall through to legacy handling
    }
  }

  // Legacy format: plain CSS string (no inputs available)
  return {
    css: raw,
    candidates: [],
    stylesheet: DEFAULT_STYLESHEET,
  };
}

export function clearCSSCache(): void {
  localCssCache.clear();
  localCssInputsCache.clear();
}

/**
 * Get CSS cache entry with inputs for JIT regeneration.
 * Returns the full entry (CSS + inputs) if available.
 */
async function getCSSCacheEntry(hash: string): Promise<CSSCacheEntry | undefined> {
  // Try local cache first
  const local = localCssCache.get(hash);
  if (local && local.candidates.length > 0) {
    touchLocalCache(hash, local);
    return local;
  }

  // Try distributed cache
  try {
    const cache = await getCssCache();
    const raw = await cache.get(hash);
    if (!raw) return undefined;

    const entry = parseCSSCacheEntry(raw);
    if (entry) {
      storeInLocalCache(hash, entry);
      return entry;
    }
  } catch (error) {
    logger.debug("[tailwind] Failed to read CSS cache entry", { hash, error });
  }

  return undefined;
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
 * Get CSS generation inputs by hash for JIT regeneration.
 */
async function getCSSInputsByHash(hash: string): Promise<CSSInputsCacheEntry | undefined> {
  const local = localCssInputsCache.get(hash);
  if (local) return local;

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
 * Tries unified cache (CSS + inputs together) first, then falls back to legacy
 * separate inputs cache for backward compatibility with existing cached data.
 *
 * @param expectedHash - The CSS hash to regenerate
 * @returns The regenerated CSS if inputs are cached and hash matches, undefined otherwise
 */
export async function regenerateCSSByHash(expectedHash: string): Promise<string | undefined> {
  return await withSpan(
    SpanNames.HTML_REGENERATE_CSS_BY_HASH,
    async () => {
      // Try unified cache first (CSS + inputs stored together)
      const cacheEntry = await getCSSCacheEntry(expectedHash);
      let inputs: CSSInputsCacheEntry | undefined;

      if (cacheEntry && cacheEntry.candidates.length > 0) {
        inputs = {
          candidates: cacheEntry.candidates,
          stylesheet: cacheEntry.stylesheet,
        };
        logger.debug("[tailwind] Found inputs in unified CSS cache", { hash: expectedHash });
      } else {
        // Fallback to legacy separate inputs cache
        inputs = await getCSSInputsByHash(expectedHash);
      }

      if (!inputs || inputs.candidates.length === 0) {
        logger.debug("[tailwind] Cannot regenerate CSS - no cached inputs", { hash: expectedHash });
        return undefined;
      }

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

      const regeneratedHash = hashCSS(result.css);
      if (regeneratedHash !== expectedHash) {
        logger.debug("[tailwind] CSS regeneration hash mismatch", {
          expected: expectedHash,
          got: regeneratedHash,
        });
        return undefined;
      }

      // Store regenerated CSS with its inputs for future JIT
      const regeneratedEntry: CSSCacheEntry = {
        css: result.css,
        candidates: inputs.candidates,
        stylesheet: inputs.stylesheet,
      };
      storeInLocalCache(regeneratedHash, regeneratedEntry);
      try {
        const cache = await getCssCache();
        await cache.set(regeneratedHash, JSON.stringify(regeneratedEntry), CSS_CACHE_TTL_SECONDS);
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
  const pattern = /!?-?@?(?:[a-zA-Z0-9]|\[&?)[a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^~]*/g;
  return [...new Set(content.match(pattern) ?? [])];
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

/**
 * Dynamically load a module from esm.sh in a compiled Deno binary.
 *
 * This works around the limitation that compiled Deno binaries cannot do
 * dynamic imports from URLs. Instead, we:
 * 1. Fetch the bundled code from esm.sh (with ?bundle&external=tailwindcss)
 * 2. Rewrite the tailwindcss/plugin import to use our global shim
 * 3. Write to a temp file
 * 4. Import via file:// URL
 *
 * @param packageName - The npm package name (e.g., "tailwindcss-animate" or "tailwindcss-animate@1.0.7")
 * @returns The loaded module
 */
export async function loadModuleFromEsmSh(packageName: string): Promise<unknown> {
  // Step 1: Fetch the redirect stub to find the actual bundle URL
  // Use target=denonext to avoid browser-specific APIs like localStorage
  const stubUrl = `https://esm.sh/${packageName}?bundle&external=tailwindcss&target=denonext`;
  logger.debug("[tailwind] Fetching esm.sh stub", { url: stubUrl });

  const stubResponse = await fetch(stubUrl);
  if (!stubResponse.ok) {
    throw new Error(`Failed to fetch stub: ${stubResponse.status}`);
  }
  const stubCode = await stubResponse.text();

  // Step 2: Parse stub to find actual bundle path
  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw new Error(`Could not find bundle path in esm.sh response: ${stubCode.substring(0, 200)}`);
  }

  const bundleUrl = `https://esm.sh${bundleMatch[1]}`;
  logger.debug("[tailwind] Fetching actual bundle", { url: bundleUrl });

  // Step 3: Fetch the actual bundled code
  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) {
    throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);
  }
  let code = await bundleResponse.text();

  // Step 4: Rewrite tailwindcss/* imports to use our global shims
  // The bundle contains imports like: import*as __0$ from"tailwindcss/plugin"
  // Variable names can be __0$, __1$, __2$, etc. so we use regex
  const shimMap: Record<string, string> = {
    "tailwindcss/plugin": "__tailwindPluginShim",
    "tailwindcss/defaultTheme": "__tailwindDefaultThemeShim",
    "tailwindcss/colors": "__tailwindColorsShim",
  };

  for (const [importPath, shimName] of Object.entries(shimMap)) {
    const importRegex = new RegExp(
      `import\\*as\\s+(__\\d+\\$)\\s+from["']${importPath.replace("/", "\\/")}["']`,
      "g",
    );
    code = code.replace(importRegex, (_, varName) => {
      logger.debug(`[tailwind] Rewrote ${importPath} import to use global shim`, { varName });
      return `const ${varName} = globalThis.${shimName}`;
    });
  }

  // Step 4b: Patch out localStorage access from util-deprecate
  // The bundled code contains patterns like: try{if(!globalThis.localStorage)return!1}
  // In Deno compiled binaries, even with our global shim, this can fail.
  // Replace globalThis.localStorage with a safe inline shim.
  code = code.replace(
    /globalThis\.localStorage/g,
    "(globalThis.__localStorageShim||(globalThis.__localStorageShim={getItem:()=>null,setItem:()=>{},length:0}))",
  );

  // Step 5: Write to temp file and import
  const tempPath = `/tmp/tw_plugin_${crypto.randomUUID()}.mjs`;
  await Deno.writeTextFile(tempPath, code);
  logger.debug("[tailwind] Wrote plugin to temp file", { path: tempPath });

  try {
    return await import(`file://${tempPath}`);
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

async function loadPlugin(
  id: string,
  pluginCache: Map<string, unknown>,
  pluginErrors: Map<string, string>,
): Promise<unknown> {
  if (pluginCache.has(id)) {
    const errorMsg = pluginErrors.get(id);
    if (errorMsg) throw new Error(errorMsg);
    return pluginCache.get(id);
  }

  // Use the proper isDeno check that distinguishes between real Deno and dnt shim
  const { isDeno } = await import("#veryfront/platform/compat/runtime.ts");

  try {
    let mod: unknown;

    if (isDeno) {
      // Use dynamic module loading that works in compiled binaries
      // This fetches the bundled code, rewrites imports, and loads via temp file
      logger.debug("[tailwind] Loading plugin via dynamic esm.sh fetch", { id });
      mod = await loadModuleFromEsmSh(id);
    } else {
      // Node.js: Try to import from node_modules
      logger.debug("[tailwind] Loading plugin from node_modules", { id });
      try {
        mod = await import(id);
      } catch {
        const errorMsg = `Failed to load plugin "${id}": plugin not installed`;
        logger.warn("[tailwind] Plugin not installed", { id });
        pluginErrors.set(id, errorMsg);
        pluginCache.set(id, null);
        throw new Error(errorMsg);
      }
    }

    const pluginExport = (mod as { default?: unknown }).default ?? mod;
    pluginCache.set(id, pluginExport);
    return pluginExport;
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
    // Clear specific plugin from all compiler caches
    for (const entry of compilerCache.values()) {
      entry.pluginCache.delete(id);
      entry.pluginErrors.delete(id);
    }
    return;
  }

  // Clear all plugin caches
  for (const entry of compilerCache.values()) {
    entry.pluginCache.clear();
    entry.pluginErrors.clear();
  }
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

async function getCompiler(stylesheet: string): Promise<Awaited<ReturnType<typeof compile>>> {
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

        if (options?.minify) output = minifyCSS(output);

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

  if (msg.includes("does not accept options")) {
    const pluginMatch = msg.match(/"([^"]+)"/);
    const pluginName = pluginMatch?.[1] ?? "unknown plugin";
    return {
      title: "Plugin Options Not Supported",
      message: `${pluginName} does not accept options in Tailwind CSS v4`,
      suggestion: `Remove the options block from @plugin. Use: @plugin "${pluginName}";`,
    };
  }

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
