/**
 * Defensive JSON normalization for provider-bound chat values.
 *
 * Tool implementations are extension boundaries and can return runtime values
 * that JSON does not represent directly. These helpers preserve useful data
 * without invoking getters or custom `toJSON` hooks, and keep malformed,
 * cyclic, or excessively large values from crashing message preparation.
 */

import { compareStrings } from "#veryfront/utils/compare.ts";
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
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
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
    return value.slice(0, remaining);
  }
  return `${value.slice(0, remaining - suffix.length)}${suffix}`;
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
    return Object.getOwnPropertyDescriptor(value, key);
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
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value") &&
      Number.isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value >= 0
    ? lengthDescriptor.value as number
    : 0;
  const itemCount = Math.min(length, state.maxContainerEntries);
  const output: ChatJsonValue[] = [];

  for (let index = 0; index < itemCount; index += 1) {
    const descriptor = readDescriptor(value, String(index));
    if (!descriptor) {
      output.push(null);
      continue;
    }
    if (!Object.hasOwn(descriptor, "value")) {
      output.push(ACCESSOR_MARKER);
      continue;
    }
    output.push(convertValue(descriptor.value, depth + 1, state));
  }

  if (length > itemCount) {
    output.push(`${TRUNCATED_MARKER} ${length - itemCount} array items`);
  }
  return output;
}

function defineJsonProperty(
  target: Record<string, ChatJsonValue>,
  key: string,
  value: ChatJsonValue,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
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
    keys = Reflect.ownKeys(value)
      .filter((key): key is string => typeof key === "string")
      .filter((key) => readDescriptor(value, key)?.enumerable === true)
      .sort(compareStrings);
  } catch {
    return UNREADABLE_MARKER;
  }

  const output: Record<string, ChatJsonValue> = {};
  const candidateCount = Math.min(keys.length, state.maxContainerEntries);
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
    } else if (!Object.hasOwn(descriptor, "value")) {
      defineJsonProperty(output, key, ACCESSOR_MARKER);
    } else {
      defineJsonProperty(output, key, convertValue(descriptor.value, depth + 1, state));
    }
    entryCount += 1;
  }

  if (keys.length > entryCount) {
    let markerKey = "__veryfront_truncated__";
    while (Object.hasOwn(output, markerKey)) markerKey = `_${markerKey}`;
    defineJsonProperty(output, markerKey, `${keys.length - entryCount} object entries omitted`);
  }
  return output;
}

function convertKnownScalarObject(
  value: object,
  state: ConversionState,
): ChatJsonValue | undefined {
  try {
    if (value instanceof Date) {
      const timestamp = Date.prototype.getTime.call(value);
      return Number.isFinite(timestamp)
        ? boundedString(Date.prototype.toISOString.call(value), state)
        : null;
    }
    if (value instanceof URL) {
      return boundedString(URL.prototype.toString.call(value), state);
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
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    case "bigint":
      return boundedString(value.toString(), state);
    case "undefined":
    case "function":
    case "symbol":
      return null;
    case "object":
      break;
  }

  const objectValue = value as object;
  if (state.ancestors.has(objectValue)) {
    return CIRCULAR_MARKER;
  }

  const scalar = convertKnownScalarObject(objectValue, state);
  if (scalar !== undefined) {
    return scalar;
  }

  state.ancestors.add(objectValue);
  try {
    return Array.isArray(value)
      ? convertArray(value, depth, state)
      : convertObject(objectValue, depth, state);
  } catch {
    return UNREADABLE_MARKER;
  } finally {
    state.ancestors.delete(objectValue);
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
    ancestors: new WeakSet<object>(),
    nodes: 0,
    stringChars: 0,
  });
}

/** Serialize an unknown runtime value through {@link toChatJsonValue}. */
export function stringifyChatJson(
  value: unknown,
  options: ChatJsonValueOptions = {},
): string {
  return JSON.stringify(toChatJsonValue(value, options));
}
