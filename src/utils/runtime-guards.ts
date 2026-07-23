/** Public API contract for global with Deno. */
export interface GlobalWithDeno {
  Deno?: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

/** Public API contract for global with process. */
export interface GlobalWithProcess {
  process?: {
    env: Record<string, string | undefined>;
    version?: string;
    versions?: Record<string, string>;
  };
}

/** Public API contract for global with Bun. */
export interface GlobalWithBun {
  Bun?: {
    version: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

function getOwnDescriptor(value: unknown, key: PropertyKey): PropertyDescriptor | undefined {
  if (!isObject(value)) return undefined;
  try {
    return Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    // Revoked proxies and invalid proxy descriptors fail closed.
  }
  return undefined;
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  const descriptor = getOwnDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

// Node exposes globalThis.process through a native accessor. Only the runtime
// root property on exact globalThis uses this reader; nested values remain
// data-only so a replaced runtime object cannot widen the trust boundary.
function readTrustedRuntimeProperty(value: unknown, key: PropertyKey): unknown {
  const descriptor = getOwnDescriptor(value, key);
  if (!descriptor) return undefined;
  if ("value" in descriptor) return descriptor.value;
  if (typeof descriptor.get !== "function") return undefined;
  try {
    return Reflect.apply(descriptor.get, value, []);
  } catch {
    return undefined;
  }
}

function readRuntimeRootProperty(global: unknown, key: PropertyKey): unknown {
  return global === globalThis
    ? readTrustedRuntimeProperty(global, key)
    : readOwnDataProperty(global, key);
}

/** Check whether Deno runtime is present. */
export function hasDenoRuntime(global: unknown): global is GlobalWithDeno {
  const deno = readRuntimeRootProperty(global, "Deno");
  const env = readOwnDataProperty(deno, "env");
  return typeof readOwnDataProperty(env, "get") === "function";
}

/** Check whether node process is present. */
export function hasNodeProcess(global: unknown): global is GlobalWithProcess {
  const process = readRuntimeRootProperty(global, "process");
  return isObject(readOwnDataProperty(process, "env"));
}

/** Check whether Bun runtime is present. */
export function hasBunRuntime(global: unknown): global is GlobalWithBun {
  const bun = readRuntimeRootProperty(global, "Bun");
  return typeof readOwnDataProperty(bun, "version") === "string";
}
