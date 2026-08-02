/**
 * Defensive validation for data-only JSON values.
 *
 * Kept internal to the schemas module so runtime schemas and JSON Schema
 * adapter boundaries share one set of resource and prototype-safety checks.
 *
 * @module schemas/json-value
 */

const JSON_VALUE_MAX_DEPTH = 128;
const JSON_VALUE_MAX_NODES = 100_000;
const JSON_VALUE_MAX_SERIALIZED_BYTES = 4 * 1024 * 1024;
const JSON_VALUE_MAX_STRING_BYTES = 1024 * 1024;
const JSON_VALUE_MAX_KEY_BYTES = 16 * 1024;
const JSON_UTF8_ENCODER = new TextEncoder();

export type BoundedJsonValue =
  | string
  | number
  | boolean
  | null
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

export type BoundedJsonSnapshot =
  | { success: true; value: BoundedJsonValue }
  | { success: false };

type CanonicalJsonContainer =
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

type SnapshotFrame =
  | {
    kind: "visit";
    value: unknown;
    depth: number;
    parent?: CanonicalJsonContainer;
    key?: string | number;
  }
  | { kind: "exit"; value: object };

type SnapshotVisitFrame = Extract<SnapshotFrame, { kind: "visit" }>;

const INVALID_JSON_SNAPSHOT: BoundedJsonSnapshot = Object.freeze({ success: false });

function utf8LengthWithin(value: string, limit: number): number | undefined {
  if (value.length > limit) return undefined;
  const byteLength = JSON_UTF8_ENCODER.encode(value).byteLength;
  return byteLength <= limit ? byteLength : undefined;
}

function serializedByteLength(value: string | number | boolean | null): number | undefined {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : JSON_UTF8_ENCODER.encode(serialized).byteLength;
}

/**
 * Creates a bounded, data-only snapshot of an unknown JSON value.
 *
 * The walk is iterative and rejects cycles, accessors, plain-object
 * prototypes other than `Object.prototype` or `null`, non-JSON properties,
 * and inputs above the documented depth, node, string, key, and
 * serialized-size limits. Only property descriptor values captured during
 * this walk are copied, so a stateful Proxy cannot change the value between
 * validation and later consumption.
 */
export function snapshotBoundedJsonValue(value: unknown): BoundedJsonSnapshot {
  try {
    const activeAncestors = new Set<object>();
    const stack: SnapshotFrame[] = [{ kind: "visit", value, depth: 0 }];
    let nodeCount = 0;
    let serializedBytes = 0;
    let canonicalRoot: BoundedJsonValue | undefined;
    let rootAssigned = false;

    const addSerializedBytes = (amount: number): boolean => {
      serializedBytes += amount;
      return serializedBytes <= JSON_VALUE_MAX_SERIALIZED_BYTES;
    };

    const assign = (frame: SnapshotVisitFrame, canonical: BoundedJsonValue): void => {
      if (frame.parent === undefined) {
        canonicalRoot = canonical;
        rootAssigned = true;
        return;
      }
      if (Array.isArray(frame.parent)) {
        frame.parent[frame.key as number] = canonical;
        return;
      }
      defineOwnDataProperty(frame.parent, frame.key as string, canonical);
    };

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      if (frame.kind === "exit") {
        activeAncestors.delete(frame.value);
        continue;
      }

      if (frame.depth > JSON_VALUE_MAX_DEPTH || ++nodeCount > JSON_VALUE_MAX_NODES) {
        return INVALID_JSON_SNAPSHOT;
      }

      const current = frame.value;
      if (current === null || typeof current === "boolean") {
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) return INVALID_JSON_SNAPSHOT;
        assign(frame, current);
        continue;
      }
      if (typeof current === "string") {
        if (utf8LengthWithin(current, JSON_VALUE_MAX_STRING_BYTES) === undefined) {
          return INVALID_JSON_SNAPSHOT;
        }
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) return INVALID_JSON_SNAPSHOT;
        assign(frame, current);
        continue;
      }
      if (typeof current === "number") {
        if (!Number.isFinite(current)) return INVALID_JSON_SNAPSHOT;
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) return INVALID_JSON_SNAPSHOT;
        assign(frame, current);
        continue;
      }
      if (typeof current !== "object" || activeAncestors.has(current)) {
        return INVALID_JSON_SNAPSHOT;
      }

      if (Array.isArray(current)) {
        if (
          !snapshotArray(
            current,
            frame,
            stack,
            activeAncestors,
            addSerializedBytes,
            assign,
          )
        ) {
          return INVALID_JSON_SNAPSHOT;
        }
        continue;
      }

      if (
        !snapshotObject(
          current,
          frame,
          stack,
          activeAncestors,
          addSerializedBytes,
          assign,
        )
      ) {
        return INVALID_JSON_SNAPSHOT;
      }
    }

    return rootAssigned
      ? { success: true, value: canonicalRoot as BoundedJsonValue }
      : INVALID_JSON_SNAPSHOT;
  } catch {
    // Proxy traps and reflective operations can throw. Such values are not
    // data-only JSON inputs and must fail validation rather than escape it.
    return INVALID_JSON_SNAPSHOT;
  }
}

function snapshotArray(
  value: unknown[],
  frame: SnapshotVisitFrame,
  stack: SnapshotFrame[],
  activeAncestors: Set<object>,
  addSerializedBytes: (amount: number) => boolean,
  assign: (frame: SnapshotVisitFrame, canonical: BoundedJsonValue) => void,
): boolean {
  const ownKeys = Reflect.ownKeys(value);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > JSON_VALUE_MAX_NODES ||
    ownKeys.some((key) => typeof key === "symbol") ||
    ownKeys.length !== length + 1 ||
    !ownKeys.includes("length") ||
    !addSerializedBytes(2 + Math.max(0, length - 1))
  ) {
    return false;
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return false;
    values.push(descriptor.value);
  }

  const canonical: BoundedJsonValue[] = new Array(length);
  assign(frame, canonical);
  activeAncestors.add(value);
  stack.push({ kind: "exit", value });
  for (let index = values.length - 1; index >= 0; index--) {
    stack.push({
      kind: "visit",
      value: values[index],
      depth: frame.depth + 1,
      parent: canonical,
      key: index,
    });
  }
  return true;
}

function snapshotObject(
  value: object,
  frame: SnapshotVisitFrame,
  stack: SnapshotFrame[],
  activeAncestors: Set<object>,
  addSerializedBytes: (amount: number) => boolean,
  assign: (frame: SnapshotVisitFrame, canonical: BoundedJsonValue) => void,
): boolean {
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > JSON_VALUE_MAX_NODES ||
    ownKeys.some((key) => typeof key === "symbol") ||
    !addSerializedBytes(2 + Math.max(0, ownKeys.length - 1))
  ) {
    return false;
  }

  const values: unknown[] = [];
  for (const key of ownKeys as string[]) {
    if (utf8LengthWithin(key, JSON_VALUE_MAX_KEY_BYTES) === undefined) return false;
    const keyBytes = serializedByteLength(key);
    if (keyBytes === undefined || !addSerializedBytes(keyBytes + 1)) return false;

    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return false;
    values.push(descriptor.value);
  }

  const canonical: { [key: string]: BoundedJsonValue } = {};
  assign(frame, canonical);
  activeAncestors.add(value);
  stack.push({ kind: "exit", value });
  for (let index = values.length - 1; index >= 0; index--) {
    stack.push({
      kind: "visit",
      value: values[index],
      depth: frame.depth + 1,
      parent: canonical,
      key: ownKeys[index] as string,
    });
  }
  return true;
}

function defineOwnDataProperty(
  target: { [key: string]: BoundedJsonValue },
  key: string,
  value: BoundedJsonValue,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
