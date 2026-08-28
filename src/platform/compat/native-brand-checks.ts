import { isBun, isDeno, isNode } from "./runtime.ts";

export interface NativeBrandChecks {
  isAsyncFunction(value: unknown): boolean;
  isBoxedPrimitive(value: unknown): boolean;
  isNonPlainBuiltin(value: unknown): boolean;
  isNativeError(value: unknown): boolean;
  isPromise(value: unknown): boolean;
  isProxy(value: unknown): boolean;
  isUint8Array(value: unknown): boolean;
  isWeakMap(value: unknown): boolean;
  isWeakSet(value: unknown): boolean;
}

interface HostProcess {
  getBuiltinModule?: (specifier: string) => unknown;
}

type HostRequire = (specifier: string) => unknown;

// Bun exposes this lexical binding in ESM without installing it on globalThis.
declare const require: HostRequire | undefined;

const apply = Reflect.apply;
const BigIntValueOf = BigInt.prototype.valueOf;
const box = Object;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectPrototype = Object.prototype;
const setPrototypeOf = Object.setPrototypeOf;
const SymbolValueOf = Symbol.prototype.valueOf;

const nonPlainBuiltinCheckNames = [
  "isAnyArrayBuffer",
  "isArgumentsObject",
  "isArrayBufferView",
  "isBoxedPrimitive",
  "isCryptoKey",
  "isDataView",
  "isDate",
  "isGeneratorObject",
  "isKeyObject",
  "isMap",
  "isMapIterator",
  "isModuleNamespaceObject",
  "isNativeError",
  "isPromise",
  "isRegExp",
  "isSet",
  "isSetIterator",
  "isTypedArray",
  "isWeakMap",
  "isWeakSet",
] as const;

// Keep this list to immutable host predicates. JavaScript exposes additional
// native slots, such as WeakRef and FinalizationRegistry, only through methods
// that throw on an ordinary object. Probing those methods here would put
// exception allocation back on every strict JSON object this boundary serves.

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
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

function hasNativeSlot(
  value: unknown,
  method: (this: unknown) => unknown,
): boolean {
  try {
    apply(method, value, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotNativeBrandChecks(value: unknown): NativeBrandChecks | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const snapshot = createObject(null) as NativeBrandChecks;
  for (
    const key of [
      "isAsyncFunction",
      "isBoxedPrimitive",
      "isNativeError",
      "isPromise",
      "isProxy",
      "isUint8Array",
      "isWeakMap",
      "isWeakSet",
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
  const nonPlainBuiltinChecks = createObject(null) as Record<
    (typeof nonPlainBuiltinCheckNames)[number],
    ((value: unknown) => boolean) | undefined
  >;
  for (const key of nonPlainBuiltinCheckNames) {
    const check = readOwnDataFunction(value, key);
    if (check) {
      defineProperty(nonPlainBuiltinChecks, key, {
        configurable: false,
        enumerable: true,
        value: check,
        writable: false,
      });
    }
  }
  freeze(nonPlainBuiltinChecks);
  const proxyCheck = snapshot.isProxy;
  const boxedPrimitiveCheck = snapshot.isBoxedPrimitive;
  const disguisedBigInt = setPrototypeOf(new box(0n), objectPrototype);
  const disguisedSymbol = setPrototypeOf(new box(Symbol()), objectPrototype);
  const needsBigIntSlotFallback = !apply(boxedPrimitiveCheck, undefined, [disguisedBigInt]);
  const needsSymbolSlotFallback = !apply(boxedPrimitiveCheck, undefined, [disguisedSymbol]);
  defineProperty(snapshot, "isNonPlainBuiltin", {
    configurable: false,
    enumerable: true,
    value: (candidate: unknown): boolean => {
      // Some optional node:util predicates consult internal symbol properties
      // on proxies. Rejecting proxies belongs to the caller's dedicated proxy
      // path, so keep this aggregate check hook-free by stopping here.
      if (apply(proxyCheck, undefined, [candidate]) === true) return false;
      for (const key of nonPlainBuiltinCheckNames) {
        const check = nonPlainBuiltinChecks[key];
        if (check && apply(check, undefined, [candidate]) === true) return true;
      }
      // Bun's node:util/types currently misses BigInt and Symbol boxes after
      // their visible prototype changes. Probe only the brands the loaded host
      // predicates demonstrably lack; Node and Deno retain the exception-free
      // path for ordinary strict objects.
      if (needsBigIntSlotFallback && hasNativeSlot(candidate, BigIntValueOf)) return true;
      if (needsSymbolSlotFallback && hasNativeSlot(candidate, SymbolValueOf)) return true;
      return false;
    },
    writable: false,
  });
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
