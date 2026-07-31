/**
 * Project-level CSS cache management.
 *
 * Manages per-project CSS caching using a bounded local tier and an optional
 * provider-neutral shared backend. Provides a cache-aside pattern
 * with automatic invalidation on content changes.
 *
 * @module html/styles-builder/project-css-cache
 */

import { type CacheBackend, CacheBackends } from "#veryfront/cache/backend.ts";
import { assertCSSPipelineIdentity, serverLogger as logger } from "#veryfront/utils";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import {
  assertCSSContentIdentity,
  hashCandidates,
  hashCSS,
  hashString,
  isCSSContentHash,
} from "./css-identity.ts";
import {
  evaluateProjectCSSLocalCacheState,
  parseProjectCSSCacheEntry,
} from "./css-compiler-utils.ts";
import { cacheCSSAsync } from "./css-hash-cache.ts";

const projectCssCacheLog = logger.component("project-css-cache");
const cssCacheLog = logger.component("project-css-cache");

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
  cssPipelineIdentity: string;
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
const PROJECT_CSS_CACHE_SCHEMA = "v4";

// ============================================================================
// State
// ============================================================================

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;

const projectCSSLocalFallback = new Map<string, ProjectCSSLocalEntry>();

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
      projectCSSBackend = await CacheBackends.projectCSS();
      projectCSSInitialized = true;
      projectCssCacheLog.debug("Initialized", { backend: projectCSSBackend.type });
    })();
  }

  const pending = projectCSSInitPromise;
  try {
    await pending;
  } finally {
    if (projectCSSInitPromise === pending) projectCSSInitPromise = null;
  }

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
  stylesheet: string,
  candidates: Set<string>,
  profile: ProjectCSSProfile,
): ProjectCSSRequestContext {
  const cssPipelineIdentity = assertCSSPipelineIdentity(profile.cssPipelineIdentity);
  if (typeof stylesheet !== "string") {
    throw new TypeError("Project CSS request context requires a resolved stylesheet");
  }
  assertCSSOutputContent(stylesheet, "Project CSS stylesheet");
  const stylesheetHash = hashString(stylesheet);
  const candidatesHash = hashCandidates(candidates);
  const environment = profile.environment ?? "preview";
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: PROJECT_CSS_CACHE_SCHEMA,
      cssPipelineIdentity,
      minify: profile.minify ?? false,
      buildMode: profile.buildMode ?? "production",
      environment,
    }),
  );

  return {
    projectSlug,
    stylesheet,
    candidatesHash,
    profileHash,
    environment,
    cacheKey:
      `${projectSlug}:${environment}:${PROJECT_CSS_CACHE_SCHEMA}:${stylesheetHash}:${candidatesHash}:${profileHash}`,
  };
}

// ============================================================================
// Local fallback management
// ============================================================================

function setProjectCSSLocalFallback(key: string, entry: ProjectCSSCacheEntry): void {
  assertCSSOutputContent(entry.css, "Cached project CSS output");
  projectCSSLocalFallback.set(key, { ...entry, expiresAt: Date.now() + PROJECT_CSS_LOCAL_TTL_MS });
  if (projectCSSLocalFallback.size > PROJECT_CSS_LOCAL_FALLBACK_MAX) {
    pruneProjectCSSLocalFallback();
  }
}

function isValidProjectCSSCacheEntry(entry: ProjectCSSCacheEntry): boolean {
  return isCSSContentHash(entry.hash) &&
    isCSSContentHash(entry.candidatesHash) &&
    hashCSS(entry.css) === entry.hash;
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
  assertCSSOutputContent(localCached.css, "Cached project CSS output");
  if (!isValidProjectCSSCacheEntry(localCached)) {
    projectCSSLocalFallback.delete(context.cacheKey);
    return undefined;
  }

  cssCacheLog.debug("Project CSS cache hit (local)", {
    projectSlug: context.projectSlug,
    hash: localCached.hash,
  });

  await cacheProjectCSSEntryByHash(localCached, candidates, context.stylesheet);
  return { css: localCached.css, hash: localCached.hash, fromCache: true };
}

export async function tryGetProjectCSSFromDistributedCache(
  context: ProjectCSSRequestContext,
  candidates: Set<string>,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  if (!projectCSSBackend) return undefined;

  let raw: string | null;
  try {
    raw = await projectCSSBackend.get(context.cacheKey);
  } catch (error) {
    cssCacheLog.debug("Failed to read from project CSS cache", {
      cacheKey: context.cacheKey,
      error,
    });
    return undefined;
  }
  if (!raw) return undefined;

  const entry = parseProjectCSSCacheEntry(raw);
  if (!entry) {
    cssCacheLog.debug("Project CSS cache entry was malformed", {
      cacheKey: context.cacheKey,
    });
    return undefined;
  }

  if (!isValidProjectCSSCacheEntry(entry)) {
    cssCacheLog.warn("Rejected project CSS cache entry with mismatched identity", {
      cacheKey: context.cacheKey,
    });
    return undefined;
  }

  if (entry.candidatesHash !== context.candidatesHash) {
    cssCacheLog.debug("Project CSS cache miss (candidates changed)", {
      projectSlug: context.projectSlug,
      cachedCandidatesHash: entry.candidatesHash,
      currentCandidatesHash: context.candidatesHash,
    });
    return undefined;
  }

  cssCacheLog.debug("Project CSS cache hit (distributed)", {
    projectSlug: context.projectSlug,
    hash: entry.hash,
  });

  setProjectCSSLocalFallback(context.cacheKey, entry);
  await cacheProjectCSSEntryByHash(entry, candidates, context.stylesheet);
  return { css: entry.css, hash: entry.hash, fromCache: true };
}

// ============================================================================
// Store generated CSS
// ============================================================================

export async function storeProjectCSS(
  context: ProjectCSSRequestContext,
  entry: ProjectCSSCacheEntry,
  candidates: Set<string>,
): Promise<void> {
  assertCSSOutputContent(entry.css, "Cached project CSS output");
  assertCSSContentIdentity(entry.css, entry.hash);
  if (entry.candidatesHash !== context.candidatesHash) {
    throw new TypeError("Project CSS candidate identity does not match the request context");
  }

  if (projectCSSBackend) {
    projectCSSBackend.set(context.cacheKey, JSON.stringify(entry), PROJECT_CSS_CACHE_TTL_SECONDS)
      .catch((error) => {
        cssCacheLog.debug("Failed to store in project CSS cache", {
          cacheKey: context.cacheKey,
          error,
        });
      });
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
  void invalidateProjectCSSAsync(projectSlug).catch((error) => {
    cssCacheLog.debug("Failed to invalidate project CSS cache", { projectSlug, error });
  });
}

/**
 * Invalidate local and distributed project CSS state. Distributed failures are
 * propagated so freshness-sensitive callers can fail closed before reload.
 */
export async function invalidateProjectCSSAsync(projectSlug: string): Promise<void> {
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      projectCSSLocalFallback.delete(key);
    }
  }

  if (!projectCSSBackend?.delByPattern) return;

  const deleted = await projectCSSBackend.delByPattern(`${projectSlug}:*`);
  cssCacheLog.debug("Cleared project CSS cache", { projectSlug, deleted });
}
