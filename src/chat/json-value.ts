/**
 * Defensive JSON normalization for provider-bound chat values.
 *
 * Tool implementations are extension boundaries and can return runtime values
 * that JSON does not represent directly. These helpers preserve useful data
 * without invoking getters or custom `toJSON` hooks, and keep malformed,
 * cyclic, or excessively large values from crashing message preparation.
 */

import { compareStrings } from "#veryfront/utils/compare.ts";
import { filterPrivateArray, pushPrivateArray } from "#veryfront/security/private-array.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { privateTextSlice } from "#veryfront/security/private-text.ts";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const apply = Reflect.apply;
const arraySort = Array.prototype.sort;
const isArray = Array.isArray;
const isSafeInteger = Number.isSafeInteger;
const isFiniteNumber = Number.isFinite;
const objectIs = Object.is;
const minimum = Math.min;
const NativeWeakSet = WeakSet;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const NativeDate = Date;
const NativeURL = URL;
const dateGetTime = Date.prototype.getTime;
const dateToISOString = Date.prototype.toISOString;
const urlToString = URL.prototype.toString;
const bigintToString = BigInt.prototype.toString;
const stringify = JSON.stringify;
const setPrototypeOf = Object.setPrototypeOf;
const objectKeys = Object.keys;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 65_536;
const DEFAULT_MAX_STRING_CHARS = 8 * 1024 * 1024;
const DEFAULT_MAX_CONTAINER_ENTRIES = 10_000;

const CIRCULAR_MARKER = "[Circular]";
const TRUNCATED_MARKER = "[Truncated]";
const ACCESSOR_MARKER = "[Accessor omitted]";
const UNREADABLE_MARKER = "[Unreadable]";

/** JSON-compatible value emitted by chat boundary normalization. */
export type ChatJsonValue =
  | null
  | boolean
  | number
  | string
  | ChatJsonValue[]
  | { [key: string]: ChatJsonValue };

/** Resource limits for chat JSON normalization. */
export interface ChatJsonValueOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxStringChars?: number;
  maxContainerEntries?: number;
}

interface ResolvedOptions {
  maxDepth: number;
  maxNodes: number;
  maxStringChars: number;
  maxContainerEntries: number;
}

interface ConversionState extends ResolvedOptions {
  ancestors: WeakSet<object>;
  nodes: number;
  stringChars: number;
}

function readLimit(
  value: number | undefined,
  fallback: number,
  name: keyof ChatJsonValueOptions,
  minimum: number,
): number {
  const resolved = value ?? fallback;
  if (!isSafeInteger(resolved) || resolved < minimum) {
    throw new TypeError(`Chat JSON ${name} must be a safe integer no less than ${minimum}`);
  }
  return resolved;
}

function resolveOptions(options: ChatJsonValueOptions): ResolvedOptions {
  return {
    maxDepth: readLimit(options.maxDepth, DEFAULT_MAX_DEPTH, "maxDepth", 0),
    maxNodes: readLimit(options.maxNodes, DEFAULT_MAX_NODES, "maxNodes", 1),
    maxStringChars: readLimit(
      options.maxStringChars,
      DEFAULT_MAX_STRING_CHARS,
      "maxStringChars",
      1,
    ),
    maxContainerEntries: readLimit(
      options.maxContainerEntries,
      DEFAULT_MAX_CONTAINER_ENTRIES,
      "maxContainerEntries",
      1,
    ),
  };
}

function boundedString(value: string, state: ConversionState): string {
  const remaining = state.maxStringChars - state.stringChars;
  if (remaining <= 0) {
    return TRUNCATED_MARKER;
  }
  if (value.length <= remaining) {
    state.stringChars += value.length;
    return value;
  }

  const suffix = "… [truncated]";
  state.stringChars = state.maxStringChars;
  if (remaining <= suffix.length) {
    return privateTextSlice(value, 0, remaining);
  }
  return `${privateTextSlice(value, 0, remaining - suffix.length)}${suffix}`;
}

function beginValue(depth: number, state: ConversionState): boolean {
  if (depth > state.maxDepth || state.nodes >= state.maxNodes) {
    return false;
  }
  state.nodes += 1;
  return true;
}

function readDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
}

function convertArray(
  value: unknown[],
  depth: number,
  state: ConversionState,
): ChatJsonValue[] {
  const lengthDescriptor = readDescriptor(value, "length");
  const length = lengthDescriptor && hasOwn(lengthDescriptor, "value") &&
      isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value >= 0
    ? lengthDescriptor.value as number
    : 0;
  const itemCount = minimum(length, state.maxContainerEntries);
  const output: ChatJsonValue[] = [];

  for (let index = 0; index < itemCount; index += 1) {
    const descriptor = readDescriptor(value, String(index));
    if (!descriptor) {
      pushPrivateArray(output, null);
      continue;
    }
    if (!hasOwn(descriptor, "value")) {
      pushPrivateArray(output, ACCESSOR_MARKER);
      continue;
    }
    pushPrivateArray(output, convertValue(descriptor.value, depth + 1, state));
  }

  if (length > itemCount) {
    pushPrivateArray(output, `${TRUNCATED_MARKER} ${length - itemCount} array items`);
  }
  return output;
}

function defineJsonProperty(
  target: Record<string, ChatJsonValue>,
  key: string,
  value: ChatJsonValue,
): void {
  defineOwnDataProperty(target, key, value, {
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function convertObject(
  value: object,
  depth: number,
  state: ConversionState,
): { [key: string]: ChatJsonValue } | string {
  let keys: string[];
  try {
    keys = filterPrivateArray(
      filterPrivateArray(ownKeys(value), (key): key is string => typeof key === "string"),
      (key) => readDescriptor(value, key)?.enumerable === true,
    );
    apply(arraySort, keys, [compareStrings]);
  } catch {
    return UNREADABLE_MARKER;
  }

  const output: Record<string, ChatJsonValue> = {};
  const candidateCount = minimum(keys.length, state.maxContainerEntries);
  let entryCount = 0;
  for (let index = 0; index < candidateCount; index += 1) {
    const key = keys[index]!;
    if (key.length > state.maxStringChars - state.stringChars) {
      break;
    }
    state.stringChars += key.length;
    const descriptor = readDescriptor(value, key);
    if (!descriptor) {
      defineJsonProperty(output, key, UNREADABLE_MARKER);
    } else if (!hasOwn(descriptor, "value")) {
      defineJsonProperty(output, key, ACCESSOR_MARKER);
    } else {
      defineJsonProperty(output, key, convertValue(descriptor.value, depth + 1, state));
    }
    entryCount += 1;
  }

  if (keys.length > entryCount) {
    let markerKey = "__veryfront_truncated__";
    while (hasOwn(output, markerKey)) markerKey = `_${markerKey}`;
    defineJsonProperty(output, markerKey, `${keys.length - entryCount} object entries omitted`);
  }
  return output;
}

function convertKnownScalarObject(
  value: object,
  state: ConversionState,
): ChatJsonValue | undefined {
  try {
    if (value instanceof NativeDate) {
      const timestamp = apply(dateGetTime, value, []) as number;
      return isFiniteNumber(timestamp)
        ? boundedString(apply(dateToISOString, value, []) as string, state)
        : null;
    }
    if (value instanceof NativeURL) {
      return boundedString(apply(urlToString, value, []) as string, state);
    }
  } catch {
    return UNREADABLE_MARKER;
  }
  return undefined;
}

function convertValue(
  value: unknown,
  depth: number,
  state: ConversionState,
): ChatJsonValue {
  if (!beginValue(depth, state)) {
    return TRUNCATED_MARKER;
  }

  if (value === null) return null;

  switch (typeof value) {
    case "string":
      return boundedString(value, state);
    case "boolean":
      return value;
    case "number":
      return isFiniteNumber(value) ? (objectIs(value, -0) ? 0 : value) : null;
    case "bigint":
      return boundedString(apply(bigintToString, value, []) as string, state);
    case "undefined":
    case "function":
    case "symbol":
      return null;
    case "object":
      break;
  }

  const objectValue = value as object;
  if (apply(weakSetHas, state.ancestors, [objectValue])) {
    return CIRCULAR_MARKER;
  }

  const scalar = convertKnownScalarObject(objectValue, state);
  if (scalar !== undefined) {
    return scalar;
  }

  apply(weakSetAdd, state.ancestors, [objectValue]);
  try {
    return isArray(value)
      ? convertArray(value, depth, state)
      : convertObject(objectValue, depth, state);
  } catch {
    return UNREADABLE_MARKER;
  } finally {
    apply(weakSetDelete, state.ancestors, [objectValue]);
  }
}

/**
 * Convert an unknown runtime value into a bounded JSON-compatible snapshot.
 *
 * BigInts become decimal strings, non-finite numbers become `null`, cycles
 * receive an explicit marker, and accessors/custom `toJSON` hooks are not run.
 */
export function toChatJsonValue(
  value: unknown,
  options: ChatJsonValueOptions = {},
): ChatJsonValue {
  const resolved = resolveOptions(options);
  return convertValue(value, 0, {
    ...resolved,
    ancestors: new NativeWeakSet<object>(),
    nodes: 0,
    stringChars: 0,
  });
}

/** Serialize an unknown runtime value through {@link toChatJsonValue}. */
export function stringifyChatJson(
  value: unknown,
  options: ChatJsonValueOptions = {},
): string {
  const normalized = toChatJsonValue(value, options);
  const protect = (value: ChatJsonValue): void => {
    if (value === null || typeof value !== "object") return;
    setPrototypeOf(value, null);
    const keys = objectKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const descriptor = getOwnPropertyDescriptor(value, keys[index]!)!;
      protect(descriptor.value as ChatJsonValue);
    }
  };
  protect(normalized);
  return stringify(normalized);
}
