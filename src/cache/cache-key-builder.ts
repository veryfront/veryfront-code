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

export interface RegistryScopeContext {
  scopeId: string;
  /** Whether completed discovery is safe to retain for this immutable source. */
  immutable: boolean;
}

function encodeRegistryScopeSegment(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;

    // encodeURIComponent rejects lone UTF-16 surrogates. Project identity comes
    // from external boundaries, so keep this encoder total without collapsing
    // malformed strings onto the replacement character. `%uXXXX` cannot collide
    // with a literal sequence because encodeURIComponent escapes its `%` first.
    let encoded = "";
    let chunkStart = 0;
    for (let index = 0; index < value.length; index++) {
      const codeUnit = value.charCodeAt(index);
      const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
      const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

      if (
        isHighSurrogate && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff
      ) {
        index++;
        continue;
      }
      if (!isHighSurrogate && !isLowSurrogate) continue;

      encoded += encodeURIComponent(value.slice(chunkStart, index));
      encoded += `%u${codeUnit.toString(16).toUpperCase().padStart(4, "0")}`;
      chunkStart = index + 1;
    }
    return encoded + encodeURIComponent(value.slice(chunkStart));
  }
}

/**
 * Check whether a registry scope belongs to a raw project ID.
 *
 * The project ID is always encoded before matching. Treating it as a possible
 * complete scope ID would make a delimiter-bearing project ID ambiguous with a
 * different project's scope.
 */
export function isRegistryScopeForProject(
  scopeId: string,
  projectId: string,
): boolean {
  return scopeId.startsWith(`${encodeRegistryScopeSegment(projectId)}:`);
}

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext | null>();

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

/**
 * Suppress an inherited explicit cache scope for a callback. This is used when
 * a restored tenant has a mutable source (for example, a production
 * environment without a pinned release) that cannot safely use distributed
 * caching. Ambient request context remains available for in-process registry
 * isolation.
 */
export function runWithoutCacheKeyContext<T>(fn: () => T): T {
  return cacheKeyContextStorage.run(null, fn);
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
  // Memoize only once the adapter is actually resolved. A miss must NOT be cached
  // permanently: the multi-project adapter can be installed on globalThis after
  // the first call, and caching null here would disable distributed caching for
  // the whole process lifetime even after the adapter is later wired.
  if (_getCurrentRequestContext) return _getCurrentRequestContext;

  try {
    const mod = (globalThis as Record<string, unknown>).__vf_multi_project_adapter as
      | { getCurrentRequestContext?: () => MultiProjectRequestContextType | null }
      | undefined;
    const fn = mod?.getCurrentRequestContext ?? null;
    if (fn) _getCurrentRequestContext = fn;
    return fn;
  } catch (_) {
    // expected: multi-project adapter may not be available yet — re-check next call
    return null;
  }
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

/**
 * Returns a stable scope identifier for in-process registry isolation.
 *
 * Unlike tryGetCacheKeyContext(), this function does NOT return null when the
 * request context lacks a field that would be required for a safe distributed
 * cache key (e.g. productionMode=true without a releaseId). For in-process
 * registries (ProjectScopedRegistryManager), project identity and the active
 * content source still provide a safe process-local scope. Collapsing to
 * "__default__" would let concurrent projects overwrite one another's
 * registered skills, tools, and agents.
 *
 * Returns null only when no project identity is available at all (e.g. CLI /
 * local dev without a multi-project context), in which case the caller should
 * fall back to DEFAULT_SCOPE_ID.
 */
export function tryGetRegistryScopeContext(): RegistryScopeContext | null {
  // Explicit contexts are authoritative for workflows and other callers that
  // intentionally override ambient filesystem tenancy.
  const cacheCtx = cacheKeyContextStorage.getStore();
  if (cacheCtx) {
    return {
      scopeId: `${encodeRegistryScopeSegment(cacheCtx.projectId)}:${cacheCtx.mode}:` +
        encodeRegistryScopeSegment(cacheCtx.versionId),
      immutable: cacheCtx.mode === "production",
    };
  }

  const reqCtx = getRequestContextFn()?.();
  if (reqCtx) {
    const projectId = reqCtx.projectId || reqCtx.projectSlug;
    if (!projectId) return null;

    if (reqCtx.productionMode) {
      if (reqCtx.releaseId) {
        return {
          scopeId: `${encodeRegistryScopeSegment(projectId)}:production:` +
            encodeRegistryScopeSegment(reqCtx.releaseId),
          immutable: true,
        };
      }

      // Match ProxyFSAdapterManager's canonical default so registry,
      // discovery, and adapter caches all describe the same content source.
      const environmentName = reqCtx.environmentName || "production";
      return {
        scopeId: `${encodeRegistryScopeSegment(projectId)}:production:environment:` +
          encodeRegistryScopeSegment(environmentName),
        immutable: false,
      };
    }

    return {
      scopeId: `${encodeRegistryScopeSegment(projectId)}:preview:` +
        encodeRegistryScopeSegment(reqCtx.branch || "main"),
      immutable: false,
    };
  }

  return null;
}

export function tryGetRegistryScopeId(): string | null {
  return tryGetRegistryScopeContext()?.scopeId ?? null;
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
