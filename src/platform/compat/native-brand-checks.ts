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
const objectHasOwnProperty = Object.prototype.hasOwnProperty;

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

function snapshotNativeBrandChecks(value: unknown): NativeBrandChecks | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const snapshot = createObject(null) as NativeBrandChecks;
  for (
    const key of [
      "isAsyncFunction",
      "isNativeError",
      "isPromise",
      "isProxy",
      "isUint8Array",
    ] as const
  ) {
    const check = readOwnDataFunction(value, key);
    if (!check) return undefined;
    defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: check,
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
