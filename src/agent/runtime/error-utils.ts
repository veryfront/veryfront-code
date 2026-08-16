import { snapshotJsonValue } from "#veryfront/provider/runtime-loader/json-snapshot.ts";
import {
  canIdentifyProxyWithoutHooks,
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export { createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";

/** Maximum UTF-8 size of tool failure text forwarded to logs, clients, or models. */
export const MAX_TOOL_ERROR_TEXT_BYTES = 4_096;

const TOOL_ERROR_TEXT_TRUNCATION_SUFFIX = "…";
const TOOL_ERROR_TEXT_TRUNCATION_SUFFIX_BYTES = 3;
const UNKNOWN_TOOL_ERROR_TEXT = "Unknown error";
const apply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const dateToISOString = Date.prototype.toISOString;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const jsonStringify = JSON.stringify;
const mathMin = Math.min;
const NativeArrayPrototype = Array.prototype;
const NativeDatePrototype = Date.prototype;
const NativeObjectPrototype = Object.prototype;
const NativeWeakSet = WeakSet;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const stringFromValue = String;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const weakSetHas = WeakSet.prototype.has;
const MAX_BEST_EFFORT_DEPTH = 8;
const MAX_BEST_EFFORT_NODES = 256;
const OMIT_DIAGNOSTIC_VALUE = Symbol("omit-diagnostic-value");

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

function hasWeakSetValue(set: WeakSet<object>, value: object): boolean {
  return apply(weakSetHas, set, [value]) as boolean;
}

function addWeakSetValue(set: WeakSet<object>, value: object): void {
  apply(weakSetAdd, set, [value]);
}

function deleteWeakSetValue(set: WeakSet<object>, value: object): void {
  apply(weakSetDelete, set, [value]);
}

function readOwnGetter(object: object, key: PropertyKey): (() => unknown) | undefined {
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor && hasOwn(descriptor, "get") && typeof descriptor.get === "function"
    ? descriptor.get
    : undefined;
}

const DOM_EXCEPTION_MESSAGE_GETTER = typeof DOMException === "function"
  ? readOwnGetter(DOMException.prototype, "message")
  : undefined;

function charCodeAt(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]);
}

function slice(value: string, start: number, end?: number): string {
  return apply(stringSlice, value, end === undefined ? [start] : [start, end]);
}

function codePointUtf8Width(value: string, index: number): { bytes: number; codeUnits: number } {
  const codeUnit = charCodeAt(value, index);
  if (codeUnit <= 0x7f) return { bytes: 1, codeUnits: 1 };
  if (codeUnit <= 0x7ff) return { bytes: 2, codeUnits: 1 };
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = charCodeAt(value, index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, codeUnits: 2 };
    }
  }
  // TextEncoder replaces lone surrogates with the three-byte U+FFFD sequence.
  return { bytes: 3, codeUnits: 1 };
}

function boundToolErrorText(value: string): string {
  let bytes = 0;
  let index = 0;
  let suffixSafeIndex = 0;

  while (index < value.length) {
    const width = codePointUtf8Width(value, index);
    if (width.bytes > MAX_TOOL_ERROR_TEXT_BYTES - bytes) {
      return slice(value, 0, suffixSafeIndex) + TOOL_ERROR_TEXT_TRUNCATION_SUFFIX;
    }
    bytes += width.bytes;
    index += width.codeUnits;
    if (bytes <= MAX_TOOL_ERROR_TEXT_BYTES - TOOL_ERROR_TEXT_TRUNCATION_SUFFIX_BYTES) {
      suffixSafeIndex = index;
    }
  }

  return value;
}

function readOwnMessage(error: unknown): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const descriptor = getOwnPropertyDescriptor(error, "message");
    return descriptor && hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function readNativeDomExceptionMessage(error: unknown): string | undefined {
  if (
    !DOM_EXCEPTION_MESSAGE_GETTER ||
    ((typeof error !== "object" || error === null) && typeof error !== "function")
  ) {
    return undefined;
  }

  try {
    const message = apply(DOM_EXCEPTION_MESSAGE_GETTER, error, []);
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

type BestEffortDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | BestEffortDiagnosticValue[]
  | { [key: string]: BestEffortDiagnosticValue };

interface BestEffortDiagnosticState {
  ancestors: WeakSet<object>;
  nodes: number;
}

function inspectOwnDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function defineDiagnosticProperty(
  target: BestEffortDiagnosticValue[] | Record<string, BestEffortDiagnosticValue>,
  key: PropertyKey,
  value: BestEffortDiagnosticValue,
): void {
  objectDefineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function defineDiagnosticSerializationGuard(target: BestEffortDiagnosticValue[]): void {
  objectDefineProperty(target, "toJSON", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

/**
 * Build a partial diagnostic after the strict JSON snapshot rejects one
 * branch. This path never evaluates accessors, coercion hooks, or Proxy traps:
 * unsafe branches are omitted (or represented as null in arrays) while safe
 * siblings remain useful to operators and models.
 */
function snapshotBestEffortDiagnostic(
  value: unknown,
  depth: number,
  state: BestEffortDiagnosticState,
): BestEffortDiagnosticValue | typeof OMIT_DIAGNOSTIC_VALUE {
  if (state.nodes >= MAX_BEST_EFFORT_NODES || depth > MAX_BEST_EFFORT_DEPTH) {
    return OMIT_DIAGNOSTIC_VALUE;
  }
  state.nodes += 1;

  if (value === null) return null;
  if (typeof value === "string") return boundToolErrorText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return numberIsFinite(value) ? value : OMIT_DIAGNOSTIC_VALUE;
  if (typeof value !== "object") return OMIT_DIAGNOSTIC_VALUE;

  if (isProxyWithoutHooks(value) || hasWeakSetValue(state.ancestors, value)) {
    return OMIT_DIAGNOSTIC_VALUE;
  }

  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
  } catch {
    return OMIT_DIAGNOSTIC_VALUE;
  }

  if (prototype === NativeDatePrototype) {
    try {
      return apply(dateToISOString, value, []) as string;
    } catch {
      return OMIT_DIAGNOSTIC_VALUE;
    }
  }

  const isArray = ArrayIsArray(value);
  if (
    (isArray && prototype !== NativeArrayPrototype) ||
    (!isArray && prototype !== NativeObjectPrototype && prototype !== null)
  ) {
    return OMIT_DIAGNOSTIC_VALUE;
  }

  addWeakSetValue(state.ancestors, value);
  try {
    if (isArray) {
      const lengthDescriptor = inspectOwnDescriptor(value, "length");
      if (
        !lengthDescriptor || !hasOwn(lengthDescriptor, "value") ||
        !numberIsSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
      ) {
        return OMIT_DIAGNOSTIC_VALUE;
      }
      const length = mathMin(
        lengthDescriptor.value as number,
        MAX_BEST_EFFORT_NODES - state.nodes,
      );
      const result: BestEffortDiagnosticValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = inspectOwnDescriptor(value, stringFromValue(index));
        const child = descriptor && descriptor.enumerable === true && hasOwn(descriptor, "value")
          ? snapshotBestEffortDiagnostic(descriptor.value, depth + 1, state)
          : OMIT_DIAGNOSTIC_VALUE;
        defineDiagnosticProperty(
          result,
          index,
          child === OMIT_DIAGNOSTIC_VALUE ? null : child,
        );
      }
      defineDiagnosticSerializationGuard(result);
      return result;
    }

    let keys: (string | symbol)[];
    try {
      keys = ownKeys(value);
    } catch {
      return OMIT_DIAGNOSTIC_VALUE;
    }
    const result = objectCreate(null) as Record<string, BestEffortDiagnosticValue>;
    let retainedProperties = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") continue;
      const descriptor = inspectOwnDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !hasOwn(descriptor, "value")) continue;
      const child = snapshotBestEffortDiagnostic(descriptor.value, depth + 1, state);
      if (child !== OMIT_DIAGNOSTIC_VALUE) {
        defineDiagnosticProperty(result, key, child);
        retainedProperties += 1;
      }
      if (state.nodes >= MAX_BEST_EFFORT_NODES) break;
    }
    return retainedProperties > 0 ? result : OMIT_DIAGNOSTIC_VALUE;
  } finally {
    deleteWeakSetValue(state.ancestors, value);
  }
}

function stringifyBestEffortDiagnostic(error: unknown): string | undefined {
  if (!canIdentifyProxyWithoutHooks) return undefined;
  const snapshot = snapshotBestEffortDiagnostic(error, 0, {
    ancestors: new NativeWeakSet(),
    nodes: 0,
  });
  if (snapshot === OMIT_DIAGNOSTIC_VALUE) return undefined;
  try {
    const serialized = jsonStringify(snapshot);
    return typeof serialized === "string" && serialized.length > 0
      ? boundToolErrorText(serialized)
      : undefined;
  } catch {
    return undefined;
  }
}

export function stringifyToolError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return boundToolErrorText(error);
  }

  const objectLike = (typeof error === "object" && error !== null) || typeof error === "function";
  if (objectLike) {
    if (canIdentifyProxyWithoutHooks) {
      if (isProxyWithoutHooks(error)) return UNKNOWN_TOOL_ERROR_TEXT;
    } else if (!isNativeErrorWithoutHooks(error)) {
      // Without a no-hook Proxy brand check, ordinary objects and functions
      // cannot be distinguished safely from Proxy values. Native Error brands
      // remain readable through the captured Error.isError primitive.
      return UNKNOWN_TOOL_ERROR_TEXT;
    }
  }

  const ownMessage = readOwnMessage(error);
  if (ownMessage !== undefined && ownMessage.length > 0) {
    return boundToolErrorText(ownMessage);
  }

  const domExceptionMessage = readNativeDomExceptionMessage(error);
  if (domExceptionMessage !== undefined && domExceptionMessage.length > 0) {
    return boundToolErrorText(domExceptionMessage);
  }

  // A genuine Error without a readable message is already exhausted here.
  // Do not pass it into object reflection when Proxy detection is unavailable.
  if (objectLike && !canIdentifyProxyWithoutHooks) {
    return UNKNOWN_TOOL_ERROR_TEXT;
  }

  try {
    const snapshot = snapshotJsonValue(error, {
      maxBytes: MAX_TOOL_ERROR_TEXT_BYTES,
      maxDepth: 16,
      maxNodes: 1_024,
    });
    const serialized = jsonStringify(snapshot);
    return typeof serialized === "string" && serialized.length > 0
      ? boundToolErrorText(serialized)
      : UNKNOWN_TOOL_ERROR_TEXT;
  } catch {
    if (error === undefined) return "undefined";
    if (typeof error === "bigint") return "bigint";
    if (typeof error === "symbol") return "symbol";
    return stringifyBestEffortDiagnostic(error) ?? UNKNOWN_TOOL_ERROR_TEXT;
  }
}
