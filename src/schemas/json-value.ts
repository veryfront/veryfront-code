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
const NativeSet = Set;
const OBJECT_PROTOTYPE = Object.prototype;
const arrayIsArray = Array.isArray;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setHas = Set.prototype.has;
const textEncoderEncode = TextEncoder.prototype.encode;

export type BoundedJsonValue =
  | string
  | number
  | boolean
  | null
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

export type BoundedJsonPathSegment = string | number;

export type BoundedJsonSnapshot =
  | { success: true; value: BoundedJsonValue }
  | { success: false; path: readonly BoundedJsonPathSegment[] };

type CanonicalJsonContainer =
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

interface SnapshotPathNode {
  parent: SnapshotPathNode | undefined;
  segment: BoundedJsonPathSegment;
}

interface InvalidSnapshotPath {
  path: SnapshotPathNode | undefined;
}

type SnapshotFrame =
  | {
    kind: "visit";
    value: unknown;
    depth: number;
    parent?: CanonicalJsonContainer;
    key?: string | number;
    path: SnapshotPathNode | undefined;
  }
  | { kind: "exit"; value: object };

type SnapshotVisitFrame = Extract<SnapshotFrame, { kind: "visit" }>;

function appendSnapshotPath(
  parent: SnapshotPathNode | undefined,
  segment: BoundedJsonPathSegment,
): SnapshotPathNode {
  return { parent, segment };
}

function invalidSnapshotPath(path: SnapshotPathNode | undefined): InvalidSnapshotPath {
  return { path };
}

function invalidJsonSnapshot(
  path: SnapshotPathNode | undefined,
): BoundedJsonSnapshot {
  let segmentCount = 0;
  for (let current = path; current !== undefined; current = current.parent) {
    segmentCount += 1;
  }
  const segments: BoundedJsonPathSegment[] = [];
  segments.length = segmentCount;
  let index = segmentCount - 1;
  for (let current = path; current !== undefined; current = current.parent) {
    segments[index] = current.segment;
    index -= 1;
  }
  return { success: false, path: segments };
}

function utf8LengthWithin(value: string, limit: number): number | undefined {
  if (value.length > limit) return undefined;
  const byteLength = (reflectApply(textEncoderEncode, JSON_UTF8_ENCODER, [value]) as Uint8Array)
    .byteLength;
  return byteLength <= limit ? byteLength : undefined;
}

function serializedByteLength(value: string | number | boolean | null): number | undefined {
  const serialized = jsonStringify(value);
  return serialized === undefined
    ? undefined
    : (reflectApply(textEncoderEncode, JSON_UTF8_ENCODER, [serialized]) as Uint8Array).byteLength;
}

/**
 * Creates a bounded, data-only snapshot of an unknown JSON value.
 *
 * The walk is iterative and rejects cycles, accessors, plain-object
 * prototypes other than `Object.prototype` or `null`, non-JSON properties,
 * and inputs above the documented depth, node, string, key, and
 * serialized-size limits. Only property descriptor values captured during
 * this walk are copied, so a stateful Proxy cannot change the value between
 * validation and later consumption. Rejections include the path to the
 * narrowest invalid value that could be identified without invoking caller
 * code.
 */
export function snapshotBoundedJsonValue(value: unknown): BoundedJsonSnapshot {
  let activePath: SnapshotPathNode | undefined;
  try {
    const activeAncestors = new NativeSet<object>();
    const stack: SnapshotFrame[] = [{
      kind: "visit",
      value,
      depth: 0,
      path: undefined,
    }];
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
      if (arrayIsArray(frame.parent)) {
        frame.parent[frame.key as number] = canonical;
        return;
      }
      defineOwnDataProperty(frame.parent, frame.key as string, canonical);
    };

    while (stack.length > 0) {
      const frame = stack.length === 0 ? undefined : stack[stack.length - 1];
      if (!frame) break;
      stack.length -= 1;
      if (frame.kind === "exit") {
        reflectApply(setDelete, activeAncestors, [frame.value]);
        continue;
      }
      activePath = frame.path;

      if (frame.depth > JSON_VALUE_MAX_DEPTH || ++nodeCount > JSON_VALUE_MAX_NODES) {
        return invalidJsonSnapshot(frame.path);
      }

      const current = frame.value;
      if (current === null || typeof current === "boolean") {
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) {
          return invalidJsonSnapshot(frame.path);
        }
        assign(frame, current);
        continue;
      }
      if (typeof current === "string") {
        if (utf8LengthWithin(current, JSON_VALUE_MAX_STRING_BYTES) === undefined) {
          return invalidJsonSnapshot(frame.path);
        }
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) {
          return invalidJsonSnapshot(frame.path);
        }
        assign(frame, current);
        continue;
      }
      if (typeof current === "number") {
        if (!numberIsFinite(current)) return invalidJsonSnapshot(frame.path);
        const bytes = serializedByteLength(current);
        if (bytes === undefined || !addSerializedBytes(bytes)) {
          return invalidJsonSnapshot(frame.path);
        }
        assign(frame, current);
        continue;
      }
      if (
        typeof current !== "object" ||
        reflectApply(setHas, activeAncestors, [current]) as boolean
      ) {
        return invalidJsonSnapshot(frame.path);
      }

      if (arrayIsArray(current)) {
        const invalidPath = snapshotArray(
          current,
          frame,
          stack,
          activeAncestors,
          addSerializedBytes,
          assign,
        );
        if (invalidPath !== null) return invalidJsonSnapshot(invalidPath.path);
        continue;
      }

      const invalidPath = snapshotObject(
        current,
        frame,
        stack,
        activeAncestors,
        addSerializedBytes,
        assign,
      );
      if (invalidPath !== null) return invalidJsonSnapshot(invalidPath.path);
    }

    return rootAssigned
      ? { success: true, value: canonicalRoot as BoundedJsonValue }
      : invalidJsonSnapshot(undefined);
  } catch {
    // Proxy traps and reflective operations can throw. Such values are not
    // data-only JSON inputs and must fail validation rather than escape it.
    return invalidJsonSnapshot(activePath);
  }
}

function snapshotArray(
  value: unknown[],
  frame: SnapshotVisitFrame,
  stack: SnapshotFrame[],
  activeAncestors: Set<object>,
  addSerializedBytes: (amount: number) => boolean,
  assign: (frame: SnapshotVisitFrame, canonical: BoundedJsonValue) => void,
): InvalidSnapshotPath | null {
  const ownKeys = reflectOwnKeys(value);
  const lengthDescriptor = reflectGetOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !numberIsSafeInteger(length) ||
    length < 0 ||
    length > JSON_VALUE_MAX_NODES ||
    hasSymbolKey(ownKeys) ||
    ownKeys.length !== length + 1 ||
    !hasStringKey(ownKeys, "length") ||
    !addSerializedBytes(2 + (length > 0 ? length - 1 : 0))
  ) {
    return invalidSnapshotPath(frame.path);
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = reflectGetOwnPropertyDescriptor(value, `${index}`);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return invalidSnapshotPath(appendSnapshotPath(frame.path, index));
    }
    values[values.length] = descriptor.value;
  }

  const canonical: BoundedJsonValue[] = [];
  canonical.length = length;
  assign(frame, canonical);
  reflectApply(setAdd, activeAncestors, [value]);
  stack[stack.length] = { kind: "exit", value };
  for (let index = values.length - 1; index >= 0; index--) {
    stack[stack.length] = {
      kind: "visit",
      value: values[index],
      depth: frame.depth + 1,
      parent: canonical,
      key: index,
      path: appendSnapshotPath(frame.path, index),
    };
  }
  return null;
}

function snapshotObject(
  value: object,
  frame: SnapshotVisitFrame,
  stack: SnapshotFrame[],
  activeAncestors: Set<object>,
  addSerializedBytes: (amount: number) => boolean,
  assign: (frame: SnapshotVisitFrame, canonical: BoundedJsonValue) => void,
): InvalidSnapshotPath | null {
  const prototype = reflectGetPrototypeOf(value);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    return invalidSnapshotPath(frame.path);
  }

  const ownKeys = reflectOwnKeys(value);
  if (
    ownKeys.length > JSON_VALUE_MAX_NODES ||
    hasSymbolKey(ownKeys) ||
    !addSerializedBytes(2 + (ownKeys.length > 0 ? ownKeys.length - 1 : 0))
  ) {
    return invalidSnapshotPath(frame.path);
  }

  const values: unknown[] = [];
  for (let index = 0; index < ownKeys.length; index++) {
    const key = ownKeys[index] as string;
    const childPath = appendSnapshotPath(frame.path, key);
    if (utf8LengthWithin(key, JSON_VALUE_MAX_KEY_BYTES) === undefined) {
      return invalidSnapshotPath(childPath);
    }
    const keyBytes = serializedByteLength(key);
    if (keyBytes === undefined || !addSerializedBytes(keyBytes + 1)) {
      return invalidSnapshotPath(childPath);
    }

    const descriptor = reflectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return invalidSnapshotPath(childPath);
    }
    values[values.length] = descriptor.value;
  }

  const canonical: { [key: string]: BoundedJsonValue } = {};
  assign(frame, canonical);
  reflectApply(setAdd, activeAncestors, [value]);
  stack[stack.length] = { kind: "exit", value };
  for (let index = values.length - 1; index >= 0; index--) {
    stack[stack.length] = {
      kind: "visit",
      value: values[index],
      depth: frame.depth + 1,
      parent: canonical,
      key: ownKeys[index] as string,
      path: appendSnapshotPath(frame.path, ownKeys[index] as string),
    };
  }
  return null;
}

function hasSymbolKey(keys: readonly PropertyKey[]): boolean {
  for (let index = 0; index < keys.length; index++) {
    if (typeof keys[index] === "symbol") return true;
  }
  return false;
}

function hasStringKey(keys: readonly PropertyKey[], expected: string): boolean {
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] === expected) return true;
  }
  return false;
}

function defineOwnDataProperty(
  target: { [key: string]: BoundedJsonValue },
  key: string,
  value: BoundedJsonValue,
): void {
  objectDefineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
