/**
 * Project-level CSS cache management.
 *
 * Manages per-project CSS caching using both local in-memory fallback
 * and distributed (API/Redis) backends. Provides cache-aside pattern
 * with automatic invalidation on content changes.
 *
 * @module html/styles-builder/project-css-cache
 */

import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { hashCandidates, hashString } from "./candidate-extractor.ts";
import {
  evaluateProjectCSSLocalCacheState,
  parseProjectCSSCacheEntry,
  resolveStylesheet,
} from "./tailwind-compiler-utils.ts";
import { cacheCSSAsync, DEFAULT_STYLESHEET } from "./css-hash-cache.ts";
import { TAILWIND_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  MAX_CSS_CANDIDATES,
  MAX_LOCAL_PROJECT_CSS_CACHE_BYTES,
  MAX_STYLESHEET_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

const projectCssCacheLog = logger.component("project-css-cache");
const tailwindLog = logger.component("tailwind");

// ============================================================================
// Types
// ============================================================================

interface ProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

interface ProjectCSSLocalEntry extends ProjectCSSCacheEntry {
  expiresAt: number;
}

interface ProjectCSSRequestContext {
  projectSlug: string;
  stylesheet: string;
  candidatesHash: string;
  profileHash: string;
  environment: string;
  cacheKey: string;
}

interface ProjectCSSProfile {
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
}

// ============================================================================
// Constants
// ============================================================================

const PROJECT_CSS_CACHE_TTL_SECONDS = 24 * 3600;
const PROJECT_CSS_LOCAL_FALLBACK_MAX = 50;
const PROJECT_CSS_LOCAL_TTL_MS = PROJECT_CSS_CACHE_TTL_SECONDS * 1000;
const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// ============================================================================
// State
// ============================================================================

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;

const projectCSSLocalFallback = new LRUCache<string, ProjectCSSLocalEntry>({
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  maxSizeBytes: MAX_LOCAL_PROJECT_CSS_CACHE_BYTES,
});

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function assertProjectCSSContext(
  projectSlug: string,
  stylesheet: string,
  candidates: Set<string>,
  environment: string,
): void {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid project slug" });
  }
  if (!ENVIRONMENT_PATTERN.test(environment)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid CSS environment" });
  }
  if (utf8ByteLength(stylesheet) > MAX_STYLESHEET_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Stylesheet exceeds the 2 MiB size limit" });
  }
  if (candidates.size > MAX_CSS_CANDIDATES) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Too many CSS candidates" });
  }
}

registerCache("project-css-cache", () => ({
  name: "project-css-cache",
  entries: projectCSSLocalFallback.size,
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  backend: projectCSSBackend?.type ?? "uninitialized",
}));

// ============================================================================
// Initialization
// ============================================================================

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
        projectCssCacheLog.debug("Initialized", { backend: projectCSSBackend.type });
      } catch (error) {
        projectCssCacheLog.warn("Backend init failed, using memory", { error: errorName(error) });
        projectCSSBackend = new MemoryCacheBackend(PROJECT_CSS_LOCAL_FALLBACK_MAX);
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

// ============================================================================
// Request context
// ============================================================================

export function createProjectCSSRequestContext(
  projectSlug: string,
  stylesheet: string | undefined,
  candidates: Set<string>,
  profile?: ProjectCSSProfile,
): ProjectCSSRequestContext {
  const resolvedStylesheet = resolveStylesheet(stylesheet, DEFAULT_STYLESHEET);
  const environment = profile?.environment ?? "preview";
  assertProjectCSSContext(projectSlug, resolvedStylesheet, candidates, environment);
  const stylesheetHash = hashString(resolvedStylesheet);
  const candidatesHash = hashCandidates(candidates);
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: "v3",
      tailwindVersion: TAILWIND_VERSION,
      minify: profile?.minify ?? false,
      buildMode: profile?.buildMode ?? "production",
      environment,
    }),
  );

  return {
    projectSlug,
    stylesheet: resolvedStylesheet,
    candidatesHash,
    profileHash,
    environment,
    cacheKey: `${projectSlug}:${environment}:${stylesheetHash}:${candidatesHash}:${profileHash}`,
  };
}

// ============================================================================
// Local fallback management
// ============================================================================

function setProjectCSSLocalFallback(key: string, entry: ProjectCSSCacheEntry): void {
  projectCSSLocalFallback.set(key, { ...entry, expiresAt: Date.now() + PROJECT_CSS_LOCAL_TTL_MS });
}

async function cacheProjectCSSEntryByHash(
  entry: ProjectCSSCacheEntry,
  candidates: Set<string>,
  stylesheet: string,
): Promise<void> {
  await cacheCSSAsync(entry.css, entry.hash, { candidates, stylesheet });
}

// ============================================================================
// Cache lookup strategies
// ============================================================================

export async function tryGetProjectCSSFromLocalFallback(
  context: ProjectCSSRequestContext,
  candidates: Set<string>,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  const localCached = projectCSSLocalFallback.get(context.cacheKey);
  const localState = evaluateProjectCSSLocalCacheState(localCached, context.candidatesHash);

  if (localState === "expired" || localState === "mismatch") {
    projectCSSLocalFallback.delete(context.cacheKey);
    return undefined;
  }

  if (localState !== "hit" || !localCached) return undefined;

  tailwindLog.debug("Project CSS cache hit (local)");

  await cacheProjectCSSEntryByHash(localCached, candidates, context.stylesheet);
  return { css: localCached.css, hash: localCached.hash, fromCache: true };
}

export async function tryGetProjectCSSFromDistributedCache(
  context: ProjectCSSRequestContext,
  candidates: Set<string>,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  if (!projectCSSBackend) return undefined;

  try {
    const raw = await projectCSSBackend.get(context.cacheKey);
    if (!raw) return undefined;

    const entry = parseProjectCSSCacheEntry(raw);
    if (!entry) {
      tailwindLog.debug("Project CSS cache entry was malformed");
      return undefined;
    }

    if (entry.candidatesHash !== context.candidatesHash) {
      tailwindLog.debug("Project CSS cache miss because candidates changed");
      return undefined;
    }

    tailwindLog.debug("Project CSS cache hit (distributed)");

    setProjectCSSLocalFallback(context.cacheKey, entry);
    await cacheProjectCSSEntryByHash(entry, candidates, context.stylesheet);
    return { css: entry.css, hash: entry.hash, fromCache: true };
  } catch (error) {
    tailwindLog.debug("Failed to read from project CSS cache", {
      error: errorName(error),
    });
    return undefined;
  }
}

// ============================================================================
// Store generated CSS
// ============================================================================

export async function storeProjectCSS(
  context: ProjectCSSRequestContext,
  entry: ProjectCSSCacheEntry,
  candidates: Set<string>,
): Promise<void> {
  if (projectCSSBackend) {
    try {
      await projectCSSBackend.set(
        context.cacheKey,
        JSON.stringify(entry),
        PROJECT_CSS_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      tailwindLog.debug("Failed to store in project CSS cache", { error: errorName(error) });
    }
  }

  setProjectCSSLocalFallback(context.cacheKey, entry);

  // Await the hash-level cache write so other pods can serve
  // /_vf/css/{hash}.css immediately. Without awaiting, the browser's
  // CSS request may hit a different pod before the write completes.
  await cacheProjectCSSEntryByHash(entry, candidates, context.stylesheet);
}

/**
 * Whether the project CSS distributed cache has been initialized.
 */
export function isProjectCSSInitialized(): boolean {
  return projectCSSInitialized;
}

// ============================================================================
// Invalidation
// ============================================================================

/**
 * Invalidate project CSS cache for a specific project.
 */
export function invalidateProjectCSS(projectSlug: string): void {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) return;
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      projectCSSLocalFallback.delete(key);
    }
  }

  invalidateProjectCSSAsync(projectSlug).catch((error) => {
    tailwindLog.debug("Failed to invalidate project CSS cache", { error: errorName(error) });
  });
}

/**
 * Invalidate project CSS cache for a specific project (async version).
 */
export async function invalidateProjectCSSAsync(projectSlug: string): Promise<void> {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) return;
  if (!projectCSSBackend?.delByPattern) return;

  try {
    const deleted = await projectCSSBackend.delByPattern(`${projectSlug}:*`);
    tailwindLog.debug("Cleared project CSS cache", { deleted });
  } catch (error) {
    tailwindLog.debug("Failed to clear project CSS cache", { error: errorName(error) });
  }
}
