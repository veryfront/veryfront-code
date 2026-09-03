import { AsyncLocalStorage } from "node:async_hooks";
import type { HandlerContext } from "#veryfront/types";
import { type CacheKeyContext, CacheKeyContextSchema } from "./schemas/index.ts";
import { buildContentHashCacheKey } from "./keys.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { currentRequestContext } from "#veryfront/platform/request-context-access.ts";

type MultiProjectRequestContextType = NonNullable<ReturnType<typeof currentRequestContext>>;
const trustedRequestContextAccessor = currentRequestContext;
const registryScopeOwners = new WeakMap<object, object>();
const IntrinsicEncodeURIComponent = encodeURIComponent;
const IntrinsicReflectApply = Reflect.apply;
const NumberPrototypeToString = Number.prototype.toString;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;

export type { CacheKeyContext };

export interface RegistryScopeContext {
  scopeId: string;
  /** Whether completed discovery is safe to retain for this immutable source. */
  immutable: boolean;
}

function encodeRegistryScopeSegment(value: string): string {
  try {
    return IntrinsicEncodeURIComponent(value);
  } catch {
    // encodeURIComponent rejects lone UTF-16 surrogates. Project identity comes
    // from external boundaries, so keep this encoder total without collapsing
    // malformed strings onto the replacement character. `%uXXXX` cannot collide
    // with a literal sequence because encodeURIComponent escapes its `%` first.
    let encoded = "";
    let chunkStart = 0;
    for (let index = 0; index < value.length; index++) {
      const codeUnit = IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
      const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
      const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

      if (
        isHighSurrogate && index + 1 < value.length &&
        (IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index + 1]) as number) >=
          0xdc00 &&
        (IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index + 1]) as number) <= 0xdfff
      ) {
        index++;
        continue;
      }
      if (!isHighSurrogate && !isLowSurrogate) continue;

      encoded += IntrinsicEncodeURIComponent(
        IntrinsicReflectApply(StringPrototypeSlice, value, [chunkStart, index]) as string,
      );
      const hex = IntrinsicReflectApply(NumberPrototypeToString, codeUnit, [16]) as string;
      const upperHex = IntrinsicReflectApply(StringPrototypeToUpperCase, hex, []) as string;
      encoded += `%u${IntrinsicReflectApply(StringPrototypePadStart, upperHex, [
        4,
        "0",
      ]) as string}`;
      chunkStart = index + 1;
    }
    return encoded + IntrinsicEncodeURIComponent(
      IntrinsicReflectApply(StringPrototypeSlice, value, [chunkStart]) as string,
    );
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

/** Build a canonical, delimiter-safe registry scope for a versioned source. */
export function buildVersionedRegistryScopeId(
  projectId: string,
  mode: CacheKeyContext["mode"],
  versionId: string,
): string {
  return `${encodeRegistryScopeSegment(projectId)}:${mode}:` +
    encodeRegistryScopeSegment(versionId);
}

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext | null>();
const IntrinsicObjectDefineProperty = Object.defineProperty;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageDisable = AsyncLocalStoragePrototype.disable;
const AsyncLocalStorageEnterWith = AsyncLocalStoragePrototype.enterWith;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;
IntrinsicObjectDefineProperty(cacheKeyContextStorage, "disable", {
  configurable: false,
  value: AsyncLocalStorageDisable,
  writable: false,
});
IntrinsicObjectDefineProperty(cacheKeyContextStorage, "enterWith", {
  configurable: false,
  value: AsyncLocalStorageEnterWith,
  writable: false,
});
IntrinsicObjectDefineProperty(cacheKeyContextStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(cacheKeyContextStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});

function getCacheKeyContextStore(): CacheKeyContext | null | undefined {
  return IntrinsicReflectApply(AsyncLocalStorageGetStore, cacheKeyContextStorage, []) as
    | CacheKeyContext
    | null
    | undefined;
}

function runWithCacheKeyContextStore<T>(
  context: CacheKeyContext | null,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStorageRun, cacheKeyContextStorage, [
    context,
    fn,
  ]) as T;
}

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
  return runWithCacheKeyContextStore(validateCacheKeyContext(ctx), fn);
}

/**
 * Suppress an inherited explicit cache scope for a callback. This is used when
 * a restored tenant has a mutable source (for example, a production
 * environment without a pinned release) that cannot safely use distributed
 * caching. Ambient request context remains available for in-process registry
 * isolation.
 */
export function runWithoutCacheKeyContext<T>(fn: () => T): T {
  return runWithCacheKeyContextStore(null, fn);
}

export function getCurrentCacheKeyContext(): CacheKeyContext {
  const ctx = getCacheKeyContextStore();
  if (ctx) return ctx;

  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "[CacheKeyBuilder] No cache context available. " +
      "Ensure runWithCacheKeyContext() was called at request entry.",
  });
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
  const explicitCtx = getCacheKeyContextStore();
  if (explicitCtx) return explicitCtx;

  const reqCtx = trustedRequestContextAccessor();
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
  const cacheCtx = getCacheKeyContextStore();
  if (cacheCtx) {
    return {
      scopeId: buildVersionedRegistryScopeId(
        cacheCtx.projectId,
        cacheCtx.mode,
        cacheCtx.versionId,
      ),
      immutable: cacheCtx.mode === "production",
    };
  }

  const reqCtx = trustedRequestContextAccessor();
  if (reqCtx) {
    const projectId = reqCtx.projectId || reqCtx.projectSlug;
    if (!projectId) return null;

    if (reqCtx.productionMode) {
      if (reqCtx.releaseId) {
        return {
          scopeId: buildVersionedRegistryScopeId(
            projectId,
            "production",
            reqCtx.releaseId,
          ),
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
      scopeId: buildVersionedRegistryScopeId(
        projectId,
        "preview",
        reqCtx.branch || "main",
      ),
      immutable: false,
    };
  }

  return null;
}

export function tryGetRegistryScopeId(): string | null {
  return tryGetRegistryScopeContext()?.scopeId ?? null;
}

/**
 * Return an opaque identity for the active hosted request.
 *
 * Registry managers use the token only as a WeakMap key so a request keeps the
 * exact registry generation it first observed, even if that scope is replaced
 * while the request is still running.
 */
export function tryGetRegistryScopeOwner(): object | null {
  const requestContext = trustedRequestContextAccessor();
  if (!requestContext) return null;

  const existing = registryScopeOwners.get(requestContext);
  if (existing) return existing;

  const owner = Object.freeze(Object.create(null)) as object;
  registryScopeOwners.set(requestContext, owner);
  return owner;
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
