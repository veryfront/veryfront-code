const DEFAULT_MAX_JSON_DEPTH = 64;
const DEFAULT_MAX_JSON_NODES = 100_000;
const DEFAULT_MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_JSON_COLLECTION_ENTRIES = 100_000;
const MAX_JSON_STRING_LENGTH = 1024 * 1024;
const MAX_JSON_KEY_LENGTH = 4_096;

export interface JsonSnapshotOptions {
  /** Error-label prefix. */
  label?: string;
  /** Maximum nested object/array depth. */
  maxDepth?: number;
  /** Maximum primitive, object, and array values traversed. */
  maxNodes?: number;
  /** Maximum UTF-8 bytes after JSON serialization. */
  maxBytes?: number;
  /** Maximum UTF-16 code units in one string value. */
  maxStringLength?: number;
}

function invalidJson(label: string, detail: string): never {
  throw new TypeError(`${label} must be JSON-safe: ${detail}`);
}

function validateLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Create a bounded, descriptor-safe JSON snapshot without invoking accessors,
 * custom `toJSON` methods, or proxy-backed collection iteration.
 */
export function snapshotJsonValue<T>(value: T, options: JsonSnapshotOptions = {}): T {
  const label = options.label ?? "Value";
  const maxDepth = validateLimit(options.maxDepth ?? DEFAULT_MAX_JSON_DEPTH, "maxDepth");
  const maxNodes = validateLimit(options.maxNodes ?? DEFAULT_MAX_JSON_NODES, "maxNodes");
  const maxBytes = validateLimit(options.maxBytes ?? DEFAULT_MAX_JSON_BYTES, "maxBytes");
  const maxStringLength = validateLimit(
    options.maxStringLength ?? MAX_JSON_STRING_LENGTH,
    "maxStringLength",
  );
  const ancestors = new WeakSet<object>();
  const encoder = new TextEncoder();
  let nodes = 0;
  let serializedBytes = 0;

  const addSerializedBytes = (count: number): void => {
    serializedBytes += count;
    if (serializedBytes > maxBytes) {
      invalidJson(label, `serialized size exceeds ${maxBytes} bytes`);
    }
  };

  const addSerializedValue = (current: string | number | boolean | null): void => {
    addSerializedBytes(encoder.encode(JSON.stringify(current)).byteLength);
  };

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > maxNodes) invalidJson(label, `value count exceeds ${maxNodes}`);
    if (depth > maxDepth) invalidJson(label, `nesting depth exceeds ${maxDepth}`);

    if (current === null || typeof current === "boolean") {
      addSerializedValue(current);
      return current;
    }
    if (typeof current === "string") {
      if (current.length > maxStringLength) {
        invalidJson(label, `string length exceeds ${maxStringLength}`);
      }
      addSerializedValue(current);
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalidJson(label, "numbers must be finite");
      const normalized = Object.is(current, -0) ? 0 : current;
      addSerializedValue(normalized);
      return normalized;
    }
    if (typeof current !== "object") {
      invalidJson(label, `${typeof current} values are not supported`);
    }

    if (ancestors.has(current)) invalidJson(label, "cyclic references are not supported");

    let isArray: boolean;
    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      isArray = Array.isArray(current);
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      invalidJson(label, "object metadata could not be inspected");
    }

    if (
      (!isArray && prototype !== Object.prototype && prototype !== null) ||
      (isArray && prototype !== Array.prototype)
    ) {
      invalidJson(label, "only plain objects and arrays are supported");
    }

    const symbolKeys = Object.getOwnPropertySymbols(descriptors);
    if (symbolKeys.length > 0) invalidJson(label, "symbol properties are not supported");

    ancestors.add(current);
    try {
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!Number.isSafeInteger(length) || length < 0) {
          invalidJson(label, "array length is invalid");
        }
        if (length > MAX_JSON_COLLECTION_ENTRIES) {
          invalidJson(label, `array length exceeds ${MAX_JSON_COLLECTION_ENTRIES}`);
        }

        addSerializedBytes(2);
        const result: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          if (index > 0) addSerializedBytes(1);
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            invalidJson(label, "sparse or accessor-backed arrays are not supported");
          }
          result.push(visit(descriptor.value, depth + 1));
        }
        const expectedKeys = length + 1;
        if (Reflect.ownKeys(descriptors).length !== expectedKeys) {
          invalidJson(label, "custom array properties are not supported");
        }
        return result;
      }

      const keys = Object.keys(descriptors);
      if (keys.length > MAX_JSON_COLLECTION_ENTRIES) {
        invalidJson(label, `property count exceeds ${MAX_JSON_COLLECTION_ENTRIES}`);
      }
      addSerializedBytes(2);
      const result = prototype === null ? Object.create(null) : {};
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        if (key.length > MAX_JSON_KEY_LENGTH) {
          invalidJson(label, `property name length exceeds ${MAX_JSON_KEY_LENGTH}`);
        }
        if (index > 0) addSerializedBytes(1);
        addSerializedBytes(encoder.encode(JSON.stringify(key)).byteLength + 1);
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          invalidJson(label, "only enumerable data properties are supported");
        }
        Object.defineProperty(result, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(current);
    }
  };

  const snapshot = visit(value, 0);
  const serialized = JSON.stringify(snapshot);
  if (serialized === undefined) invalidJson(label, "the root value cannot be serialized");
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > maxBytes) invalidJson(label, `serialized size exceeds ${maxBytes} bytes`);
  return snapshot as T;
}
