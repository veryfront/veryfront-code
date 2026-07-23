import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { isSensitiveKey, REDACTED } from "#veryfront/utils/logger/redact.ts";

const MAX_LOG_OUTPUT_DEPTH = 16;
const MAX_LOG_OUTPUT_NODES = 2_048;
const MAX_LOG_COLLECTION_ENTRIES = 100;
const MAX_LOG_STRING_LENGTH = 4_096;
const MAX_LOG_KEY_LENGTH = 256;
const MAX_LOG_TEXT_LENGTH = 32_768;
const MAX_SERIALIZED_LOG_OUTPUT_LENGTH = 65_536;
const TRUNCATED = "[TRUNCATED]";
const REDACTED_KEY = "[REDACTED_KEY]";

interface SanitizeState {
  readonly ancestors: WeakSet<object>;
  nodes: number;
  remainingText: number;
}

function sanitizeText(value: string, state: SanitizeState, maxLength: number): string {
  if (state.remainingText <= 0) return TRUNCATED;
  const boundedLength = Math.max(
    1,
    Math.min(maxLength, state.remainingText),
  );
  const sanitized = sanitizeErrorText(value, boundedLength);
  state.remainingText = Math.max(0, state.remainingText - sanitized.length);
  return sanitized;
}

function defineSafeProperty(
  output: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(output, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function blockInheritedJsonSerializer(output: object): void {
  Object.defineProperty(output, "toJSON", {
    configurable: true,
    enumerable: false,
    value: null,
    writable: false,
  });
}

function sanitizeArray(value: unknown[], depth: number, state: SanitizeState): unknown {
  let length: number;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !descriptor || !("value" in descriptor) ||
      typeof descriptor.value !== "number" ||
      !Number.isSafeInteger(descriptor.value) || descriptor.value < 0
    ) {
      return REDACTED;
    }
    length = descriptor.value;
  } catch {
    return REDACTED;
  }

  const output: unknown[] = [];
  blockInheritedJsonSerializer(output);
  const visibleLength = Math.min(length, MAX_LOG_COLLECTION_ENTRIES);
  for (let index = 0; index < visibleLength; index += 1) {
    if (state.nodes >= MAX_LOG_OUTPUT_NODES) {
      output[output.length] = TRUNCATED;
      return output;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      output[output.length] = descriptor && "value" in descriptor
        ? sanitizeValue(descriptor.value, depth + 1, state)
        : REDACTED;
    } catch {
      output[output.length] = REDACTED;
    }
  }
  if (length > visibleLength) output[output.length] = TRUNCATED;
  return output;
}

function sanitizeObject(
  value: object,
  depth: number,
  state: SanitizeState,
): unknown {
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return REDACTED;
    keys = Reflect.ownKeys(value);
  } catch {
    return REDACTED;
  }

  const output: Record<string, unknown> = {};
  blockInheritedJsonSerializer(output);
  let visibleProperties = 0;
  const inspectedKeys = keys.slice(0, MAX_LOG_COLLECTION_ENTRIES);
  for (const rawKey of inspectedKeys) {
    if (typeof rawKey !== "string" || rawKey === "_tenant") continue;

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
    } catch {
      return REDACTED;
    }
    if (!descriptor?.enumerable) continue;
    if (visibleProperties >= MAX_LOG_COLLECTION_ENTRIES) {
      defineSafeProperty(output, "__truncated__", TRUNCATED);
      break;
    }
    if (state.nodes >= MAX_LOG_OUTPUT_NODES) {
      defineSafeProperty(output, "__truncated__", TRUNCATED);
      break;
    }

    visibleProperties += 1;
    const key = sanitizeText(rawKey, state, MAX_LOG_KEY_LENGTH) || REDACTED_KEY;
    const child = isSensitiveKey(rawKey) || !("value" in descriptor)
      ? REDACTED
      : sanitizeValue(descriptor.value, depth + 1, state);
    defineSafeProperty(output, key, child);
  }
  if (keys.length > inspectedKeys.length) {
    defineSafeProperty(output, "__truncated__", TRUNCATED);
  }
  return output;
}

function sanitizeValue(value: unknown, depth: number, state: SanitizeState): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_LOG_OUTPUT_NODES || depth > MAX_LOG_OUTPUT_DEPTH) {
    return TRUNCATED;
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return sanitizeText(value, state, MAX_LOG_STRING_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : REDACTED;
  }
  if (typeof value !== "object") return REDACTED;

  if (state.ancestors.has(value)) return REDACTED;
  state.ancestors.add(value);
  try {
    let array: boolean;
    try {
      array = Array.isArray(value);
    } catch {
      return REDACTED;
    }
    return array
      ? sanitizeArray(value as unknown[], depth, state)
      : sanitizeObject(value, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

/**
 * Create a bounded, JSON-safe snapshot for human-readable CLI logs.
 *
 * This never invokes getters, iterators, or custom serializers. Raw run output
 * remains available through the configured output writer.
 */
export function sanitizeRunOutputForLogging(value: unknown): unknown {
  try {
    const sanitized = sanitizeValue(value, 0, {
      ancestors: new WeakSet(),
      nodes: 0,
      remainingText: MAX_LOG_TEXT_LENGTH,
    });
    const serialized = JSON.stringify(sanitized);
    if (
      typeof serialized !== "string" ||
      serialized.length > MAX_SERIALIZED_LOG_OUTPUT_LENGTH
    ) {
      return TRUNCATED;
    }
    return sanitized;
  } catch {
    return REDACTED;
  }
}
