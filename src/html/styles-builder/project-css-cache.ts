/**
 * Project-level CSS cache management.
 *
 * Manages per-project CSS caching using both local in-memory fallback
 * and distributed (API/Redis) backends. Provides cache-aside pattern
 * with automatic invalidation on content changes.
 *
 * @module html/styles-builder/project-css-cache
 */

import { type CacheBackend, CacheBackends } from "#veryfront/cache/backend.ts";
import { assertCSSPipelineIdentity, serverLogger as logger } from "#veryfront/utils";
import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import {
  detachRetainedString,
  estimateRetainedStringBytes,
} from "#veryfront/utils/retained-string.ts";
import {
  assertCSSContentIdentity,
  hashCandidates,
  hashString,
  isCSSContentHash,
} from "./css-identity.ts";
import {
  evaluateProjectCSSLocalCacheState,
  parseProjectCSSCacheEntry,
} from "./tailwind-compiler-utils.ts";
import { cacheCSSAsync } from "./css-hash-cache.ts";

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
  retainedBytes: number;
}

export interface ProjectCSSRequestContext {
  projectSlug: string;
  stylesheet: string;
  candidatesHash: string;
  profileHash: string;
  environment: string;
  cssPipelineIdentity: string;
  cacheKey: string;
  cacheEpoch: number;
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
const PROJECT_CSS_CACHE_SCHEMA = "v4";
const PROJECT_CSS_LOCAL_FALLBACK_MAX = 50;
const PROJECT_CSS_LOCAL_FALLBACK_MAX_BYTES = 64 * 1024 * 1024;
const PROJECT_CSS_LOCAL_TTL_MS = PROJECT_CSS_CACHE_TTL_SECONDS * 1000;

// ============================================================================
// State
// ============================================================================

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;

const projectCSSLocalFallback = new Map<string, ProjectCSSLocalEntry>();
let projectCSSLocalFallbackBytes = 0;
let projectCSSCacheEpoch = 0;

registerCache("project-css-cache", () => ({
  name: "project-css-cache",
  entries: projectCSSLocalFallback.size,
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  estimatedSizeBytes: projectCSSLocalFallbackBytes,
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
  if (projectCSSInitialized) {
    return projectCSSBackend !== null && projectCSSBackend.type !== "memory";
  }

  if (!projectCSSInitPromise) {
    projectCSSInitPromise = (async () => {
      try {
        projectCSSBackend = await CacheBackends.projectCSS();
        projectCssCacheLog.debug("Initialized", { backend: projectCSSBackend.type });
      } catch (error) {
        projectCssCacheLog.warn("Shared backend unavailable; bounded local cache remains active", {
          error,
        });
        projectCSSBackend = null;
      } finally {
        projectCSSInitialized = true;
      }
    })();
  }

  await projectCSSInitPromise;
  projectCSSInitPromise = null;

  return projectCSSBackend !== null && projectCSSBackend.type !== "memory";
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
  candidates: string[] | Set<string>,
  profile: ProjectCSSProfile,
): ProjectCSSRequestContext {
  const capturedProjectSlug = assertCSSPipelineIdentity(
    projectSlug,
    "Project CSS project scope",
  );
  const cssPipelineIdentity = assertCSSPipelineIdentity(profile.cssPipelineIdentity);
  assertCSSFileContent(stylesheet, "Project CSS stylesheet");
  const admittedCandidates = normalizeCSSCandidates(candidates);
  const stylesheetHash = hashString(stylesheet);
  const candidatesHash = hashCandidates(admittedCandidates);
  const environment = assertCSSPipelineIdentity(
    profile?.environment ?? "preview",
    "Project CSS environment",
  );
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: PROJECT_CSS_CACHE_SCHEMA,
      cssPipelineIdentity,
      minify: profile?.minify ?? false,
      buildMode: profile?.buildMode ?? "production",
      environment,
    }),
  );

  return {
    projectSlug: capturedProjectSlug,
    stylesheet,
    candidatesHash,
    profileHash,
    environment,
    cssPipelineIdentity,
    cacheKey: getProjectCSSCacheScopePrefix(capturedProjectSlug) + hashString(environment) +
      `:${stylesheetHash}:${candidatesHash}:${profileHash}`,
    cacheEpoch: projectCSSCacheEpoch,
  };
}

function getProjectCSSCacheScopePrefix(projectSlug: string): string {
  return `${PROJECT_CSS_CACHE_SCHEMA}:${hashString(projectSlug)}:`;
}

// ============================================================================
// Local fallback management
// ============================================================================

function estimateProjectCSSLocalEntryBytes(key: string, entry: ProjectCSSCacheEntry): number {
  return estimateRetainedStringBytes(key) + estimateRetainedStringBytes(entry.css) +
    estimateRetainedStringBytes(entry.hash) +
    estimateRetainedStringBytes(entry.candidatesHash) + 128;
}

function removeProjectCSSLocalFallback(key: string): void {
  const existing = projectCSSLocalFallback.get(key);
  if (!existing) return;
  projectCSSLocalFallback.delete(key);
  projectCSSLocalFallbackBytes -= existing.retainedBytes;
}

function setProjectCSSLocalFallback(key: string, entry: ProjectCSSCacheEntry): void {
  assertCSSOutputContent(entry.css, "Cached project CSS output");
  assertCSSContentIdentity(entry.css, entry.hash);
  const retainedKey = detachRetainedString(key);
  const retainedEntry = {
    css: detachRetainedString(entry.css),
    hash: detachRetainedString(entry.hash),
    candidatesHash: detachRetainedString(entry.candidatesHash),
  };
  const retainedBytes = estimateProjectCSSLocalEntryBytes(retainedKey, retainedEntry);
  removeProjectCSSLocalFallback(key);
  while (
    projectCSSLocalFallback.size >= PROJECT_CSS_LOCAL_FALLBACK_MAX ||
    projectCSSLocalFallbackBytes + retainedBytes > PROJECT_CSS_LOCAL_FALLBACK_MAX_BYTES
  ) {
    const oldestKey = projectCSSLocalFallback.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    removeProjectCSSLocalFallback(oldestKey);
  }
  if (retainedBytes > PROJECT_CSS_LOCAL_FALLBACK_MAX_BYTES) return;
  projectCSSLocalFallback.set(retainedKey, {
    css: retainedEntry.css,
    hash: retainedEntry.hash,
    candidatesHash: retainedEntry.candidatesHash,
    expiresAt: Date.now() + PROJECT_CSS_LOCAL_TTL_MS,
    retainedBytes,
  });
  projectCSSLocalFallbackBytes += retainedBytes;
}

async function cacheProjectCSSEntryByHash(
  entry: ProjectCSSCacheEntry,
  candidates: string[] | Set<string>,
  stylesheet: string,
  cssPipelineIdentity: string,
): Promise<void> {
  await cacheCSSAsync(entry.css, entry.hash, {
    candidates,
    stylesheet,
    pipelineIdentity: cssPipelineIdentity,
  });
}

function isValidProjectCSSCacheEntry(entry: ProjectCSSCacheEntry): boolean {
  if (!isCSSContentHash(entry.hash) || !isCSSContentHash(entry.candidatesHash)) return false;
  try {
    assertCSSOutputContent(entry.css, "Cached project CSS output");
    assertCSSContentIdentity(entry.css, entry.hash);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Cache lookup strategies
// ============================================================================

export async function tryGetProjectCSSFromLocalFallback(
  context: ProjectCSSRequestContext,
  candidates: string[] | Set<string>,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  if (context.cacheEpoch !== projectCSSCacheEpoch) return undefined;
  const localCached = projectCSSLocalFallback.get(context.cacheKey);
  const localState = evaluateProjectCSSLocalCacheState(localCached, context.candidatesHash);

  if (localState === "expired" || localState === "mismatch") {
    removeProjectCSSLocalFallback(context.cacheKey);
    return undefined;
  }

  if (localState !== "hit" || !localCached) return undefined;
  if (!isValidProjectCSSCacheEntry(localCached)) {
    removeProjectCSSLocalFallback(context.cacheKey);
    return undefined;
  }

  tailwindLog.debug("Project CSS cache hit (local)", {
    projectSlug: context.projectSlug,
    hash: localCached.hash,
  });
  projectCSSLocalFallback.delete(context.cacheKey);
  projectCSSLocalFallback.set(context.cacheKey, localCached);

  await cacheProjectCSSEntryByHash(
    localCached,
    candidates,
    context.stylesheet,
    context.cssPipelineIdentity,
  );
  return { css: localCached.css, hash: localCached.hash, fromCache: true };
}

export async function tryGetProjectCSSFromDistributedCache(
  context: ProjectCSSRequestContext,
  candidates: string[] | Set<string>,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  if (context.cacheEpoch !== projectCSSCacheEpoch) return undefined;
  if (!projectCSSBackend) return undefined;

  try {
    const raw = await projectCSSBackend.get(context.cacheKey);
    if (context.cacheEpoch !== projectCSSCacheEpoch) return undefined;
    if (!raw) return undefined;

    const entry = parseProjectCSSCacheEntry(raw);
    if (!entry) {
      tailwindLog.debug("Project CSS cache entry was malformed", {
        cacheKey: context.cacheKey,
      });
      return undefined;
    }
    if (!isValidProjectCSSCacheEntry(entry)) {
      tailwindLog.warn("Rejected project CSS cache entry with invalid content identity", {
        cacheKey: context.cacheKey,
      });
      return undefined;
    }

    if (entry.candidatesHash !== context.candidatesHash) {
      tailwindLog.debug("Project CSS cache miss (candidates changed)", {
        projectSlug: context.projectSlug,
        cachedCandidatesHash: entry.candidatesHash,
        currentCandidatesHash: context.candidatesHash,
      });
      return undefined;
    }

    tailwindLog.debug("Project CSS cache hit (distributed)", {
      projectSlug: context.projectSlug,
      hash: entry.hash,
    });

    setProjectCSSLocalFallback(context.cacheKey, entry);
    await cacheProjectCSSEntryByHash(
      entry,
      candidates,
      context.stylesheet,
      context.cssPipelineIdentity,
    );
    return { css: entry.css, hash: entry.hash, fromCache: true };
  } catch (error) {
    tailwindLog.debug("Failed to read from project CSS cache", {
      cacheKey: context.cacheKey,
      error,
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
  candidates: string[] | Set<string>,
): Promise<void> {
  assertCSSContentIdentity(entry.css, entry.hash);
  if (entry.candidatesHash !== context.candidatesHash) {
    throw new TypeError("Project CSS candidates hash does not match its request context");
  }
  if (context.cacheEpoch !== projectCSSCacheEpoch) return;
  if (projectCSSBackend) {
    try {
      await projectCSSBackend.set(
        context.cacheKey,
        JSON.stringify(entry),
        PROJECT_CSS_CACHE_TTL_SECONDS,
      );
      if (context.cacheEpoch !== projectCSSCacheEpoch) {
        await projectCSSBackend.del(context.cacheKey);
        return;
      }
    } catch (error) {
      tailwindLog.debug("Failed to store in project CSS cache", {
        cacheKey: context.cacheKey,
        error,
      });
    }
  }

  if (context.cacheEpoch !== projectCSSCacheEpoch) return;

  setProjectCSSLocalFallback(context.cacheKey, entry);

  // Await the hash-level cache write so other pods can serve
  // /_vf/css/{hash}.css immediately. Without awaiting, the browser's
  // CSS request may hit a different pod before the write completes.
  await cacheProjectCSSEntryByHash(
    entry,
    candidates,
    context.stylesheet,
    context.cssPipelineIdentity,
  );
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
  const projectPrefix = getProjectCSSCacheScopePrefix(
    assertCSSPipelineIdentity(projectSlug, "Project CSS project scope"),
  );
  projectCSSCacheEpoch++;
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(projectPrefix)) {
      removeProjectCSSLocalFallback(key);
    }
  }

  invalidateProjectCSSBackend(projectSlug, projectPrefix).catch((error) => {
    tailwindLog.debug("Failed to invalidate project CSS cache", { projectSlug, error });
  });
}

/**
 * Invalidate project CSS cache for a specific project (async version).
 */
export async function invalidateProjectCSSAsync(projectSlug: string): Promise<void> {
  const projectPrefix = getProjectCSSCacheScopePrefix(
    assertCSSPipelineIdentity(projectSlug, "Project CSS project scope"),
  );
  projectCSSCacheEpoch++;
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(projectPrefix)) removeProjectCSSLocalFallback(key);
  }
  await invalidateProjectCSSBackend(projectSlug, projectPrefix);
}

async function invalidateProjectCSSBackend(
  projectSlug: string,
  projectPrefix: string,
): Promise<void> {
  if (!projectCSSBackend?.delByPattern) return;
  try {
    const deleted = await projectCSSBackend.delByPattern(`${projectPrefix}*`);
    tailwindLog.debug("Cleared project CSS cache", { projectSlug, deleted });
  } catch (error) {
    tailwindLog.debug("Failed to clear project CSS cache", { projectSlug, error });
    throw error;
  }
}
