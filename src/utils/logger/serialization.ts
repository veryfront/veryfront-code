import { REDACTED, redactForSerialization } from "./redact.ts";

// Capture serialization intrinsics before project code can modify globals.
// Logging and telemetry serialization are safety boundaries and must not become
// throwable or leak data when a tenant mutates Object/Array prototypes.
const arrayIsArray = Array.isArray;
const jsonStringify = JSON.stringify;
const objectDefineProperty = Object.defineProperty;
const objectHasOwn = Object.hasOwn;
const objectValues = Object.values;

function blockInheritedSerializationHooks(value: unknown): void {
  if (value === null || typeof value !== "object") return;

  if (!objectHasOwn(value, "toJSON")) {
    objectDefineProperty(value, "toJSON", {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  }

  if (arrayIsArray(value)) {
    for (let index = 0; index < value.length; index++) {
      blockInheritedSerializationHooks(value[index]);
    }
    return;
  }

  const values = objectValues(value);
  for (let index = 0; index < values.length; index++) {
    blockInheritedSerializationHooks(values[index]);
  }
}

function stringifyFallback(fallbackValue: unknown): string {
  if (typeof fallbackValue === "string") return fallbackValue;
  return jsonStringify(fallbackValue) ?? REDACTED;
}

export function stringifyRedactedJson(
  value: unknown,
  fallbackValue: unknown = REDACTED,
): string {
  try {
    const snapshot = redactForSerialization(value);
    blockInheritedSerializationHooks(snapshot);
    return jsonStringify(snapshot) ?? REDACTED;
  } catch {
    return stringifyFallback(fallbackValue);
  }
}

export function stringifyRedactedAttributeValue(
  value: object,
  fallbackValue: string = REDACTED,
): string {
  try {
    const snapshot = redactForSerialization(value);
    if (typeof snapshot === "string") return snapshot;
    blockInheritedSerializationHooks(snapshot);
    return jsonStringify(snapshot) ?? REDACTED;
  } catch {
    return fallbackValue;
  }
}
