/**
 * Test isolation utilities for cross-runtime execution.
 *
 * Provides default cleanup hooks and timer tracking to reduce
 * cross-test leakage, especially in Bun where module caching
 * and shared globals can cause flakiness.
 *
 * @module
 */

import { isBun, isDeno, isNode } from "../platform/compat/runtime.ts";
import { deleteEnv, env as readEnv, setEnv } from "../platform/compat/process.ts";

type CleanupTask = () => void | Promise<void>;

type HookRegistration = {
  beforeEach?: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
};

const installedKey = "__vfTestIsolationInstalled";
const envOverlayKey = "__vfTestEnvOverlay";
const denoEnvOverlayKey = "__vfTestDenoEnvOverlay";
const cleanupTasks = new Set<CleanupTask>();
const envMaskKey = "__vfTestEnvMask";

// Use AsyncLocalStorage for per-test isolation in concurrent environments
type TestIsolationContext = {
  envSnapshot: Record<string, string> | null;
  globalSnapshot: Map<string, { had: boolean; value: unknown }> | null;
};

let isolationStorage: import("node:async_hooks").AsyncLocalStorage<TestIsolationContext> | null =
  null;

// Fallback for environments without AsyncLocalStorage (single-threaded)
const fallbackContext: TestIsolationContext = {
  envSnapshot: null,
  globalSnapshot: null,
};

function getIsolationContext(): TestIsolationContext {
  if (isolationStorage) {
    return isolationStorage.getStore() ?? { envSnapshot: null, globalSnapshot: null };
  }
  return fallbackContext;
}

const envDeleted = Symbol("vfEnvDeleted");

type EnvOverlayStore = Map<string, string | typeof envDeleted>;
type AsyncLocalStorage<T> = import("node:async_hooks").AsyncLocalStorage<T>;
type EnvOverlay = {
  storage: AsyncLocalStorage<EnvOverlayStore>;
  baseEnv?: Record<string, string>;
};

const globalKeys = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "fetch",
  "Headers",
  "Request",
  "Response",
  "WebSocket",
  "Event",
  "EventTarget",
  "CustomEvent",
  "IntersectionObserver",
  "MutationObserver",
  "DOMParser",
  "ReactDOM",
  "requestIdleCallback",
  "cancelIdleCallback",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "scrollTo",
] as const;

const SSR_STUB_MARKER = "__veryfrontSSRStub";
const SSR_GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "matchMedia",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "self",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Text",
  "Comment",
  "DocumentFragment",
] as const;

function hasSSRStubGlobals(): boolean {
  const win = (globalThis as Record<string, unknown>).window as Record<string, unknown> | undefined;
  if (win && typeof win === "object" && win[SSR_STUB_MARKER] === true) {
    return true;
  }
  const doc = (globalThis as Record<string, unknown>).document as
    | Record<string, unknown>
    | undefined;
  if (doc && typeof doc === "object" && doc[SSR_STUB_MARKER] === true) {
    return true;
  }
  return false;
}

function clearSSRGlobalStubs(): void {
  if (!hasSSRStubGlobals()) return;
  for (const key of SSR_GLOBAL_KEYS) {
    try {
      delete (globalThis as Record<string, unknown>)[key];
    } catch {
      // Best-effort cleanup for globals that might be non-configurable.
    }
  }
}

type EnvMask = {
  prefixes?: string[];
  keys?: string[];
};

function getEnvMask(): EnvMask | null {
  const mask = (globalThis as Record<string, unknown>)[envMaskKey];
  if (!mask || typeof mask !== "object") return null;
  const raw = mask as EnvMask;
  const prefixes = Array.isArray(raw.prefixes)
    ? raw.prefixes.filter((p) => typeof p === "string")
    : undefined;
  const keys = Array.isArray(raw.keys) ? raw.keys.filter((k) => typeof k === "string") : undefined;
  if ((!prefixes || prefixes.length === 0) && (!keys || keys.length === 0)) return null;
  return { prefixes, keys };
}

function isMaskedEnvKey(key: string, mask: EnvMask | null): boolean {
  if (!mask) return false;
  if (mask.keys?.includes(key)) return true;
  if (mask.prefixes) {
    for (const prefix of mask.prefixes) {
      if (key.startsWith(prefix)) return true;
    }
  }
  return false;
}

function getEnvOverlayStore(storage: AsyncLocalStorage<EnvOverlayStore>): EnvOverlayStore | null {
  return storage.getStore() ?? null;
}

function createEnvProxy(
  baseEnv: Record<string, string>,
  storage: AsyncLocalStorage<EnvOverlayStore>,
): Record<string, string> {
  const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
  const toAccessorDescriptor = (desc: PropertyDescriptor): PropertyDescriptor => {
    const next = Object.create(null) as PropertyDescriptor;
    next.configurable = desc.configurable ?? true;
    next.enumerable = desc.enumerable ?? true;
    if ("get" in desc) next.get = desc.get;
    if ("set" in desc) next.set = desc.set;
    return next;
  };
  const toDataDescriptor = (desc: PropertyDescriptor, value: unknown): PropertyDescriptor => {
    const next = Object.create(null) as PropertyDescriptor;
    next.configurable = desc.configurable ?? true;
    next.enumerable = desc.enumerable ?? true;
    next.writable = desc.writable ?? true;
    next.value = value;
    return next;
  };
  const normalizeDescriptor = (
    desc: PropertyDescriptor | undefined,
    valueOverride?: unknown,
  ): PropertyDescriptor | undefined => {
    if (!desc) return undefined;
    const hasData = hasOwn(desc, "value") || hasOwn(desc, "writable");
    if (hasData) {
      return toDataDescriptor(desc, valueOverride ?? desc.value);
    }
    if (hasOwn(desc, "get") || hasOwn(desc, "set")) {
      return toAccessorDescriptor(desc);
    }
    return toDataDescriptor(desc, valueOverride ?? desc.value);
  };

  const envMask = getEnvMask();
  const handler: ProxyHandler<Record<string, string>> = {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      const store = getEnvOverlayStore(storage);
      if (store?.has(prop)) {
        const value = store.get(prop);
        return value === envDeleted ? undefined : value;
      }
      if (isMaskedEnvKey(prop, envMask)) return undefined;
      return target[prop];
    },
    set(target, prop, value) {
      if (typeof prop !== "string") {
        return Reflect.set(target, prop, value);
      }
      const store = getEnvOverlayStore(storage);
      const nextValue = String(value);
      if (store) {
        store.set(prop, nextValue);
        return true;
      }
      target[prop] = nextValue;
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop !== "string") {
        return Reflect.deleteProperty(target, prop);
      }
      const store = getEnvOverlayStore(storage);
      if (store) {
        store.set(prop, envDeleted);
        return true;
      }
      delete target[prop];
      return true;
    },
    has(target, prop) {
      if (typeof prop !== "string") {
        return Reflect.has(target, prop);
      }
      const store = getEnvOverlayStore(storage);
      if (store?.has(prop)) {
        return store.get(prop) !== envDeleted;
      }
      if (isMaskedEnvKey(prop, envMask)) return false;
      return prop in target;
    },
    ownKeys(target) {
      const keys = new Set<string>();
      const symbolKeys: symbol[] = [];
      for (const key of Reflect.ownKeys(target)) {
        if (typeof key === "string") {
          if (!isMaskedEnvKey(key, envMask)) {
            keys.add(key);
          }
        } else {
          symbolKeys.push(key);
        }
      }
      const store = getEnvOverlayStore(storage);
      if (store) {
        for (const [key, value] of store.entries()) {
          if (value === envDeleted) {
            keys.delete(key);
          } else {
            keys.add(key);
          }
        }
      }
      return [...keys, ...symbolKeys];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== "string") {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      const store = getEnvOverlayStore(storage);
      if (store?.has(prop)) {
        const value = store.get(prop);
        if (value === envDeleted) return undefined;
        const baseDesc = Reflect.getOwnPropertyDescriptor(target, prop);
        if (baseDesc && (hasOwn(baseDesc, "get") || hasOwn(baseDesc, "set"))) {
          if (baseDesc.configurable === false) {
            return normalizeDescriptor(baseDesc);
          }
        }
        return normalizeDescriptor(baseDesc ?? {}, value);
      }
      if (isMaskedEnvKey(prop, envMask)) {
        const baseDesc = Reflect.getOwnPropertyDescriptor(target, prop);
        if (baseDesc?.configurable === false) {
          return normalizeDescriptor(baseDesc);
        }
        return undefined;
      }
      return normalizeDescriptor(Reflect.getOwnPropertyDescriptor(target, prop));
    },
    defineProperty(target, prop, descriptor) {
      if (typeof prop !== "string") {
        return Reflect.defineProperty(target, prop, descriptor);
      }
      const store = getEnvOverlayStore(storage);
      if (store) {
        if (descriptor && ("get" in descriptor || "set" in descriptor)) {
          const normalized = normalizeDescriptor(descriptor);
          return Reflect.defineProperty(target, prop, normalized ?? descriptor);
        }
        if (descriptor && "value" in descriptor) {
          store.set(prop, String(descriptor.value));
          return true;
        }
        const normalized = normalizeDescriptor(descriptor);
        return Reflect.defineProperty(target, prop, normalized ?? descriptor);
      }
      return Reflect.defineProperty(target, prop, descriptor);
    },
  };

  return new Proxy(baseEnv, handler);
}

async function ensureDenoEnvOverlay(): Promise<EnvOverlay | null> {
  if (!isDeno) return null;

  const globalAny = globalThis as Record<string, unknown>;
  const existing = globalAny[denoEnvOverlayKey] as EnvOverlay | undefined;
  if (existing) return existing;

  if (typeof Deno === "undefined" || typeof Deno.env === "undefined") return null;

  try {
    const asyncHooks = await import("node:async_hooks");
    const storage = new asyncHooks.AsyncLocalStorage<EnvOverlayStore>();

    const originalGet = Deno.env.get.bind(Deno.env);
    const originalSet = Deno.env.set.bind(Deno.env);
    const originalDelete = Deno.env.delete.bind(Deno.env);
    const originalToObject = Deno.env.toObject.bind(Deno.env);

    const getStore = () => storage.getStore();
    const envMask = getEnvMask();

    Deno.env.get = ((key: string): string | undefined => {
      const store = getStore();
      if (store?.has(key)) {
        const value = store.get(key);
        return value === envDeleted ? undefined : value;
      }
      if (isMaskedEnvKey(key, envMask)) return undefined;
      return originalGet(key);
    }) as typeof Deno.env.get;

    Deno.env.set = ((key: string, value: string): void => {
      const store = getStore();
      if (store) {
        store.set(key, value);
        return;
      }
      originalSet(key, value);
    }) as typeof Deno.env.set;

    Deno.env.delete = ((key: string): void => {
      const store = getStore();
      if (store) {
        store.set(key, envDeleted);
        return;
      }
      originalDelete(key);
    }) as typeof Deno.env.delete;

    Deno.env.toObject = (() => {
      const base = originalToObject();
      const store = getStore();
      const merged: Record<string, string> = { ...base };
      if (envMask) {
        for (const key of Object.keys(merged)) {
          if (isMaskedEnvKey(key, envMask)) {
            delete merged[key];
          }
        }
      }
      if (!store) return merged;
      for (const [key, value] of store.entries()) {
        if (value === envDeleted) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      return merged;
    }) as typeof Deno.env.toObject;

    const overlay: EnvOverlay = { storage };
    globalAny[denoEnvOverlayKey] = overlay;
    return overlay;
  } catch {
    return null;
  }
}

async function ensureEnvOverlay(): Promise<EnvOverlay | null> {
  if (isDeno) {
    const denoOverlay = await ensureDenoEnvOverlay();
    if (denoOverlay) return denoOverlay;
  }
  if (!isBun && !isNode) return null;

  const globalAny = globalThis as Record<string, unknown>;
  const existing = globalAny[envOverlayKey] as EnvOverlay | undefined;
  if (existing) return existing;

  const processEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
  if (!processEnv) return null;

  try {
    const asyncHooks = await import("node:async_hooks");
    const storage = new asyncHooks.AsyncLocalStorage<EnvOverlayStore>();
    const proxy = createEnvProxy(processEnv, storage);
    (globalThis as { process?: { env: Record<string, string> } }).process!.env = proxy;
    const overlay: EnvOverlay = { storage, baseEnv: processEnv };
    globalAny[envOverlayKey] = overlay;
    return overlay;
  } catch {
    return null;
  }
}

function captureEnvSnapshot(): Record<string, string> {
  try {
    return { ...readEnv() };
  } catch {
    return {};
  }
}

function restoreEnvSnapshot(snapshot: Record<string, string> | null): void {
  if (!snapshot) return;
  let current: Record<string, string> = {};
  try {
    current = readEnv();
  } catch {
    current = {};
  }

  for (const key of Object.keys(current)) {
    if (!(key in snapshot)) {
      try {
        deleteEnv(key);
      } catch {
        // ignore env cleanup errors
      }
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    try {
      setEnv(key, value);
    } catch {
      // ignore env cleanup errors
    }
  }
}

function captureGlobalSnapshot(): Map<string, { had: boolean; value: unknown }> {
  const snapshot = new Map<string, { had: boolean; value: unknown }>();
  for (const key of globalKeys) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, key);
    const value = (globalThis as Record<string, unknown>)[key];
    snapshot.set(key, { had, value });
  }
  return snapshot;
}

function restoreGlobalSnapshot(
  snapshot: Map<string, { had: boolean; value: unknown }> | null,
): void {
  if (!snapshot) return;
  for (const [key, entry] of snapshot.entries()) {
    try {
      if (entry.had) {
        (globalThis as Record<string, unknown>)[key] = entry.value;
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    } catch {
      // ignore global restore errors
    }
  }
}

export function registerTestCleanup(task: CleanupTask): void {
  cleanupTasks.add(task);
}

async function runCleanupTasks(): Promise<void> {
  const tasks = Array.from(cleanupTasks);
  cleanupTasks.clear();
  for (const task of tasks) {
    try {
      await task();
    } catch {
      // Best-effort cleanup; ignore individual failures.
    }
  }
}

async function runDefaultCleanup(): Promise<void> {
  const cleanups: Array<() => Promise<void> | void> = [
    async () => {
      const { clearConfigCache } = await import("../config/loader.ts");
      clearConfigCache();
    },
    async () => {
      const { resetApiHandler } = await import("../server/handlers/request/api/index.ts");
      await resetApiHandler();
    },
    async () => {
      const { clearSSRModuleCache } = await import("../modules/react-loader/index.ts");
      clearSSRModuleCache();
    },
    async () => {
      const { clearSnippetCache } = await import("../rendering/snippet-renderer.ts");
      clearSnippetCache();
    },
    async () => {
      const { resetReactCache } = await import("../react/compat/ssr-adapter/server-loader.ts");
      resetReactCache();
    },
    async () => {
      const { resetCompatHooksContext } = await import("../react/compat/hooks-adapter.ts");
      resetCompatHooksContext();
    },
    async () => {
      const { ReloadNotifier } = await import("../server/reload-notifier.ts");
      ReloadNotifier.reset();
    },
  ];

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch {
      // Best-effort cleanup; ignore individual failures.
    }
  }

  if (isBun) {
    try {
      const { cleanupBundler } = await import("../rendering/cleanup.ts");
      await cleanupBundler();
    } catch {
      // Best-effort cleanup; ignore individual failures.
    }
  }
}

async function runSSRTestCleanup(): Promise<void> {
  try {
    const { resetSSRGlobalsState } = await import("../rendering/ssr-globals/context.ts");
    resetSSRGlobalsState();
  } catch {
    // Best-effort cleanup; ignore SSR reset failures.
  }

  try {
    const { disableSSRFetchInterception } = await import("../rendering/ssr-globals/index.ts");
    disableSSRFetchInterception();
  } catch {
    // Best-effort cleanup; ignore fetch interception reset failures.
  }

  clearSSRGlobalStubs();
}

function createTimerTracker() {
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const immediates = new Set<unknown>();
  const idleCallbacks = new Set<number>();

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetImmediate = (globalThis as Record<string, unknown>).setImmediate as
    | ((fn: (...args: unknown[]) => void, ...args: unknown[]) => unknown)
    | undefined;
  const originalClearImmediate = (globalThis as Record<string, unknown>).clearImmediate as
    | ((id: unknown) => void)
    | undefined;
  const originalRequestIdleCallback = (globalThis as typeof globalThis & {
    requestIdleCallback?: typeof requestIdleCallback;
  }).requestIdleCallback;
  const originalCancelIdleCallback = (globalThis as typeof globalThis & {
    cancelIdleCallback?: typeof cancelIdleCallback;
  }).cancelIdleCallback;

  return {
    install() {
      globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        const id = originalSetTimeout(fn, ms, ...args);
        timeouts.add(id);
        return id;
      }) as typeof setTimeout;

      globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
        if (id !== undefined) timeouts.delete(id);
        return originalClearTimeout(id as never);
      }) as typeof clearTimeout;

      globalThis.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        const id = originalSetInterval(fn, ms, ...args);
        intervals.add(id);
        return id;
      }) as typeof setInterval;

      globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
        if (id !== undefined) intervals.delete(id);
        return originalClearInterval(id as never);
      }) as typeof clearInterval;

      if (originalSetImmediate && originalClearImmediate) {
        (globalThis as Record<string, unknown>).setImmediate = (
          fn: (...args: unknown[]) => void,
          ...args: unknown[]
        ) => {
          const id = originalSetImmediate(fn, ...args);
          immediates.add(id);
          return id;
        };

        (globalThis as Record<string, unknown>).clearImmediate = (id?: unknown) => {
          if (id !== undefined) immediates.delete(id);
          return originalClearImmediate(id);
        };
      }

      if (originalRequestIdleCallback && originalCancelIdleCallback) {
        (globalThis as typeof globalThis & { requestIdleCallback: typeof requestIdleCallback })
          .requestIdleCallback = ((cb: IdleRequestCallback, options?: IdleRequestOptions) => {
            const id = originalRequestIdleCallback(cb, options);
            idleCallbacks.add(id);
            return id;
          }) as typeof requestIdleCallback;

        (globalThis as typeof globalThis & { cancelIdleCallback: typeof cancelIdleCallback })
          .cancelIdleCallback = ((id: number) => {
            idleCallbacks.delete(id);
            return originalCancelIdleCallback(id);
          }) as typeof cancelIdleCallback;
      }
    },
    clear() {
      for (const id of timeouts) {
        originalClearTimeout(id as never);
      }
      timeouts.clear();

      for (const id of intervals) {
        originalClearInterval(id as never);
      }
      intervals.clear();

      for (const id of immediates) {
        originalClearImmediate?.(id);
      }
      immediates.clear();

      for (const id of idleCallbacks) {
        originalCancelIdleCallback?.(id);
      }
      idleCallbacks.clear();
    },
  };
}

export async function installTestIsolation(hooks: HookRegistration): Promise<void> {
  const globalAny = globalThis as Record<string, unknown>;
  if (globalAny[installedKey]) return;
  globalAny[installedKey] = true;

  const timerTracker = createTimerTracker();
  timerTracker.install();

  const envOverlay = await ensureEnvOverlay();

  // Try to set up AsyncLocalStorage for per-test isolation
  try {
    const asyncHooks = await import("node:async_hooks");
    isolationStorage = new asyncHooks.AsyncLocalStorage<TestIsolationContext>();
  } catch {
    // AsyncLocalStorage not available, use fallback (single-threaded)
    isolationStorage = null;
  }

  hooks.beforeEach?.(async () => {
    await runSSRTestCleanup();
    // Create a fresh context for this test
    const context: TestIsolationContext = isolationStorage
      ? { envSnapshot: null, globalSnapshot: null }
      : fallbackContext;

    if (isolationStorage) isolationStorage.enterWith(context);

    if (envOverlay) {
      envOverlay.storage.enterWith(new Map());
    } else {
      context.envSnapshot = captureEnvSnapshot();
    }
    context.globalSnapshot = captureGlobalSnapshot();
  });

  hooks.afterEach(async () => {
    const context = getIsolationContext();

    await runCleanupTasks();
    await runDefaultCleanup();
    timerTracker.clear();

    if (envOverlay) {
      envOverlay.storage.enterWith(new Map());
    } else {
      restoreEnvSnapshot(context.envSnapshot);
    }
    restoreGlobalSnapshot(context.globalSnapshot);
    await runSSRTestCleanup();

    if (!isolationStorage) {
      fallbackContext.envSnapshot = null;
      fallbackContext.globalSnapshot = null;
    }
  });
}
