import { AsyncLocalStorage } from "node:async_hooks";

import { registerRequestContextAccessor } from "#veryfront/platform/request-context-access.ts";

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
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageDisable = AsyncLocalStoragePrototype.disable;
const AsyncLocalStorageEnterWith = AsyncLocalStoragePrototype.enterWith;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;
const AsyncLocalStorageExit = AsyncLocalStoragePrototype.exit;
IntrinsicObjectDefineProperty(asyncLocalStorage, "disable", {
  configurable: false,
  value: AsyncLocalStorageDisable,
  writable: false,
});
IntrinsicObjectDefineProperty(asyncLocalStorage, "enterWith", {
  configurable: false,
  value: AsyncLocalStorageEnterWith,
  writable: false,
});
IntrinsicObjectDefineProperty(asyncLocalStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(asyncLocalStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});
IntrinsicObjectDefineProperty(asyncLocalStorage, "exit", {
  configurable: false,
  value: AsyncLocalStorageExit,
  writable: false,
});

function getRequestContextStore(): RequestContext | undefined {
  return IntrinsicReflectApply(AsyncLocalStorageGetStore, asyncLocalStorage, []) as
    | RequestContext
    | undefined;
}

function runWithRequestContextStore<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStorageRun, asyncLocalStorage, [context, fn]) as T;
}

export function getCurrentRequestContext(): RequestContext | null {
  return getRequestContextStore() ?? null;
}

// Shared client/server code reads the context through the client-safe holder;
// loading this module is what makes the real accessor available there.
registerRequestContextAccessor(getCurrentRequestContext);

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
  const store = getRequestContextStore();
  if (!store) return fn;

  return ((...args: Parameters<T>) => {
    return runWithRequestContextStore(store, () => fn(...args));
  }) as T;
}

export function getRequestScopedFile(cacheKey: string): string | undefined {
  return getRequestContextStore()?.fileCache?.get(cacheKey);
}

export function setRequestScopedFile(cacheKey: string, content: string): void {
  getRequestContextStore()?.fileCache?.set(cacheKey, content);
}

export function clearRequestScopedFileCache(): number {
  const fileCache = getRequestContextStore()?.fileCache;
  const cleared = fileCache?.size ?? 0;
  fileCache?.clear();
  return cleared;
}

/**
 * Run a function within a request context.
 * Standalone version that doesn't require an adapter instance.
 * Used by workflow workers and other components that need to establish context.
 */
export function runWithRequestContext<T>(
  options: {
    projectSlug: string;
    token: string;
    projectId?: string;
    productionMode?: boolean;
    releaseId?: string | null;
    branch?: string | null;
    environmentName?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const productionMode = options.productionMode ?? false;
  const context: RequestContext = {
    projectSlug: options.projectSlug,
    projectId: options.projectId,
    token: options.token,
    productionMode,
    releaseId: options.releaseId ?? null,
    branch: productionMode ? null : (options.branch ?? null),
    environmentName: options.environmentName ?? null,
    fileCache: new Map<string, string>(),
  };
  return runWithRequestContextStore(context, fn);
}

/** Run an operation without inheriting a credential-bearing filesystem context. */
export function runWithoutRequestContext<T>(fn: () => T): T {
  return IntrinsicReflectApply(AsyncLocalStorageExit, asyncLocalStorage, [fn]) as T;
}

/**
 * Typed global interface for the multi-project adapter module.
 * Registered on globalThis to avoid circular dependencies between
 * cache-key-builder / cache backends and the FS adapter layer.
 */
interface VfMultiProjectAdapterGlobal {
  getCurrentRequestContext: () => RequestContext | null;
  getRequestScopedFile: (cacheKey: string) => string | undefined;
  setRequestScopedFile: (cacheKey: string, content: string) => void;
  clearRequestScopedFileCache: () => number;
}

declare global {
  var __vf_multi_project_adapter: VfMultiProjectAdapterGlobal | undefined;
}

// Register globally for lazy access from cache-key-builder to avoid circular dependency.
globalThis.__vf_multi_project_adapter = {
  getCurrentRequestContext: () => {
    const context = getCurrentRequestContext();
    return context === null ? null : { ...context, token: "" };
  },
  getRequestScopedFile,
  setRequestScopedFile,
  clearRequestScopedFileCache,
};
