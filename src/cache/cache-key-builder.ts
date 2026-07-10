import { AsyncLocalStorage } from "node:async_hooks";
import type { HandlerContext } from "#veryfront/types";
import { type CacheKeyContext, CacheKeyContextSchema } from "./schemas/index.ts";
import { buildContentHashCacheKey } from "./keys.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";

type MultiProjectRequestContextType = {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
};

let _getCurrentRequestContext: (() => MultiProjectRequestContextType | null) | null | undefined;

export type { CacheKeyContext };

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext>();

function validateCacheKeyContext(ctx: CacheKeyContext): CacheKeyContext {
  return CacheKeyContextSchema.parse(ctx);
}

export function getContentHashKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  return buildContentHashCacheKey(prefix, filePath, contentHash, suffix);
}

export function runWithCacheKeyContext<T>(ctx: CacheKeyContext, fn: () => T): T {
  return cacheKeyContextStorage.run(validateCacheKeyContext(ctx), fn);
}

export function getCurrentCacheKeyContext(): CacheKeyContext {
  const ctx = cacheKeyContextStorage.getStore();
  if (ctx) return ctx;

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "[CacheKeyBuilder] No cache context available. " +
      "Ensure runWithCacheKeyContext() was called at request entry.",
  });
}

function getRequestContextFn(): (() => MultiProjectRequestContextType | null) | null {
  if (_getCurrentRequestContext !== undefined) return _getCurrentRequestContext;

  try {
    const mod = (globalThis as Record<string, unknown>).__vf_multi_project_adapter as
      | { getCurrentRequestContext?: () => MultiProjectRequestContextType | null }
      | undefined;
    _getCurrentRequestContext = mod?.getCurrentRequestContext ?? null;
  } catch (_) {
    // expected: multi-project adapter may not be available
    _getCurrentRequestContext = null;
  }

  return _getCurrentRequestContext ?? null;
}

function extractCacheKeyContextFromMultiProjectContext(
  reqCtx: MultiProjectRequestContextType,
): CacheKeyContext | null {
  // A genuinely missing project identity must NOT collapse to a shared "default"
  // bucket — that would let unrelated projects serve each other's cached pages.
  // Return null instead so callers skip caching for this request.
  const projectId = reqCtx.projectId || reqCtx.projectSlug;
  if (!projectId) return null;

  const mode: CacheKeyContext["mode"] = reqCtx.productionMode ? "production" : "preview";

  let versionId: string;
  if (reqCtx.productionMode) {
    // In production a missing releaseId is an invariant violation, not a bucket we
    // can safely default to "latest" (all releases would collide). Skip caching.
    if (!reqCtx.releaseId) return null;
    versionId = reqCtx.releaseId;
  } else {
    // Preview: branch is a real scoping segment, and "main" is a safe default.
    versionId = reqCtx.branch || "main";
  }

  return { projectId, mode, versionId };
}

export function tryGetCacheKeyContext(): CacheKeyContext | null {
  const explicitCtx = cacheKeyContextStorage.getStore();
  if (explicitCtx) return explicitCtx;

  const reqCtx = getRequestContextFn()?.();
  if (!reqCtx) return null;

  return extractCacheKeyContextFromMultiProjectContext(reqCtx);
}

function buildProjectScopedKey(prefix: string, resourceKey: string, ctx: CacheKeyContext): string {
  return `${prefix}:${ctx.projectId}:${ctx.mode}:${ctx.versionId}:${resourceKey}`;
}

export function getProjectScopedKey(prefix: string, resourceKey: string): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx || ctx.mode === "preview") return null;

  return buildProjectScopedKey(prefix, resourceKey, ctx);
}

export function getProjectScopedKeyAlways(prefix: string, resourceKey: string): string | null {
  const ctx = tryGetCacheKeyContext();
  if (!ctx) return null;

  return buildProjectScopedKey(prefix, resourceKey, ctx);
}

export function extractCacheKeyContext(handlerCtx: HandlerContext): CacheKeyContext | null {
  // Return null (skip caching) rather than collapsing to a shared "default"
  // bucket when identity is missing — a shared bucket would be a cross-tenant
  // risk, but crashing lightweight no-identity paths (e.g. local CSS/JIT) is
  // worse than simply not caching. Callers must treat null as "do not cache".
  const projectId = handlerCtx.projectId || handlerCtx.projectSlug;
  if (!projectId) {
    return null;
  }

  const mode = handlerCtx.resolvedEnvironment ?? handlerCtx.requestContext?.mode ?? "preview";

  let versionId: string;
  if (mode === "production") {
    // A production release without a releaseId cannot share a "latest" bucket
    // across releases without cross-release cache pollution; skip caching.
    if (!handlerCtx.releaseId) {
      return null;
    }
    versionId = handlerCtx.releaseId;
  } else {
    versionId = handlerCtx.parsedDomain?.branch || "main";
  }

  return { projectId, mode, versionId };
}

export type { MultiProjectRequestContextType as MultiProjectRequestContext };
