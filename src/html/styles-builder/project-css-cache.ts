/**
 * Project-level CSS cache management.
 *
 * Manages per-project CSS caching using a bounded local tier and an optional
 * provider-neutral shared backend. Provides a cache-aside pattern
 * with automatic invalidation on content changes.
 *
 * @module html/styles-builder/project-css-cache
 */

import {
  type CacheBackend,
  CacheBackends,
  readCacheValueWithinLimit,
} from "#veryfront/cache/backend.ts";
import {
  buildProjectCSSCacheKey,
  buildProjectCSSCacheScopePrefix,
  PROJECT_CSS_CACHE_SCHEMA,
} from "#veryfront/cache/keys/project-css.ts";
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
import {
  ByteWeightedLRUCache,
  detachRetainedString,
  estimateRetainedStringBytes,
  MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
  serializeCSSCacheValue,
} from "./css-cache-limits.ts";

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
const PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES = 16 * 1024 * 1024;
const PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES = 160;
const PROJECT_CSS_LOCAL_TTL_MS = PROJECT_CSS_CACHE_TTL_SECONDS * 1000;

// ============================================================================
// State
// ============================================================================

let projectCSSBackend: CacheBackend | null = null;
let projectCSSInitialized = false;
let projectCSSInitPromise: Promise<void> | null = null;
const projectCSSPendingWrites = new Map<string, Set<Promise<void>>>();
const projectCSSInvalidations = new Map<string, Promise<void>>();

const projectCSSLocalFallback = new ByteWeightedLRUCache<string, ProjectCSSLocalEntry>({
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  maxEntrySizeBytes: PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES,
  maxSizeBytes: PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES,
});

function beginProjectCSSWrite(projectSlug: string): {
  precedingInvalidation: Promise<void> | undefined;
  finish: () => void;
} {
  const precedingInvalidation = projectCSSInvalidations.get(projectSlug);
  const completion = Promise.withResolvers<void>();
  let pending = projectCSSPendingWrites.get(projectSlug);
  if (!pending) {
    pending = new Set();
    projectCSSPendingWrites.set(projectSlug, pending);
  }
  pending.add(completion.promise);
  let finished = false;

  return {
    precedingInvalidation,
    finish() {
      if (finished) return;
      finished = true;
      completion.resolve();
      pending.delete(completion.promise);
      if (pending.size === 0 && projectCSSPendingWrites.get(projectSlug) === pending) {
        projectCSSPendingWrites.delete(projectSlug);
      }
    },
  };
}

function clearProjectCSSLocalFallback(projectSlug: string): void {
  const projectPrefix = buildProjectCSSCacheScopePrefix(projectSlug);
  for (const key of projectCSSLocalFallback.keys()) {
    if (key.startsWith(projectPrefix)) {
      projectCSSLocalFallback.delete(key);
    }
  }
}

registerCache("project-css-cache", () => ({
  name: "project-css-cache",
  entries: projectCSSLocalFallback.size,
  maxEntries: PROJECT_CSS_LOCAL_FALLBACK_MAX,
  estimatedSizeBytes: projectCSSLocalFallback.sizeBytes,
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
    cacheKey: buildProjectCSSCacheKey({
      projectScope: projectSlug,
      environment,
      stylesheetHash,
      candidatesHash,
      profileHash,
    }),
  };
}

// ============================================================================
// Local fallback management
// ============================================================================

function setProjectCSSLocalFallback(key: string, entry: ProjectCSSCacheEntry): void {
  assertCSSOutputContent(entry.css, "Cached project CSS output");
  const preflightRetainedBytes = PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES +
    estimateRetainedStringBytes(key) + estimateRetainedStringBytes(entry.css) +
    estimateRetainedStringBytes(entry.hash) + estimateRetainedStringBytes(entry.candidatesHash);
  if (
    preflightRetainedBytes > PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES ||
    preflightRetainedBytes > PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES
  ) {
    projectCSSLocalFallback.delete(key);
    return;
  }
  const retainedHash = detachRetainedString(entry.hash);
  const localEntry = Object.freeze({
    css: detachRetainedString(entry.css),
    hash: retainedHash,
    candidatesHash: entry.candidatesHash === entry.hash
      ? retainedHash
      : detachRetainedString(entry.candidatesHash),
    expiresAt: Date.now() + PROJECT_CSS_LOCAL_TTL_MS,
  });
  const retainedKey = detachRetainedString(key);
  const retainedBytes = PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES +
    estimateRetainedStringBytes(retainedKey) + estimateRetainedStringBytes(localEntry.css) +
    estimateRetainedStringBytes(localEntry.hash) +
    estimateRetainedStringBytes(localEntry.candidatesHash);
  projectCSSLocalFallback.set(retainedKey, localEntry, retainedBytes);
}

function isValidProjectCSSCacheEntry(entry: ProjectCSSCacheEntry): boolean {
  return isCSSContentHash(entry.hash) &&
    isCSSContentHash(entry.candidatesHash) &&
    hashCSS(entry.css) === entry.hash;
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
    raw = await readCacheValueWithinLimit(
      projectCSSBackend,
      context.cacheKey,
      MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
    );
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
  const cacheKey = context.cacheKey;
  const projectSlug = context.projectSlug;
  const stylesheet = context.stylesheet;
  const contextCandidatesHash = context.candidatesHash;
  const capturedEntry = Object.freeze({
    css: entry.css,
    hash: entry.hash,
    candidatesHash: entry.candidatesHash,
  });
  assertCSSOutputContent(capturedEntry.css, "Cached project CSS output");
  assertCSSContentIdentity(capturedEntry.css, capturedEntry.hash);
  if (capturedEntry.candidatesHash !== contextCandidatesHash) {
    throw new TypeError("Project CSS candidate identity does not match the request context");
  }

  const pendingWrite = beginProjectCSSWrite(projectSlug);
  let backendWriteScheduled = false;
  try {
    if (pendingWrite.precedingInvalidation) {
      await Promise.allSettled([pendingWrite.precedingInvalidation]);
    }

    if (projectCSSBackend) {
      const backend = projectCSSBackend;
      backendWriteScheduled = true;
      const backendWrite = Promise.resolve()
        .then(() =>
          backend.set(
            cacheKey,
            serializeCSSCacheValue(capturedEntry, MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES),
            PROJECT_CSS_CACHE_TTL_SECONDS,
          )
        )
        .catch((error) => {
          cssCacheLog.debug("Failed to store in project CSS cache", {
            cacheKey,
            error,
          });
        });
      void backendWrite.then(pendingWrite.finish, pendingWrite.finish);
    }

    setProjectCSSLocalFallback(cacheKey, capturedEntry);
    if (!backendWriteScheduled) pendingWrite.finish();

    // Await the hash-level cache write so other pods can serve
    // /_vf/css/{hash}.css immediately. Without awaiting, the browser's
    // CSS request may hit a different pod before the write completes.
    await cacheProjectCSSEntryByHash(capturedEntry, candidates, stylesheet);
  } finally {
    if (!backendWriteScheduled) pendingWrite.finish();
  }
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
  const precedingInvalidation = projectCSSInvalidations.get(projectSlug);
  const precedingWrites = [...projectCSSPendingWrites.get(projectSlug) ?? []];
  clearProjectCSSLocalFallback(projectSlug);

  const invalidation = (async () => {
    await Promise.allSettled([
      ...(precedingInvalidation ? [precedingInvalidation] : []),
      ...precedingWrites,
    ]);
    clearProjectCSSLocalFallback(projectSlug);

    if (!projectCSSBackend?.delByPattern) return;

    const deleted = await projectCSSBackend.delByPattern(
      `${buildProjectCSSCacheScopePrefix(projectSlug)}*`,
    );
    cssCacheLog.debug("Cleared project CSS cache", { projectSlug, deleted });
  })();
  projectCSSInvalidations.set(projectSlug, invalidation);

  const releaseInvalidation = () => {
    if (projectCSSInvalidations.get(projectSlug) === invalidation) {
      projectCSSInvalidations.delete(projectSlug);
    }
  };
  void invalidation.then(releaseInvalidation, releaseInvalidation);
  return invalidation;
}
