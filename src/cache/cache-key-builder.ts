import { AsyncLocalStorage } from "node:async_hooks";
import type { HandlerContext } from "#veryfront/types";
import { type CacheKeyContext, CacheKeyContextSchema } from "./schemas/index.ts";
import { buildContentHashCacheKey } from "./keys.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { encodeCacheIdentitySegment } from "./keys/source-identity.ts";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";

type MultiProjectRequestContextType = {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
};

type AmbientCacheRequestContext = Pick<
  MultiProjectRequestContextType,
  | "projectSlug"
  | "projectId"
  | "productionMode"
  | "releaseId"
  | "branch"
  | "environmentName"
>;

export type { CacheKeyContext };

export interface RegistryScopeContext {
  scopeId: string;
  /** Whether completed discovery is safe to retain for this immutable source. */
  immutable: boolean;
}

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext | null>();

const REGISTRY_SCOPE_PREFIX = "scope-v1";
const MAX_REGISTRY_SCOPE_SEGMENT_LENGTH = 4096;
const MAX_REGISTRY_SCOPE_LENGTH = 16_384;

function encodeRegistryScope(segments: readonly string[]): string {
  let result = REGISTRY_SCOPE_PREFIX;
  for (const segment of segments) {
    if (
      !segment || segment.length > MAX_REGISTRY_SCOPE_SEGMENT_LENGTH ||
      containsUnsafeCacheStringCharacter(segment)
    ) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Invalid registry scope identity",
      });
    }
    result += `:${segment.length}:${segment}`;
    if (result.length > MAX_REGISTRY_SCOPE_LENGTH) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Registry scope identity exceeds the supported size",
      });
    }
  }
  return result;
}

function decodeRegistryScope(scopeId: string): string[] | null {
  if (!scopeId.startsWith(`${REGISTRY_SCOPE_PREFIX}:`)) return null;

  const segments: string[] = [];
  let cursor = REGISTRY_SCOPE_PREFIX.length;
  while (cursor < scopeId.length) {
    if (scopeId[cursor] !== ":") return null;
    const lengthEnd = scopeId.indexOf(":", cursor + 1);
    if (lengthEnd === -1) return null;
    const rawLength = scopeId.slice(cursor + 1, lengthEnd);
    if (!/^(0|[1-9]\d{0,4})$/.test(rawLength)) return null;
    const length = Number(rawLength);
    if (length < 1 || length > MAX_REGISTRY_SCOPE_SEGMENT_LENGTH) return null;
    const valueStart = lengthEnd + 1;
    const valueEnd = valueStart + length;
    if (valueEnd > scopeId.length) return null;
    segments.push(scopeId.slice(valueStart, valueEnd));
    cursor = valueEnd;
  }
  return segments;
}

/** Match a structured registry scope to its exact owning project identity. */
export function registryScopeMatchesProject(
  scopeId: string,
  projectId: string,
): boolean {
  const segments = decodeRegistryScope(scopeId);
  return segments !== null && segments[0] === projectId;
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

function readAmbientRequestContext(): AmbientCacheRequestContext | null {
  try {
    const adapter = Reflect.get(globalThis, "__vf_multi_project_adapter");
    if (typeof adapter !== "object" || adapter === null || Array.isArray(adapter)) return null;

    const getCurrentRequestContext = Reflect.get(adapter, "getCurrentRequestContext");
    if (typeof getCurrentRequestContext !== "function") return null;

    const rawContext = Reflect.apply(getCurrentRequestContext, adapter, []);
    if (typeof rawContext !== "object" || rawContext === null || Array.isArray(rawContext)) {
      return null;
    }

    const readRequiredString = (key: string, allowEmpty: boolean): string => {
      const value = Reflect.get(rawContext, key);
      if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
        throw new TypeError(`Invalid ambient cache context ${key}`);
      }
      if (value.length > 0) encodeCacheIdentitySegment(value, key);
      return value;
    };
    const readOptionalString = (key: string): string | null | undefined => {
      const value = Reflect.get(rawContext, key);
      if (value === undefined || value === null) return value;
      if (typeof value !== "string") {
        throw new TypeError(`Invalid ambient cache context ${key}`);
      }
      if (value.length > 0) encodeCacheIdentitySegment(value, key);
      return value;
    };
    const productionMode = Reflect.get(rawContext, "productionMode");
    if (typeof productionMode !== "boolean") return null;

    return Object.freeze({
      projectSlug: readRequiredString("projectSlug", true),
      projectId: readOptionalString("projectId") ?? undefined,
      productionMode,
      releaseId: readOptionalString("releaseId"),
      branch: readOptionalString("branch"),
      environmentName: readOptionalString("environmentName"),
    });
  } catch {
    // The adapter is optional and may be installed, replaced, or torn down at
    // runtime. Invalid ambient state disables caching for this operation.
    return null;
  }
}

function extractCacheKeyContextFromMultiProjectContext(
  reqCtx: AmbientCacheRequestContext,
): CacheKeyContext | null {
  // A genuinely missing project identity must NOT collapse to a shared "default"
  // bucket. That would let unrelated projects serve each other's cached pages.
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

  const reqCtx = readAmbientRequestContext();
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
      scopeId: encodeRegistryScope([cacheCtx.projectId, cacheCtx.mode, cacheCtx.versionId]),
      immutable: cacheCtx.mode === "production",
    };
  }

  const reqCtx = readAmbientRequestContext();
  if (reqCtx) {
    const projectId = reqCtx.projectId || reqCtx.projectSlug;
    if (!projectId) return null;

    if (reqCtx.productionMode) {
      if (reqCtx.releaseId) {
        return {
          scopeId: encodeRegistryScope([projectId, "production", reqCtx.releaseId]),
          immutable: true,
        };
      }

      // Match ProxyFSAdapterManager's canonical default so registry,
      // discovery, and adapter caches all describe the same content source.
      const environmentName = reqCtx.environmentName || "production";
      return {
        scopeId: encodeRegistryScope([
          projectId,
          "production",
          "environment",
          environmentName,
        ]),
        immutable: false,
      };
    }

    return {
      scopeId: encodeRegistryScope([projectId, "preview", reqCtx.branch || "main"]),
      immutable: false,
    };
  }

  return null;
}

export function tryGetRegistryScopeId(): string | null {
  return tryGetRegistryScopeContext()?.scopeId ?? null;
}

function buildProjectScopedKey(prefix: string, resourceKey: string, ctx: CacheKeyContext): string {
  if (
    typeof prefix !== "string" || prefix.length === 0 || prefix.length > 512 ||
    containsUnsafeCacheStringCharacter(prefix)
  ) {
    throw CACHE_INVARIANT_VIOLATION.create({ detail: "Invalid project cache key prefix" });
  }
  if (
    typeof resourceKey !== "string" || resourceKey.length === 0 || resourceKey.length > 65_536 ||
    containsUnsafeCacheStringCharacter(resourceKey)
  ) {
    throw CACHE_INVARIANT_VIOLATION.create({ detail: "Invalid project cache resource key" });
  }
  const projectId = encodeCacheIdentitySegment(ctx.projectId, "projectId");
  const versionId = encodeCacheIdentitySegment(ctx.versionId, "versionId");
  return `${prefix}:${projectId}:${ctx.mode}:${versionId}:${resourceKey}`;
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
  // bucket when identity is missing. A shared bucket would be a cross-tenant
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
