import { AsyncLocalStorage } from "node:async_hooks";
import {
  registerMultiProjectRequestContextProvider,
  releaseRegistryScopeOwner,
} from "#veryfront/cache/cache-key-builder.ts";

export interface RequestContext {
  projectSlug: string;
  projectId?: string;
  token: string;
  productionMode: boolean;
  /** Release ID for production mode (mutually exclusive with branch) */
  releaseId?: string | null;
  /** Branch name for preview mode (mutually exclusive with releaseId) */
  branch?: string | null;
  /** Actual environment name from API (e.g., "Development", "Production") */
  environmentName?: string | null;
  /**
   * Request-scoped file content cache.
   * Deduplicates file fetches within a single HTTP request.
   * This is especially important in preview mode where the persistent cache is disabled.
   */
  fileCache?: Map<string, string>;
  /**
   * Immutable credential for file API calls made by the exact project request.
   *
   * This is intentionally separate from `cacheApiCredential`: every hosted
   * filesystem request needs file API access, while cache API access is only
   * permitted when the caller proved project-bound token provenance.
   */
  requestApiCredential?: Readonly<{
    token: string;
    projectSlug: string;
    projectId?: string;
  }>;
  /** Immutable capability used only when the caller explicitly proved token/project binding. */
  cacheApiCredential?: Readonly<{
    token: string;
    projectSlug: string;
    projectId?: string;
  }>;
}

export type RequestTokenProvenance = "project-bound" | "untrusted";

export interface RequestContextOptions {
  projectSlug: string;
  token: string;
  projectId?: string;
  productionMode?: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
  tokenProvenance?: RequestTokenProvenance;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

type RequestContextFinalizer = () => void;

const IntrinsicAggregateError = AggregateError;
const IntrinsicMap = Map;
const IntrinsicSet = Set;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const ArrayPrototypePush = Array.prototype.push;
const AsyncLocalStoragePrototypeEnterWith = AsyncLocalStorage.prototype.enterWith;
const AsyncLocalStoragePrototypeGetStore = AsyncLocalStorage.prototype.getStore;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const MapSizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "size");
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeForEach = Set.prototype.forEach;
const WeakMapPrototypeDelete = WeakMap.prototype.delete;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;

if (typeof MapSizeDescriptor?.get !== "function") {
  throw new TypeError("Map.prototype.size getter is unavailable");
}
const MapSizeGetter = MapSizeDescriptor.get;

function getStore(): RequestContext | undefined {
  const context = getRawStore();
  return context && !weakSetHas(finalizedRequestContexts, context) ? context : undefined;
}

function getRawStore(): RequestContext | undefined {
  const context = ReflectApply(
    AsyncLocalStoragePrototypeGetStore,
    asyncLocalStorage,
    [],
  ) as RequestContext | undefined;
  return context;
}

function runInContext<T>(context: RequestContext, fn: () => T): T {
  const previous = getRawStore();
  if (previous === context) return fn();

  ReflectApply(AsyncLocalStoragePrototypeEnterWith, asyncLocalStorage, [context]);
  try {
    return fn();
  } finally {
    ReflectApply(AsyncLocalStoragePrototypeEnterWith, asyncLocalStorage, [previous]);
  }
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapClear<K, V>(map: Map<K, V>): void {
  ReflectApply(MapPrototypeClear, map, []);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(MapSizeGetter, map, []) as number;
}

function weakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return ReflectApply(WeakMapPrototypeGet, map, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(map: WeakMap<K, V>, key: K, value: V): void {
  ReflectApply(WeakMapPrototypeSet, map, [key, value]);
}

function weakMapDelete<K extends object, V>(map: WeakMap<K, V>, key: K): void {
  ReflectApply(WeakMapPrototypeDelete, map, [key]);
}

function weakSetAdd<T extends object>(set: WeakSet<T>, value: T): void {
  ReflectApply(WeakSetPrototypeAdd, set, [value]);
}

function weakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean {
  return ReflectApply(WeakSetPrototypeHas, set, [value]) as boolean;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setForEach<T>(set: Set<T>, callback: (value: T) => void): void {
  ReflectApply(SetPrototypeForEach, set, [callback]);
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return ReflectApply(ObjectFreeze, undefined, [value]) as Readonly<T>;
}

function arrayPush<T>(array: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, array, [value]);
}

const requestContextFinalizers = new IntrinsicWeakMap<
  RequestContext,
  Set<RequestContextFinalizer>
>();
const finalizedRequestContexts = new IntrinsicWeakSet<RequestContext>();
const revokedRequestContextSnapshot = freezeObject({ revoked: true as const });

export function getCurrentRequestContext(): RequestContext | null {
  return getStore() ?? null;
}

/**
 * Returns ambient tenancy without exposing credentials after request teardown.
 *
 * Detached async descendants retain their AsyncLocalStorage store. Returning
 * `null` for a finalized store would make downstream registry code mistake the
 * descendant for ordinary local/CLI work and fall back to the default scope.
 * The credential-free sentinel lets those boundaries fail closed instead.
 */
function getRequestContextSnapshotForScoping():
  | RequestContext
  | Readonly<{ revoked: true }>
  | null {
  const context = getRawStore();
  if (!context) return null;
  return weakSetHas(finalizedRequestContexts, context) ? revokedRequestContextSnapshot : context;
}

/**
 * Registers lifecycle cleanup owned by the exact request context.
 *
 * The finalizer is rejected after the request has completed so detached work
 * cannot accidentally acquire a resource lease that will never be released.
 */
export function registerRequestContextFinalizer(
  context: RequestContext,
  finalizer: RequestContextFinalizer,
): boolean {
  if (weakSetHas(finalizedRequestContexts, context)) return false;

  let finalizers = weakMapGet(requestContextFinalizers, context);
  if (!finalizers) {
    finalizers = new IntrinsicSet();
    weakMapSet(requestContextFinalizers, context, finalizers);
  }
  setAdd(finalizers, finalizer);
  return true;
}

function finalizeRequestContext(context: RequestContext): unknown[] {
  if (weakSetHas(finalizedRequestContexts, context)) return [];
  weakSetAdd(finalizedRequestContexts, context);
  releaseRegistryScopeOwner(context);

  const finalizers = weakMapGet(requestContextFinalizers, context);
  weakMapDelete(requestContextFinalizers, context);
  if (!finalizers) return [];

  const cleanupErrors: unknown[] = [];
  setForEach(finalizers, (finalizer) => {
    try {
      finalizer();
    } catch (error) {
      arrayPush(cleanupErrors, error);
    }
  });
  return cleanupErrors;
}

function throwCleanupErrors(cleanupErrors: unknown[]): void {
  if (cleanupErrors.length === 0) return;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new IntrinsicAggregateError(
    cleanupErrors,
    "Multiple request-context finalizers failed",
  );
}

type StreamingResponseLease = {
  response: Response;
  completion: Promise<void>;
};

function leaseStreamingResponse(response: Response): StreamingResponseLease | null {
  const source = response.body;
  if (!source) return null;

  const reader = source.getReader();
  let leaseSettled = false;
  let resolveLease = () => {};
  let rejectLease = (_error: unknown) => {};
  const completion = new Promise<void>((resolve, reject) => {
    resolveLease = resolve;
    rejectLease = reject;
  });

  const completeLease = (): void => {
    if (leaseSettled) return;
    leaseSettled = true;
    resolveLease();
  };
  const failLease = (error: unknown): void => {
    if (leaseSettled) return;
    leaseSettled = true;
    rejectLease(error);
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          reader.releaseLock();
          completeLease();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        failLease(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
        reader.releaseLock();
        completeLease();
      } catch (error) {
        failLease(error);
        throw error;
      }
    },
  });

  return {
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    completion,
  };
}

/**
 * Wraps a callback to preserve the current AsyncLocalStorage context.
 *
 * esbuild communicates with its Go binary via a child process. When esbuild's
 * plugin callbacks (onResolve, onLoad) fire, they run in the child process's
 * message handler context, which does NOT inherit the AsyncLocalStorage store
 * from the original caller. This utility captures the current store and
 * re-enters it inside the callback, so that the correct project adapter can be resolved.
 */
export function wrapWithCurrentContext<T extends (...args: never[]) => unknown>(fn: T): T {
  const store = getStore();
  if (!store) return fn;

  return ((...args: Parameters<T>) => {
    return runInContext(store, () => fn(...args));
  }) as unknown as T;
}

export function getRequestScopedFile(cacheKey: string): string | undefined {
  const fileCache = getStore()?.fileCache;
  return fileCache ? mapGet(fileCache, cacheKey) : undefined;
}

export function setRequestScopedFile(cacheKey: string, content: string): void {
  const fileCache = getStore()?.fileCache;
  if (fileCache) mapSet(fileCache, cacheKey, content);
}

export function clearRequestScopedFileCache(): number {
  const fileCache = getStore()?.fileCache;
  const cleared = fileCache ? mapSize(fileCache) : 0;
  if (fileCache) mapClear(fileCache);
  return cleared;
}

/**
 * Builds one request context so every entry point installs identical,
 * independently frozen API capabilities.
 */
export function createRequestContext(options: RequestContextOptions): RequestContext {
  const productionMode = options.productionMode ?? false;
  return {
    projectSlug: options.projectSlug,
    projectId: options.projectId,
    token: options.token,
    productionMode,
    releaseId: options.releaseId ?? null,
    branch: productionMode ? null : (options.branch ?? null),
    environmentName: options.environmentName ?? null,
    fileCache: new IntrinsicMap<string, string>(),
    requestApiCredential: freezeObject({
      token: options.token,
      projectSlug: options.projectSlug,
      projectId: options.projectId,
    }),
    ...(options.tokenProvenance === "project-bound"
      ? {
        cacheApiCredential: freezeObject({
          token: options.token,
          projectSlug: options.projectSlug,
          projectId: options.projectId,
        }),
      }
      : {}),
  };
}

/**
 * Run a function within a request context.
 * Standalone version that doesn't require an adapter instance.
 * Used by workflow workers and other components that need to establish context.
 */
export function runWithRequestContext<T>(
  options: RequestContextOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const context = createRequestContext(options);
  return runInContext(context, async () => {
    let outcome:
      | { readonly succeeded: true; readonly value: T }
      | { readonly succeeded: false; readonly error: unknown };
    try {
      outcome = { succeeded: true, value: await fn() };
    } catch (error) {
      outcome = { succeeded: false, error };
    }

    const cleanupErrors = finalizeRequestContext(context);
    if (!outcome.succeeded) {
      // Cleanup must not replace the request failure that triggered it.
      throw outcome.error;
    }
    throwCleanupErrors(cleanupErrors);
    return outcome.value;
  });
}

/**
 * Runs a streaming response within one request context.
 *
 * A response body is lazy: returning the `Response` does not mean its producer
 * has finished using request-scoped registries, credentials, or adapters. This
 * helper returns the response as soon as it is ready, but finalizes the context
 * only after the body closes, errors, or is cancelled by its consumer.
 */
export function runWithRequestContextResponse(
  options: RequestContextOptions,
  fn: () => Promise<Response>,
): Promise<Response> {
  let responseReadySettled = false;
  let resolveResponse = (_response: Response) => {};
  let rejectResponse = (_error: unknown) => {};
  const responseReady = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const lifecycle = runWithRequestContext(options, async () => {
    const response = await fn();
    const lease = leaseStreamingResponse(response);
    responseReadySettled = true;
    resolveResponse(lease?.response ?? response);
    await lease?.completion;
  });

  void lifecycle.catch((error) => {
    if (responseReadySettled) return;
    responseReadySettled = true;
    rejectResponse(error);
  });

  return responseReady;
}

/**
 * Register the platform-owned request provider in module-private cache state.
 * A writable global bridge would let evaluated project code redirect ambient
 * cache and registry scope before the first lazy lookup.
 */
registerMultiProjectRequestContextProvider(getRequestContextSnapshotForScoping);
