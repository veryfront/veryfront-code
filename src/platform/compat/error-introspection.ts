/**
 * Runtime-compatible, no-hook value introspection.
 *
 * Node-compatible hosts expose internal-slot checks that do not consult
 * mutable global constructors. Browser and edge imports must remain linkable
 * even though those hosts do not provide `node:util/types`.
 */
import { nativeBrandChecks } from "./native-brand-checks.ts";

const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const deleteProperty = Reflect.deleteProperty;
const apply = Reflect.apply;
const NativeError = Error;
const NativeAsyncFunctionPrototype = getPrototypeOf(async function () {});
const toStringTagSymbol = Symbol.toStringTag;

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

type ErrorBrandCheck = (value: unknown) => boolean;

/**
 * Capture the portable Error brand primitive during trusted framework
 * bootstrap, before tenant code can replace mutable globals. Edge runtimes do
 * not expose an immutable host-module equivalent, so this capture boundary is
 * the authority for later no-hook Error checks.
 */
function captureErrorIsError(): ErrorBrandCheck | undefined {
  const descriptor = getOwnPropertyDescriptor(NativeError, "isError");
  return descriptor && hasOwn(descriptor, "value") &&
      typeof descriptor.value === "function"
    ? descriptor.value as ErrorBrandCheck
    : undefined;
}

const capturedErrorIsError = captureErrorIsError();
const unavailableBrandCheck = (_value: unknown): boolean => false;

function portableErrorBrandCheck(value: unknown): boolean {
  if (!capturedErrorIsError) return false;
  try {
    return apply(capturedErrorIsError, NativeError, [value]) === true;
  } catch (_) {
    return false;
  }
}

const nativeAsyncFunctionBrandCheck = nativeBrandChecks?.isAsyncFunction ?? unavailableBrandCheck;
const nativeErrorBrandCheck = nativeBrandChecks?.isNativeError ?? portableErrorBrandCheck;
const nativePromiseBrandCheck = nativeBrandChecks?.isPromise ?? unavailableBrandCheck;
const nativeProxyBrandCheck = nativeBrandChecks?.isProxy ?? unavailableBrandCheck;
const nativeUint8ArrayBrandCheck = nativeBrandChecks?.isUint8Array ?? unavailableBrandCheck;

/**
 * Whether this runtime can distinguish Proxy values without evaluating a trap.
 * Callers that need a fail-closed guarantee must not treat a `false` result
 * from {@link isProxyWithoutHooks} as proof when this capability is absent.
 */
export const canIdentifyProxyWithoutHooks = nativeBrandChecks !== undefined;

function createDataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = true;
  return descriptor;
}

function clonePropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone = createObject(null) as PropertyDescriptor;
  for (
    const key of [
      "configurable",
      "enumerable",
      "get",
      "set",
      "value",
      "writable",
    ] as const
  ) {
    if (hasOwn(descriptor, key)) clone[key] = descriptor[key] as never;
  }
  return clone;
}

/**
 * Run `read` while an own `prepareStackTrace` data property shadows both own
 * and inherited project hooks, so no user formatter observes or rewrites a
 * stack the runtime materializes. The original descriptor is restored before
 * returning. `restored` reports whether the shadow was removed again.
 */
function withShadowedStackFormatter<T>(
  read: () => T,
): { value: T | undefined; restored: boolean } {
  let originalFormatter: PropertyDescriptor | undefined;
  try {
    const descriptor = getOwnPropertyDescriptor(NativeError, "prepareStackTrace");
    originalFormatter = descriptor ? clonePropertyDescriptor(descriptor) : undefined;
  } catch (_) {
    return { value: undefined, restored: false };
  }

  let installed = false;
  let restored = false;
  let value: T | undefined;
  try {
    defineProperty(
      NativeError,
      "prepareStackTrace",
      createDataDescriptor(undefined),
    );
    installed = true;
    value = read();
  } catch (_) {
    // A non-configurable formatter or hostile runtime disables stack capture.
  } finally {
    if (installed) {
      try {
        restored = originalFormatter
          ? (defineProperty(NativeError, "prepareStackTrace", originalFormatter), true)
          : deleteProperty(NativeError, "prepareStackTrace");
      } catch (_) {
        restored = false;
      }
    }
  }
  return { value, restored };
}

/**
 * Probe the runtime's actual stack-descriptor behavior without trusting a
 * mutable version or feature flag, and capture the runtime's own stack getter.
 *
 * The getter is shared by every error the runtime creates, so its identity is
 * what later distinguishes a runtime-installed accessor from one an attacker
 * or an instrumentation layer defined on a specific error.
 */
function detectNativeErrorStackGetter(): ((this: unknown) => unknown) | undefined {
  const probe = withShadowedStackFormatter(() =>
    getOwnPropertyDescriptor(new NativeError(), "stack")
  );
  const stackDescriptor = probe.value;
  if (!probe.restored || !stackDescriptor || !hasOwn(stackDescriptor, "get")) {
    return undefined;
  }
  const getter = stackDescriptor.get;
  return typeof getter === "function" ? getter : undefined;
}

const NATIVE_ERROR_STACK_GETTER = detectNativeErrorStackGetter();

/** True when own stack descriptors can be inspected without formatting them. */
export const canInspectErrorStackDescriptorWithoutHooks = NATIVE_ERROR_STACK_GETTER !== undefined;

const MAX_ERROR_PROTOTYPE_CHAIN_DEPTH = 100;

/**
 * True when `key` is absent or resolves to a data property across the whole
 * prototype chain, so the runtime can read it without running project code.
 */
function resolvesWithoutAccessor(value: object, key: PropertyKey): boolean {
  let current: object | null = value;
  for (
    let depth = 0;
    current !== null && depth < MAX_ERROR_PROTOTYPE_CHAIN_DEPTH;
    depth++
  ) {
    if (nativeProxyBrandCheck(current)) return false;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = getOwnPropertyDescriptor(current, key);
    } catch (_) {
      return false;
    }
    if (descriptor) return hasOwn(descriptor, "value");
    try {
      current = getPrototypeOf(current);
    } catch (_) {
      return false;
    }
  }
  return current === null;
}

/**
 * Read a native Error's stack without letting project code observe the read.
 *
 * Data-valued stacks are returned directly. An accessor is only invoked when it
 * is the runtime's own getter, and then only with `Error.prepareStackTrace`
 * shadowed; any other accessor fails closed rather than running foreign code.
 *
 * Materializing a lazy stack makes the runtime format the error header, which
 * reads `name` and `message`. Both must therefore resolve to data properties,
 * or the read is skipped rather than allowed to trigger a project accessor.
 */
export function readNativeErrorStackWithoutHooks(error: Error): string | undefined {
  if (!NATIVE_ERROR_STACK_GETTER) return undefined;

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(error, "stack");
  } catch (_) {
    return undefined;
  }
  if (!descriptor) return undefined;
  if (hasOwn(descriptor, "value")) {
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  }
  if (descriptor.get !== NATIVE_ERROR_STACK_GETTER) return undefined;
  if (
    !resolvesWithoutAccessor(error, "message") ||
    !resolvesWithoutAccessor(error, "name")
  ) {
    return undefined;
  }

  const stack = withShadowedStackFormatter(() => apply(NATIVE_ERROR_STACK_GETTER, error, [])).value;
  return typeof stack === "string" ? stack : undefined;
}

/**
 * Identify native Error values without evaluating project-owned Proxy traps.
 */
export function isNativeErrorWithoutHooks(value: unknown): value is Error {
  return nativeErrorBrandCheck(value);
}

/**
 * Identify an Error whose prototype chain may have been minted somewhere else.
 *
 * `value instanceof Error` compares against the `Error.prototype` of whichever
 * realm this module was evaluated in. An Error produced in a worker, a `vm`
 * context, or a second instance of this module graph — which the Node and Bun
 * loaders both produce, one per package copy or per transpiled entry — carries
 * a different `Error.prototype` and fails that comparison even though it is a
 * genuine Error. Code that branches on `instanceof` to decide whether to keep
 * an error therefore discards real errors at exactly those boundaries.
 *
 * The native brand check reads the runtime's own `[[ErrorData]]` internal slot,
 * which no realm boundary changes, so it recognizes those errors. `instanceof`
 * stays as a second branch because Bun does not report `DOMException` as a
 * native error, and a DOMException — the shape every unattributed `AbortSignal`
 * cancellation reason takes — must keep being recognized there.
 *
 * Values that merely look like errors (a plain object carrying `name` and
 * `message`, or one tagged `[object Error]` through `Symbol.toStringTag`) are
 * rejected by both branches, so this stays a brand check rather than a shape
 * check.
 *
 * Unlike {@link isNativeErrorWithoutHooks} this can run project code: the
 * `instanceof` branch consults `Symbol.hasInstance`. Callers that must not
 * execute foreign hooks use the brand check directly.
 */
export function isErrorAcrossRealms(value: unknown): value is Error {
  return nativeErrorBrandCheck(value) || value instanceof NativeError;
}

function readOwnDataString(
  value: object,
  key: PropertyKey,
): string | undefined {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
  return typeof descriptor.value === "string" && descriptor.value ? descriptor.value : undefined;
}

function readCustomErrorConstructorName(
  prototype: object,
): string | undefined {
  const constructorDescriptor = getOwnPropertyDescriptor(
    prototype,
    "constructor",
  );
  if (
    !constructorDescriptor ||
    !hasOwn(constructorDescriptor, "value") ||
    typeof constructorDescriptor.value !== "function" ||
    nativeProxyBrandCheck(constructorDescriptor.value)
  ) {
    return undefined;
  }
  return readOwnDataString(constructorDescriptor.value, "name");
}

/**
 * Read a native Error's display name without executing instance, prototype, or
 * constructor accessors. Custom subclasses use their own data-valued
 * prototype name or constructor name; unreadable/exotic shapes fail closed.
 */
export function readNativeErrorNameWithoutHooks(error: Error): string {
  try {
    const ownNameDescriptor = getOwnPropertyDescriptor(error, "name");
    if (ownNameDescriptor) {
      if (!hasOwn(ownNameDescriptor, "value")) return "Error";
      return typeof ownNameDescriptor.value === "string" && ownNameDescriptor.value
        ? ownNameDescriptor.value
        : "Error";
    }

    const prototype = getPrototypeOf(error);
    if (prototype === null || nativeProxyBrandCheck(prototype)) return "Error";
    return readOwnDataString(prototype, "name") ??
      readCustomErrorConstructorName(prototype) ??
      "Error";
  } catch (_) {
    return "Error";
  }
}

/**
 * Identify a Proxy without evaluating any trap on the proxied value.
 *
 * Returns `false` without inspecting `value` when
 * {@link canIdentifyProxyWithoutHooks} is false.
 */
export function isProxyWithoutHooks(value: unknown): boolean {
  return nativeProxyBrandCheck(value);
}

/** Identify a genuine Uint8Array without evaluating project-owned hooks. */
export function isUint8ArrayWithoutHooks(value: unknown): value is Uint8Array {
  return nativeUint8ArrayBrandCheck(value);
}

/** Identify a genuine Promise across realms without reading instance fields. */
export function isNativePromiseWithoutHooks(
  value: unknown,
): value is Promise<unknown> {
  return nativePromiseBrandCheck(value);
}

/**
 * Identify native and bound async functions across realms without invoking
 * project hooks. The descriptor fallback is deliberately conservative because
 * runtime brand checks do not recognize bound async functions.
 */
export function isNativeAsyncFunctionWithoutHooks(
  value: unknown,
): value is (...args: unknown[]) => Promise<unknown> {
  if (nativeAsyncFunctionBrandCheck(value)) return true;
  if (typeof value !== "function" || nativeProxyBrandCheck(value)) return false;

  try {
    const prototype = getPrototypeOf(value);
    if (prototype === NativeAsyncFunctionPrototype) return true;
    if (prototype === null || nativeProxyBrandCheck(prototype)) return false;

    const tag = getOwnPropertyDescriptor(prototype, toStringTagSymbol);
    return tag !== undefined &&
      hasOwn(tag, "value") &&
      tag.value === "AsyncFunction";
  } catch (_) {
    return false;
  }
}
