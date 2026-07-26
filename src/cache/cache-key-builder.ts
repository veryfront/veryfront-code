import { AsyncLocalStorage } from "node:async_hooks";
import type { HandlerContext } from "#veryfront/types";
import { type CacheKeyContext, CacheKeyContextSchema } from "./schemas/index.ts";
import { buildContentHashCacheKey } from "./keys.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";

const AsyncLocalStoragePrototypeGetStore = AsyncLocalStorage.prototype.getStore;
const AsyncLocalStoragePrototypeRun = AsyncLocalStorage.prototype.run;
const EncodeURIComponent = encodeURIComponent;
const IntrinsicWeakMap = WeakMap;
const NumberPrototypeToString = Number.prototype.toString;
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const WeakMapPrototypeDelete = WeakMap.prototype.delete;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;

type MultiProjectRequestContextType = {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
};

type RevokedMultiProjectRequestContext = {
  readonly revoked: true;
};

type MultiProjectRequestContextSnapshot =
  | MultiProjectRequestContextType
  | RevokedMultiProjectRequestContext;

type MultiProjectRequestContextProvider = () => MultiProjectRequestContextSnapshot | null;

let getCurrentRequestContextProvider: MultiProjectRequestContextProvider | undefined;
const registryScopeOwners = new IntrinsicWeakMap<object, object>();

function isRevokedRequestContext(
  context: MultiProjectRequestContextSnapshot | null | undefined,
): context is RevokedMultiProjectRequestContext {
  return context !== null && context !== undefined && "revoked" in context &&
    context.revoked === true;
}

function getMultiProjectRequestContextSnapshot(): MultiProjectRequestContextSnapshot | null {
  return getCurrentRequestContextProvider?.() ?? null;
}

function weakMapDelete<K extends object, V>(map: WeakMap<K, V>, key: K): void {
  ReflectApply(WeakMapPrototypeDelete, map, [key]);
}

function weakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return ReflectApply(WeakMapPrototypeGet, map, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(map: WeakMap<K, V>, key: K, value: V): void {
  ReflectApply(WeakMapPrototypeSet, map, [key, value]);
}

function throwFinalizedRequestContextInvariant(): never {
  throw CACHE_INVARIANT_VIOLATION.create({
    detail: "[CacheKeyBuilder] Registry access attempted from a finalized request context",
  });
}

/**
 * Installs the platform-owned ambient request-context bridge exactly once.
 *
 * This deliberately keeps the provider in module-private state instead of a
 * writable global. Re-registering the same provider is harmless for duplicate
 * bootstrap paths, while a competing provider is an invariant violation.
 */
export function registerMultiProjectRequestContextProvider(
  provider: MultiProjectRequestContextProvider,
): void {
  if (typeof provider !== "function") {
    throw new TypeError("Multi-project request context provider must be a function");
  }
  if (getCurrentRequestContextProvider === undefined) {
    getCurrentRequestContextProvider = provider;
    return;
  }
  if (getCurrentRequestContextProvider !== provider) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "[CacheKeyBuilder] Multi-project request context provider is already registered",
    });
  }
}

export type { CacheKeyContext };

export interface RegistryScopeContext {
  scopeId: string;
  /** Whether completed discovery is safe to retain for this immutable source. */
  immutable: boolean;
}

function getStringCodeUnit(value: string, index: number): number {
  return ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function formatEscapedCodeUnit(codeUnit: number): string {
  const hex = ReflectApply(NumberPrototypeToString, codeUnit, [16]) as string;
  const upperHex = ReflectApply(StringPrototypeToUpperCase, hex, []) as string;
  return `%u${ReflectApply(StringPrototypePadStart, upperHex, [4, "0"]) as string}`;
}

function encodeRegistryScopeSegment(value: string): string {
  try {
    return EncodeURIComponent(value);
  } catch {
    // encodeURIComponent rejects lone UTF-16 surrogates. Project identity comes
    // from external boundaries, so keep this encoder total without collapsing
    // malformed strings onto the replacement character. `%uXXXX` cannot collide
    // with a literal sequence because encodeURIComponent escapes its `%` first.
    let encoded = "";
    let chunkStart = 0;
    for (let index = 0; index < value.length; index++) {
      const codeUnit = getStringCodeUnit(value, index);
      const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
      const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
      const nextCodeUnit = isHighSurrogate && index + 1 < value.length
        ? getStringCodeUnit(value, index + 1)
        : -1;

      if (
        isHighSurrogate &&
        nextCodeUnit >= 0xdc00 &&
        nextCodeUnit <= 0xdfff
      ) {
        index++;
        continue;
      }
      if (!isHighSurrogate && !isLowSurrogate) continue;

      encoded += EncodeURIComponent(
        ReflectApply(StringPrototypeSlice, value, [chunkStart, index]) as string,
      );
      encoded += formatEscapedCodeUnit(codeUnit);
      chunkStart = index + 1;
    }
    return encoded +
      EncodeURIComponent(ReflectApply(StringPrototypeSlice, value, [chunkStart]) as string);
  }
}

/**
 * Build the canonical registry scope for a versioned preview or production
 * source. Every segment is encoded independently so delimiter-bearing tenant
 * identifiers cannot alias another scope.
 */
export function buildVersionedRegistryScopeId(
  projectId: string,
  mode: CacheKeyContext["mode"],
  versionId: string,
): string {
  return `${encodeRegistryScopeSegment(projectId)}:${mode}:` +
    encodeRegistryScopeSegment(versionId);
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
  return ReflectApply(
    StringPrototypeStartsWith,
    scopeId,
    [`${encodeRegistryScopeSegment(projectId)}:`],
  ) as boolean;
}

const cacheKeyContextStorage = new AsyncLocalStorage<CacheKeyContext | null>();

function getCacheKeyContextStore(): CacheKeyContext | null | undefined {
  return ReflectApply(
    AsyncLocalStoragePrototypeGetStore,
    cacheKeyContextStorage,
    [],
  ) as CacheKeyContext | null | undefined;
}

function runWithCacheKeyContextStore<T>(
  ctx: CacheKeyContext | null,
  fn: () => T,
): T {
  return ReflectApply(
    AsyncLocalStoragePrototypeRun,
    cacheKeyContextStorage,
    [ctx, fn],
  ) as T;
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
  const reqCtx = getMultiProjectRequestContextSnapshot();
  if (isRevokedRequestContext(reqCtx)) return null;

  const explicitCtx = getCacheKeyContextStore();
  if (explicitCtx) return explicitCtx;

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
  const reqCtx = getMultiProjectRequestContextSnapshot();
  if (isRevokedRequestContext(reqCtx)) {
    throwFinalizedRequestContextInvariant();
  }

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
 * Registry managers use this only as a WeakMap key to retain the exact
 * generation first observed by an in-flight request. The token contains no
 * tenant metadata or credentials and is released when the request finalizes.
 */
export function tryGetRegistryScopeOwner(): object | null {
  const requestContext = getMultiProjectRequestContextSnapshot();
  if (!requestContext) return null;
  if (isRevokedRequestContext(requestContext)) {
    throwFinalizedRequestContextInvariant();
  }

  const existing = weakMapGet(registryScopeOwners, requestContext);
  if (existing) return existing;

  const owner = ReflectApply(ObjectFreeze, undefined, [{}]) as object;
  weakMapSet(registryScopeOwners, requestContext, owner);
  return owner;
}

/**
 * Release the opaque generation owner for a finalized request context.
 *
 * The request context itself can remain reachable from detached async work;
 * deleting this association lets registry generation snapshots become
 * collectible immediately after the trusted request lifecycle ends.
 */
export function releaseRegistryScopeOwner(requestContext: object): void {
  weakMapDelete(registryScopeOwners, requestContext);
}

const PROJECT_SCOPED_CACHE_KEY_PREFIX = "project-scoped:v2";

/**
 * Escape code units that UTF-8 transports cannot preserve injectively.
 *
 * Valid Unicode and ordinary route text remain readable. Literal `%` is escaped
 * first so `%uXXXX` for an unpaired surrogate cannot alias caller-provided text.
 */
function escapeProjectScopedKeyTransportText(value: string): string {
  let escaped = "";
  let chunkStart = 0;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = getStringCodeUnit(value, index);
    const isPercent = codeUnit === 0x25;
    const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
    const nextCodeUnit = isHighSurrogate && index + 1 < value.length
      ? getStringCodeUnit(value, index + 1)
      : -1;

    if (
      !isPercent &&
      isHighSurrogate &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      index++;
      continue;
    }
    if (!isPercent && !isHighSurrogate && !isLowSurrogate) continue;

    escaped += ReflectApply(StringPrototypeSlice, value, [chunkStart, index]) as string;
    escaped += isPercent ? "%25" : formatEscapedCodeUnit(codeUnit);
    chunkStart = index + 1;
  }

  return escaped + (ReflectApply(StringPrototypeSlice, value, [chunkStart]) as string);
}

/**
 * Frame one transport-safe string without relying on delimiter escaping.
 *
 * The escaped UTF-16 code-unit length makes composition injective even when
 * values contain `:`, `|`, frame-like text, or unpaired surrogates.
 */
function frameProjectScopedKeySegment(value: string): string {
  const escaped = escapeProjectScopedKeyTransportText(value);
  return `${escaped.length}:${escaped}`;
}

/**
 * Match user-facing search text against both legacy/raw keys and v2's
 * transport-safe representation.
 *
 * @internal Used by caches that intentionally support substring invalidation.
 */
export function projectScopedKeyIncludesSearchText(
  key: string,
  searchText: string,
): boolean {
  const isV2Key = ReflectApply(
    StringPrototypeStartsWith,
    key,
    [`${PROJECT_SCOPED_CACHE_KEY_PREFIX}:`],
  ) as boolean;
  const representedSearchText = isV2Key
    ? escapeProjectScopedKeyTransportText(searchText)
    : searchText;
  return ReflectApply(StringPrototypeIncludes, key, [representedSearchText]) as boolean;
}

/**
 * Compose the distributed cache identity for one project/source/resource.
 *
 * `v2` intentionally does not read or reproduce the legacy delimiter-only
 * format. Deploying this version causes safe cache misses instead of consulting
 * keys whose tenant/source boundaries cannot be reconstructed unambiguously.
 */
function buildProjectScopedKey(prefix: string, resourceKey: string, ctx: CacheKeyContext): string {
  return `${PROJECT_SCOPED_CACHE_KEY_PREFIX}:${frameProjectScopedKeySegment(prefix)}|${
    frameProjectScopedKeySegment(ctx.projectId)
  }|${frameProjectScopedKeySegment(ctx.mode)}|${frameProjectScopedKeySegment(ctx.versionId)}|${
    frameProjectScopedKeySegment(resourceKey)
  }`;
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
