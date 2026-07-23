import { getEnvOverlayStorage } from "#veryfront/platform/compat/process.ts";
import { getDenoRuntime } from "#veryfront/platform/compat/runtime.ts";
import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";
import { runtimeProcess } from "#veryfront/platform/compat/process/runtime-process.ts";

export type EnvOverlayValue = string | null;

type EnvOverlayStorage = {
  getStore: () => unknown;
  run?: <T>(store: unknown, fn: () => T) => T;
  enterWith?: (store: unknown) => void;
};

type EnvOverlayStorageContainer = {
  storage: EnvOverlayStorage;
};

const ENV_OVERLAY_STORAGE_KEY = "__vfTestEnvOverlay";
const ENV_OVERLAY_FACADE_KEY = Symbol.for("veryfront.testing.envOverlayFacadeInstalled");

type DenoEnvFacade = {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  toObject: () => Record<string, string>;
};

type DenoEnvMethod = (...args: unknown[]) => unknown;

type PropertyPatch = {
  key: PropertyKey;
  original: PropertyDescriptor | undefined;
  target: object;
};

function readOwnDescriptor(
  target: object,
  key: PropertyKey,
  label: string,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(target, key);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
}

function assertPropertyReplaceable(
  target: object,
  descriptor: PropertyDescriptor | undefined,
  label: string,
): void {
  if (!descriptor) {
    if (!Object.isExtensible(target)) throw new TypeError(`${label} is not replaceable`);
    return;
  }
  if (descriptor.configurable) return;
  if ("value" in descriptor && descriptor.writable) return;
  throw new TypeError(`${label} is not replaceable`);
}

function defineReplacementValue(
  target: object,
  key: PropertyKey,
  value: unknown,
  original: PropertyDescriptor | undefined,
): void {
  if (original && "value" in original) {
    Object.defineProperty(target, key, { ...original, value });
    return;
  }
  Object.defineProperty(target, key, {
    configurable: original?.configurable ?? true,
    enumerable: original?.enumerable ?? false,
    value,
    writable: true,
  });
}

function restoreProperty(patch: PropertyPatch): void {
  if (patch.original) {
    Object.defineProperty(patch.target, patch.key, patch.original);
  } else if (!Reflect.deleteProperty(patch.target, patch.key)) {
    throw new TypeError("Environment facade property could not be restored");
  }
}

function facadeMarkerDescriptor(): PropertyDescriptor | undefined {
  return readOwnDescriptor(
    globalThis,
    ENV_OVERLAY_FACADE_KEY,
    "Environment facade marker",
  );
}

export function assertEnvKey(key: string): void {
  if (
    typeof key !== "string" || key.length === 0 || key.includes("=") || key.includes("\0")
  ) {
    throw new TypeError("Environment variable key contains invalid characters");
  }
}

export function assertEnvValue(value: string): void {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Environment variable value contains invalid characters");
  }
}

export class EnvOverlayStore extends Map<string, EnvOverlayValue> {
  override get(key: string): EnvOverlayValue | undefined {
    assertEnvKey(key);
    return super.get(key);
  }

  override has(key: string): boolean {
    assertEnvKey(key);
    return super.has(key);
  }

  override set(key: string, value: EnvOverlayValue): this {
    assertEnvKey(key);
    if (value !== null) assertEnvValue(value);
    return super.set(key, value);
  }
}

function getActiveEnvOverlay(): EnvOverlayStore | null {
  const store = getEnvOverlayStorage()?.getStore();
  return store instanceof Map ? store as EnvOverlayStore : null;
}

function applyEnvOverlay(
  base: Record<string, string>,
  overlay: EnvOverlayStore | null,
): Record<string, string> {
  if (!overlay) return { ...base };

  const merged = { ...base };
  for (const [key, value] of overlay.entries()) {
    if (value === null) delete merged[key];
    else {
      Object.defineProperty(merged, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    }
  }
  return merged;
}

function installEnvOverlayFacade(): void {
  const markerDescriptor = facadeMarkerDescriptor();
  if (markerDescriptor && "value" in markerDescriptor && markerDescriptor.value === true) return;
  assertPropertyReplaceable(globalThis, markerDescriptor, "Environment facade marker");

  const denoEnv = getDenoRuntime()?.env;
  const denoDescriptors = denoEnv
    ? new Map(
      (["get", "set", "delete", "has", "toObject"] as const).map((key) => [
        key,
        readOwnDescriptor(denoEnv, key, `Deno environment method ${key}`),
      ]),
    )
    : undefined;
  if (denoEnv && denoDescriptors) {
    for (const [key, descriptor] of denoDescriptors) {
      assertPropertyReplaceable(denoEnv, descriptor, `Deno environment method ${key}`);
    }
  }

  const readDenoMethod = (key: "get" | "set" | "delete" | "toObject"): DenoEnvMethod => {
    const descriptor = denoDescriptors?.get(key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Deno environment method ${key} must be a function`);
    }
    return descriptor.value as DenoEnvMethod;
  };
  const originalDenoEnv = denoEnv
    ? {
      get: (key: string) =>
        Reflect.apply(readDenoMethod("get"), denoEnv, [key]) as string | undefined,
      set: (key: string, value: string) => {
        Reflect.apply(readDenoMethod("set"), denoEnv, [key, value]);
      },
      delete: (key: string) => {
        Reflect.apply(readDenoMethod("delete"), denoEnv, [key]);
      },
      toObject: () =>
        Reflect.apply(readDenoMethod("toObject"), denoEnv, []) as Record<string, string>,
    } satisfies DenoEnvFacade
    : undefined;
  const processEnvDescriptor = runtimeProcess
    ? readOwnDescriptor(runtimeProcess, "env", "Runtime process environment")
    : undefined;
  if (
    runtimeProcess &&
    (!processEnvDescriptor || !("value" in processEnvDescriptor) ||
      !processEnvDescriptor.value || typeof processEnvDescriptor.value !== "object" ||
      Array.isArray(processEnvDescriptor.value))
  ) {
    throw new TypeError("Runtime process environment must be an own data object");
  }
  const baseProcessEnv = processEnvDescriptor && "value" in processEnvDescriptor
    ? processEnvDescriptor.value as Record<string, string | undefined>
    : undefined;
  if (runtimeProcess) {
    assertPropertyReplaceable(
      runtimeProcess,
      processEnvDescriptor,
      "Runtime process environment",
    );
  }

  const hostGet = (key: string): string | undefined => {
    assertEnvKey(key);
    if (originalDenoEnv) return originalDenoEnv.get(key);
    return baseProcessEnv && Object.prototype.hasOwnProperty.call(baseProcessEnv, key)
      ? baseProcessEnv[key]
      : undefined;
  };
  const hostSet = (key: string, value: string): void => {
    assertEnvKey(key);
    assertEnvValue(value);
    if (originalDenoEnv) originalDenoEnv.set(key, value);
    else if (baseProcessEnv) {
      Object.defineProperty(baseProcessEnv, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    }
  };
  const hostDelete = (key: string): void => {
    assertEnvKey(key);
    if (originalDenoEnv) originalDenoEnv.delete(key);
    else if (baseProcessEnv) delete baseProcessEnv[key];
  };
  const hostToObject = (): Record<string, string> => {
    if (originalDenoEnv) return originalDenoEnv.toObject();
    return baseProcessEnv ? { ...baseProcessEnv } as Record<string, string> : {};
  };

  const overlayGet = (key: string): string | undefined => {
    const overlay = getActiveEnvOverlay();
    if (overlay?.has(key)) return overlay.get(key) ?? undefined;
    return hostGet(key);
  };
  const overlaySet = (key: string, value: string): void => {
    const overlay = getActiveEnvOverlay();
    if (overlay) overlay.set(key, value);
    else hostSet(key, value);
  };
  const overlayDelete = (key: string): void => {
    const overlay = getActiveEnvOverlay();
    if (overlay) overlay.set(key, null);
    else hostDelete(key);
  };
  const overlayHas = (key: string): boolean => {
    const overlay = getActiveEnvOverlay();
    if (overlay?.has(key)) return overlay.get(key) !== null;
    return hostGet(key) !== undefined;
  };
  const overlayToObject = (): Record<string, string> =>
    applyEnvOverlay(hostToObject(), getActiveEnvOverlay());

  const processEnvFacade = baseProcessEnv
    ? new Proxy(baseProcessEnv, {
      get(target, property, receiver) {
        if (typeof property !== "string") return Reflect.get(target, property, receiver);

        const overlay = getActiveEnvOverlay();
        if (overlay?.has(property)) {
          const value = overlay.get(property);
          if (value !== null) return value;
          const prototype = Reflect.getPrototypeOf(target);
          return prototype ? Reflect.get(prototype, property, receiver) : undefined;
        }

        const value = hostGet(property);
        if (value !== undefined) return value;
        if (Object.hasOwn(target, property)) return undefined;
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        if (typeof property !== "string") return Reflect.set(target, property, value, receiver);
        overlaySet(property, String(value));
        return true;
      },
      deleteProperty(target, property) {
        if (typeof property !== "string") return Reflect.deleteProperty(target, property);
        overlayDelete(property);
        return true;
      },
      has(target, property) {
        if (typeof property !== "string") return Reflect.has(target, property);
        const overlay = getActiveEnvOverlay();
        if (overlay?.has(property)) return overlay.get(property) !== null;
        if (hostGet(property) !== undefined) return true;
        if (Object.hasOwn(target, property)) return false;
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        const symbolKeys = Reflect.ownKeys(target).filter((key) => typeof key === "symbol");
        return [...Object.keys(overlayToObject()), ...symbolKeys];
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property !== "string") {
          return Reflect.getOwnPropertyDescriptor(target, property);
        }
        const value = overlayGet(property);
        return value === undefined
          ? undefined
          : { configurable: true, enumerable: true, writable: true, value };
      },
      defineProperty(target, property, descriptor) {
        if (typeof property !== "string") {
          return Reflect.defineProperty(target, property, descriptor);
        }
        if (!("value" in descriptor)) {
          throw new TypeError("Environment variables must use value properties");
        }
        overlaySet(property, String(descriptor.value));
        return true;
      },
    })
    : undefined;

  const applied: PropertyPatch[] = [];
  try {
    if (denoEnv && denoDescriptors) {
      const replacements = {
        get: overlayGet,
        set: overlaySet,
        delete: overlayDelete,
        has: overlayHas,
        toObject: overlayToObject,
      } as const;
      for (const [key, replacement] of Object.entries(replacements)) {
        const original = denoDescriptors.get(key as keyof typeof replacements);
        defineReplacementValue(denoEnv, key, replacement, original);
        applied.push({ key, original, target: denoEnv });
      }
    }

    if (runtimeProcess && processEnvFacade) {
      defineReplacementValue(runtimeProcess, "env", processEnvFacade, processEnvDescriptor);
      applied.push({ key: "env", original: processEnvDescriptor, target: runtimeProcess });
    }

    defineReplacementValue(
      globalThis,
      ENV_OVERLAY_FACADE_KEY,
      true,
      markerDescriptor,
    );
  } catch (error) {
    const restorationErrors: unknown[] = [];
    for (const property of applied.reverse()) {
      try {
        restoreProperty(property);
      } catch (restoreError) {
        restorationErrors.push(restoreError);
      }
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(
        [error, ...restorationErrors],
        "Environment facade installation and rollback both failed",
      );
    }
    throw error;
  }
}

/** Install and return the process-wide async environment overlay storage. */
export function ensureEnvOverlayStorage(): EnvOverlayStorage {
  const existing = getEnvOverlayStorage();
  if (existing) return existing;

  const original = readOwnDescriptor(
    globalThis,
    ENV_OVERLAY_STORAGE_KEY,
    "Environment overlay storage marker",
  );
  assertPropertyReplaceable(
    globalThis,
    original,
    "Environment overlay storage marker",
  );

  const storage = new AsyncLocalStorage<EnvOverlayStore>();
  const container: EnvOverlayStorageContainer = {
    storage: {
      getStore: () => storage.getStore(),
      run: <T>(store: unknown, fn: () => T) => storage.run(store as EnvOverlayStore, fn),
      enterWith: (store: unknown) => storage.enterWith(store as EnvOverlayStore),
    },
  };
  defineReplacementValue(
    globalThis,
    ENV_OVERLAY_STORAGE_KEY,
    container,
    original,
  );
  return container.storage;
}

/** Install environment overlay storage and runtime environment facades. */
export function ensureEnvOverlayRuntime(): EnvOverlayStorage {
  const marker = facadeMarkerDescriptor();
  if (!(marker && "value" in marker && marker.value === true)) {
    assertPropertyReplaceable(globalThis, marker, "Environment facade marker");
  }

  const priorStorage = getEnvOverlayStorage();
  const storageDescriptor = priorStorage ? undefined : readOwnDescriptor(
    globalThis,
    ENV_OVERLAY_STORAGE_KEY,
    "Environment overlay storage marker",
  );
  const storage = priorStorage ?? ensureEnvOverlayStorage();
  try {
    installEnvOverlayFacade();
    return storage;
  } catch (error) {
    if (priorStorage) throw error;
    try {
      restoreProperty({
        key: ENV_OVERLAY_STORAGE_KEY,
        original: storageDescriptor,
        target: globalThis,
      });
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Environment facade installation and storage rollback both failed",
      );
    }
    throw error;
  }
}

/** Create an isolated overlay seeded with values visible in the current scope. */
export function createChildEnvOverlay(): EnvOverlayStore {
  const current = ensureEnvOverlayStorage().getStore();
  return current instanceof Map
    ? new EnvOverlayStore(current as Map<string, EnvOverlayValue>)
    : new EnvOverlayStore();
}
