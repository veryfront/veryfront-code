import { isBun, isDeno, isNode } from "./runtime.ts";

export interface NativeBrandChecks {
  isAsyncFunction(value: unknown): boolean;
  isNativeError(value: unknown): boolean;
  isPromise(value: unknown): boolean;
  isProxy(value: unknown): boolean;
  isUint8Array(value: unknown): boolean;
}

interface HostProcess {
  getBuiltinModule?: (specifier: string) => unknown;
}

type HostRequire = (specifier: string) => unknown;

// Bun exposes this lexical binding in ESM without installing it on globalThis.
declare const require: HostRequire | undefined;

const apply = Reflect.apply;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectToString = Object.prototype.toString;
const toStringTagSymbol = Symbol.toStringTag;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

function readOwnDataFunction(
  source: object,
  key: PropertyKey,
): ((...args: unknown[]) => unknown) | undefined {
  const descriptor = getOwnPropertyDescriptor(source, key);
  if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
  return typeof descriptor.value === "function" ? descriptor.value : undefined;
}

const MAX_BRAND_PROTOTYPE_CHAIN_DEPTH = 100;

function canReadBuiltinTagWithoutHooks(
  value: unknown,
  isProxy: (...args: unknown[]) => unknown,
): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }

  let current: object | null = value;
  for (
    let depth = 0;
    current !== null && depth < MAX_BRAND_PROTOTYPE_CHAIN_DEPTH;
    depth++
  ) {
    try {
      if (apply(isProxy, undefined, [current]) === true) return false;
      if (getOwnPropertyDescriptor(current, toStringTagSymbol) !== undefined) return false;
      current = getPrototypeOf(current);
    } catch (_) {
      return false;
    }
  }

  return current === null;
}

function createErrorBrandCheck(
  hostCheck: (...args: unknown[]) => unknown,
  isProxy: (...args: unknown[]) => unknown,
) {
  return (value: unknown): boolean => {
    try {
      if (apply(hostCheck, undefined, [value]) === true) return true;
    } catch (_) {
      // Fall through to the independent built-in tag check.
    }

    // Object.prototype.toString only exposes the internal Error tag safely
    // after every Proxy and Symbol.toStringTag override has been rejected.
    if (!canReadBuiltinTagWithoutHooks(value, isProxy)) return false;
    try {
      return apply(objectToString, value, []) === "[object Error]";
    } catch (_) {
      return false;
    }
  };
}

export function snapshotNativeBrandChecks(value: unknown): NativeBrandChecks | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const keys = [
    "isAsyncFunction",
    "isNativeError",
    "isPromise",
    "isProxy",
    "isUint8Array",
  ] as const;
  const checks = createObject(null) as Record<
    (typeof keys)[number],
    (...args: unknown[]) => unknown
  >;
  for (const key of keys) {
    const check = readOwnDataFunction(value, key);
    if (!check) return undefined;
    checks[key] = check;
  }

  const snapshot = createObject(null) as NativeBrandChecks;
  for (const key of keys) {
    defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: key === "isNativeError"
        ? createErrorBrandCheck(checks.isNativeError, checks.isProxy)
        : checks[key],
      writable: false,
    });
  }
  return freeze(snapshot);
}

function loadNativeBrandCheckModule(): unknown {
  if (!isBun && !isDeno && !isNode) return undefined;

  const hostProcess = (globalThis as typeof globalThis & { process?: HostProcess }).process;
  if (hostProcess) {
    const getBuiltinModule = readOwnDataFunction(hostProcess as object, "getBuiltinModule");
    if (getBuiltinModule) {
      return apply(getBuiltinModule, hostProcess, ["node:util/types"]);
    }
  }

  // Bun exposes synchronous require() in ESM. This retains compatibility with
  // Bun releases that predate process.getBuiltinModule without adding a Node
  // builtin to browser module graphs.
  if (isBun && typeof require === "function") {
    return apply(require, undefined, ["node:util/types"]);
  }

  return undefined;
}

/**
 * Immutable host brand checks captured once at the runtime trust boundary.
 * Browser and edge hosts without Node-compatible primitives remain linkable
 * and use the conservative callers in error-introspection.ts.
 */
export const nativeBrandChecks = snapshotNativeBrandChecks(
  loadNativeBrandCheckModule(),
);

if ((isBun || isDeno || isNode) && !nativeBrandChecks) {
  throw new Error(
    "The current server runtime does not expose complete node:util/types brand checks",
  );
}
