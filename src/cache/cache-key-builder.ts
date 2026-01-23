/**
 * Cache Key Builder
 *
 * Two cache key strategies:
 *
 * 1. CONTENT-ADDRESSABLE (transforms, modules):
 *    Key: {prefix}:{filePath}:{contentHash}
 *    - Same content = same cache entry (efficient deduplication)
 *    - Automatic invalidation on content change
 *
 * 2. PROJECT-SCOPED (data fetching, provider config):
 *    Key: {prefix}:{projectId}:{mode}:{versionId}:{resourceKey}
 *    - Isolated per project/release/branch
 *    - For resources without content hash (API responses, config)
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { HandlerContext } from "../types/server.ts";

// Type-only import to avoid circular dependency
// The actual getCurrentRequestContext is loaded lazily below
type MultiProjectRequestContextType = {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
};

// Lazy-loaded to avoid circular dependency
// (multi-project-adapter → proxy-manager → veryfront/index → adapter → file-cache → cache/backend → cache-key-builder)
// undefined = not yet initialized, null = initialized but module not available
let _getCurrentRequestContext: (() => MultiProjectRequestContextType | null) | null | undefined;

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

/**
 * Schema for cache key context validation.
 * Ensures context is properly structured before use.
 */
const CacheKeyContextSchema = z.object({
  projectId: z.string().min(1, "projectId cannot be empty"),
  mode: z.enum(["production", "preview"]),
  versionId: z.string().min(1, "versionId cannot be empty"),
});

/**
 * Validate and normalize a CacheKeyContext.
 * Throws if the context is invalid.
 */
function validateCacheKeyContext(ctx: CacheKeyContext): CacheKeyContext {
  return CacheKeyContextSchema.parse(ctx);
}

// ============================================================================
// CONTENT-ADDRESSABLE KEYS (for transforms, modules)
// ============================================================================

/**
 * Build a content-addressable cache key.
 * Use for caches where same content = same output (transforms, modules).
 *
 * @param prefix - Cache type prefix (e.g., "veryfront:transform")
 * @param filePath - File path being cached
 * @param contentHash - Hash of the file content
 * @param suffix - Optional suffix (e.g., "ssr" or "browser")
 * @returns Cache key
 *
 * @example
 * getContentHashKey("veryfront:transform", "pages/index.tsx", "abc123", "ssr")
 * // → "veryfront:transform:pages/index.tsx:abc123:ssr"
 */
export function getContentHashKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  const base = `${prefix}:${filePath}:${contentHash}`;
  return suffix ? `${base}:${suffix}` : base;
}

// ============================================================================
// PROJECT-SCOPED KEYS (for data fetching, provider config)
// ============================================================================

/**
 * Context for project-scoped cache keys.
 */
export interface CacheKeyContext {
  /** Project identifier (slug or ID) */
  projectId: string;
  /** Rendering mode: production (releases) or preview (branches) */
  mode: "production" | "preview";
  /**
   * Version identifier - mutually exclusive:
   * - Production mode: releaseId (e.g., "rel_abc123")
   * - Preview mode: branch name (e.g., "feature-login", "main")
   */
  versionId: string;
}

// AsyncLocalStorage for request-scoped cache context
const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext>();

/**
 * Run a function with cache key context.
 * All project-scoped cache operations within the callback will use this context.
 *
 * @throws ZodError if context is invalid (programming error - fail fast)
 */
export function runWithCacheKeyContext<T>(ctx: CacheKeyContext, fn: () => T): T {
  const validatedCtx = validateCacheKeyContext(ctx);
  return cacheKeyContextStorage.run(validatedCtx, fn);
}

/**
 * Get the current cache key context.
 * @throws Error if no context is set
 */
export function getCurrentCacheKeyContext(): CacheKeyContext {
  const ctx = cacheKeyContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      "[CacheKeyBuilder] No cache context available. " +
        "Ensure runWithCacheKeyContext() was called at request entry.",
    );
  }
  return ctx;
}

/**
 * Lazily load getCurrentRequestContext to avoid circular dependency.
 * The module is loaded once on first call.
 * Returns undefined if not yet initialized, null if initialized but unavailable.
 */
function getRequestContextFn(): (() => MultiProjectRequestContextType | null) | null {
  if (_getCurrentRequestContext === undefined) {
    // Try synchronous require-style import for the function
    // This works because the module will be loaded by the time this is called
    try {
      // deno-lint-ignore no-explicit-any
      const mod = (globalThis as any).__vf_multi_project_adapter;
      if (mod?.getCurrentRequestContext) {
        _getCurrentRequestContext = mod.getCurrentRequestContext;
      } else {
        // Module not yet loaded, return null
        _getCurrentRequestContext = null;
      }
    } catch {
      _getCurrentRequestContext = null;
    }
  }
  // At this point _getCurrentRequestContext is either a function or null (not undefined)
  return _getCurrentRequestContext ?? null;
}

/**
 * Try to get the current cache key context.
 * Checks in order: 1) explicit cache context, 2) multi-project adapter context
 * @returns Context or null if not set
 */
export function tryGetCacheKeyContext(): CacheKeyContext | null {
  // First, check if explicit cache context is set
  const explicitCtx = cacheKeyContextStorage.getStore();
  if (explicitCtx) return explicitCtx;

  // Fallback: try to get context from multi-project adapter (if initialized)
  const getReqCtx = getRequestContextFn();
  if (getReqCtx) {
    const reqCtx = getReqCtx();
    if (reqCtx) {
      return extractCacheKeyContextFromMultiProjectContext(reqCtx);
    }
  }

  return null;
}

/**
 * Extract CacheKeyContext from multi-project adapter's RequestContext.
 */
function extractCacheKeyContextFromMultiProjectContext(
  reqCtx: MultiProjectRequestContextType,
): CacheKeyContext {
  const projectId = reqCtx.projectId || reqCtx.projectSlug || "default";
  const mode = reqCtx.productionMode ? "production" : "preview";
  const versionId = reqCtx.productionMode
    ? (reqCtx.releaseId || "latest")
    : (reqCtx.branch || "main");

  return { projectId, mode, versionId };
}

/**
 * Build a project-scoped cache key.
 * Use for caches that need project/version isolation (data fetching, config).
 *
 * Returns null in preview mode (no caching without content hash).
 *
 * @param prefix - Cache type prefix (e.g., "veryfront:data")
 * @param resourceKey - Resource identifier
 * @returns Cache key or null if preview mode
 *
 * @example
 * getProjectScopedKey("veryfront:data", "/api/users::{}");
 * // → "veryfront:data:my-project:production:rel_abc:/api/users::{}"
 * // → null (in preview mode - don't cache without content hash)
 */
export function getProjectScopedKey(
  prefix: string,
  resourceKey: string,
): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx) return null;

  // Only cache in production mode
  // Preview mode without content hash would serve stale content on file changes
  if (ctx.mode === "preview") {
    return null;
  }

  return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}

/**
 * Build a project-scoped cache key (always, even in preview).
 * Use only when you have a separate invalidation mechanism.
 */
export function getProjectScopedKeyAlways(
  prefix: string,
  resourceKey: string,
): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx) return null;
  return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}

// ============================================================================
// CONTEXT EXTRACTION HELPERS
// ============================================================================

/**
 * Extract CacheKeyContext from HandlerContext.
 */
export function extractCacheKeyContext(handlerCtx: HandlerContext): CacheKeyContext {
  const projectId = handlerCtx.projectId || handlerCtx.projectSlug || "default";

  // Use requestContext.mode (unified from hostname/headers)
  const mode = handlerCtx.requestContext?.mode || "preview";

  // Version: releaseId (production) or branch (preview)
  const versionId = mode === "production"
    ? (handlerCtx.releaseId || "latest")
    : (handlerCtx.parsedDomain?.branch || "main");

  return { projectId, mode, versionId };
}

/**
 * Re-export the RequestContext type from multi-project adapter for external use.
 */
export type { MultiProjectRequestContextType as MultiProjectRequestContext };

/**
 * Extract CacheKeyContext from MultiProjectRequestContext.
 * @deprecated Use tryGetCacheKeyContext() which auto-detects context
 */
export function extractCacheKeyContextFromRequestContext(
  reqCtx: MultiProjectRequestContextType,
): CacheKeyContext {
  return extractCacheKeyContextFromMultiProjectContext(reqCtx);
}

// Note: isKeyForProject and createCacheKeyFilter are in registry.ts and keys.ts respectively
// to avoid circular dependencies and keep implementations with their primary consumers.
