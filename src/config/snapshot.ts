/**
 * Creates bounded, immutable plain-data snapshots at configuration trust
 * boundaries.
 *
 * Traversal uses property descriptors exclusively. Accessor properties are
 * rejected without invoking their getters, and object prototypes are never
 * inherited by the returned snapshot.
 *
 * @module
 */

const IntrinsicArray = Array;
const IntrinsicWeakSet = WeakSet;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const ArrayPrototypeSort = Array.prototype.sort;
const JSONStringify = JSON.stringify;
const MathMax = Math.max;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;

const ARRAY_OR_OBJECT_BYTES = 2;
const ARRAY_ITEM_SEPARATOR_BYTES = 1;
const JSON_NUMBER_MAX_BYTES = 24;
const JSON_STRING_DELIMITER_BYTES = 2;
const JSON_STRING_MAX_BYTES_PER_CODE_UNIT = 6;
const OBJECT_PROPERTY_SEPARATOR_BYTES = 2;

/**
 * Resource limits for a canonical configuration snapshot.
 *
 * `maxEstimatedBytes` is a conservative upper bound for UTF-8 JSON output:
 * every string code unit is charged at the longest JSON escape length.
 */
export interface ConfigSnapshotLimits {
  readonly maxDepth: number;
  readonly maxTotalNodes: number;
  readonly maxTotalProperties: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxKeyLength: number;
  readonly maxStringLength: number;
  readonly maxEstimatedBytes: number;
}

/** Fixed limits applied to every configuration snapshot. */
export const CONFIG_SNAPSHOT_LIMITS: Readonly<ConfigSnapshotLimits> = ObjectFreeze({
  maxDepth: 32,
  maxTotalNodes: 12_288,
  maxTotalProperties: 16_384,
  maxArrayLength: 2_048,
  maxObjectKeys: 1_024,
  maxKeyLength: 1_024,
  maxStringLength: 65_536,
  maxEstimatedBytes: 1_048_576,
});

/** Primitive values supported by a configuration snapshot. */
export type ConfigSnapshotPrimitive = null | boolean | number | string;

/** A deeply immutable, null-prototype configuration record. */
export interface ConfigSnapshotRecord {
  readonly [key: string]: ConfigSnapshotValue;
}

/** A value accepted and returned by {@link canonicalizeConfigSnapshot}. */
export type ConfigSnapshotValue =
  | ConfigSnapshotPrimitive
  | ConfigSnapshotRecord
  | readonly ConfigSnapshotValue[];

/** Stable machine-readable reasons for snapshot rejection. */
export type ConfigSnapshotErrorCode =
  | "accessor-property"
  | "dangerous-key"
  | "duplicate-reference"
  | "inspection-failed"
  | "invalid-array-shape"
  | "invalid-prototype"
  | "max-array-length-exceeded"
  | "max-depth-exceeded"
  | "max-estimated-bytes-exceeded"
  | "max-key-length-exceeded"
  | "max-nodes-exceeded"
  | "max-object-keys-exceeded"
  | "max-properties-exceeded"
  | "max-string-length-exceeded"
  | "non-enumerable-property"
  | "non-finite-number"
  | "symbol-key"
  | "unsupported-type";

/** Error raised when a value cannot be represented as a safe snapshot. */
export class ConfigSnapshotError extends TypeError {
  readonly code: ConfigSnapshotErrorCode;
  readonly path: string;

  constructor(code: ConfigSnapshotErrorCode, path: string, reason: string) {
    super(`Invalid configuration snapshot at ${path}: ${reason}`);
    this.name = "ConfigSnapshotError";
    this.code = code;
    this.path = path;
  }
}

interface SnapshotState {
  readonly seen: WeakSet<object>;
  nodeCount: number;
  propertyCount: number;
  estimatedBytes: number;
}

function reject(
  code: ConfigSnapshotErrorCode,
  path: string,
  reason: string,
): never {
  throw new ConfigSnapshotError(code, path, reason);
}

function addNode(state: SnapshotState, path: string): void {
  state.nodeCount += 1;
  if (state.nodeCount > CONFIG_SNAPSHOT_LIMITS.maxTotalNodes) {
    reject(
      "max-nodes-exceeded",
      path,
      `value count exceeds ${CONFIG_SNAPSHOT_LIMITS.maxTotalNodes}`,
    );
  }
}

function addProperties(state: SnapshotState, count: number, path: string): void {
  if (count > CONFIG_SNAPSHOT_LIMITS.maxTotalProperties - state.propertyCount) {
    reject(
      "max-properties-exceeded",
      path,
      `property count exceeds ${CONFIG_SNAPSHOT_LIMITS.maxTotalProperties}`,
    );
  }
  state.propertyCount += count;
}

function addEstimatedBytes(state: SnapshotState, count: number, path: string): void {
  if (count > CONFIG_SNAPSHOT_LIMITS.maxEstimatedBytes - state.estimatedBytes) {
    reject(
      "max-estimated-bytes-exceeded",
      path,
      `estimated serialized size exceeds ${CONFIG_SNAPSHOT_LIMITS.maxEstimatedBytes} bytes`,
    );
  }
  state.estimatedBytes += count;
}

function estimateJsonStringBytes(length: number): number {
  return JSON_STRING_DELIMITER_BYTES + length * JSON_STRING_MAX_BYTES_PER_CODE_UNIT;
}

function childPath(path: string, key: string): string {
  return `${path}[${JSONStringify(key)}]`;
}

function arrayChildPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function inspectPrototype(value: object, path: string): object | null {
  try {
    return ObjectGetPrototypeOf(value);
  } catch {
    return reject("inspection-failed", path, "prototype inspection failed");
  }
}

function inspectIsArray(value: object, path: string): value is unknown[] {
  try {
    return ArrayIsArray(value);
  } catch {
    return reject("inspection-failed", path, "array inspection failed");
  }
}

function inspectOwnKeys(value: object, path: string): PropertyKey[] {
  try {
    return ReflectOwnKeys(value);
  } catch {
    return reject("inspection-failed", path, "property-key inspection failed");
  }
}

function inspectDescriptor(
  value: object,
  key: PropertyKey,
  path: string,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  } catch {
    return reject("inspection-failed", path, "property descriptor inspection failed");
  }

  if (descriptor === undefined) {
    return reject("inspection-failed", path, "property changed during inspection");
  }
  return descriptor;
}

function hasDescriptorValue(descriptor: PropertyDescriptor): boolean {
  return ReflectApply(
    ObjectPrototypeHasOwnProperty,
    descriptor,
    ["value"],
  ) as boolean;
}

function descriptorValue(descriptor: PropertyDescriptor, path: string): unknown {
  if (!hasDescriptorValue(descriptor)) {
    return reject("accessor-property", path, "accessor properties are not allowed");
  }
  if (!descriptor.enumerable) {
    return reject(
      "non-enumerable-property",
      path,
      "non-enumerable properties are not allowed",
    );
  }
  return descriptor.value;
}

function hasSeen(state: SnapshotState, value: object): boolean {
  return ReflectApply(WeakSetPrototypeHas, state.seen, [value]) as boolean;
}

function markSeen(state: SnapshotState, value: object): void {
  ReflectApply(WeakSetPrototypeAdd, state.seen, [value]);
}

function toArrayIndex(key: string): number | null {
  if (key === "") return null;
  const value = +key;
  return NumberIsSafeInteger(value) &&
      value >= 0 &&
      value <= 4_294_967_294 &&
      `${value}` === key
    ? value
    : null;
}

function compareCanonicalKeys(left: string, right: string): number {
  const leftIndex = toArrayIndex(left);
  const rightIndex = toArrayIndex(right);
  if (leftIndex !== null && rightIndex !== null) return leftIndex - rightIndex;
  if (leftIndex !== null) return -1;
  if (rightIndex !== null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable: boolean,
  writable: boolean,
  configurable: boolean,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = enumerable;
  descriptor.writable = writable;
  descriptor.configurable = configurable;
  ObjectDefineProperty(target, key, descriptor);
}

function canonicalizeArray(
  value: unknown[],
  path: string,
  depth: number,
  state: SnapshotState,
): readonly ConfigSnapshotValue[] {
  if (inspectPrototype(value, path) !== ArrayPrototype) {
    return reject("invalid-prototype", path, "array subclasses are not allowed");
  }

  const lengthDescriptor = inspectDescriptor(value, "length", path);
  if (!hasDescriptorValue(lengthDescriptor)) {
    return reject("invalid-array-shape", path, "array length is invalid");
  }
  const lengthValue = lengthDescriptor.value;
  if (
    typeof lengthValue !== "number" ||
    !NumberIsSafeInteger(lengthValue) ||
    lengthValue < 0
  ) {
    return reject("invalid-array-shape", path, "array length is invalid");
  }
  if (lengthValue > CONFIG_SNAPSHOT_LIMITS.maxArrayLength) {
    return reject(
      "max-array-length-exceeded",
      path,
      `array length exceeds ${CONFIG_SNAPSHOT_LIMITS.maxArrayLength}`,
    );
  }

  addProperties(state, lengthValue, path);
  addEstimatedBytes(
    state,
    ARRAY_OR_OBJECT_BYTES + MathMax(0, lengthValue - 1) * ARRAY_ITEM_SEPARATOR_BYTES,
    path,
  );

  const keys = inspectOwnKeys(value, path);
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] === "symbol") {
      return reject("symbol-key", path, "symbol properties are not allowed");
    }
  }

  if (keys.length !== lengthValue + 1) {
    return reject(
      "invalid-array-shape",
      path,
      "arrays must be dense and cannot have extra own properties",
    );
  }

  const output = new IntrinsicArray<ConfigSnapshotValue>(lengthValue);
  for (let index = 0; index < lengthValue; index += 1) {
    const indexPath = arrayChildPath(path, index);
    if (keys[index] !== `${index}`) {
      return reject(
        "invalid-array-shape",
        indexPath,
        "arrays must be dense and cannot have extra own properties",
      );
    }

    const descriptor = inspectDescriptor(value, `${index}`, indexPath);
    const child = canonicalizeValue(
      descriptorValue(descriptor, indexPath),
      indexPath,
      depth + 1,
      state,
    );
    defineDataProperty(output, index, child, true, true, true);
  }

  if (keys[lengthValue] !== "length") {
    return reject("invalid-array-shape", path, "array length metadata is invalid");
  }
  return ObjectFreeze(output);
}

function canonicalizeRecord(
  value: object,
  path: string,
  depth: number,
  state: SnapshotState,
): ConfigSnapshotRecord {
  const prototype = inspectPrototype(value, path);
  if (prototype !== null && prototype !== ObjectPrototype) {
    return reject(
      "invalid-prototype",
      path,
      "only plain or null-prototype records are allowed",
    );
  }

  const ownKeys = inspectOwnKeys(value, path);
  if (ownKeys.length > CONFIG_SNAPSHOT_LIMITS.maxObjectKeys) {
    return reject(
      "max-object-keys-exceeded",
      path,
      `object key count exceeds ${CONFIG_SNAPSHOT_LIMITS.maxObjectKeys}`,
    );
  }

  addProperties(state, ownKeys.length, path);
  addEstimatedBytes(
    state,
    ARRAY_OR_OBJECT_BYTES +
      MathMax(0, ownKeys.length - 1) * OBJECT_PROPERTY_SEPARATOR_BYTES,
    path,
  );

  const keys = new IntrinsicArray<string>(ownKeys.length);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") {
      return reject("symbol-key", path, "symbol properties are not allowed");
    }
    if (key.length > CONFIG_SNAPSHOT_LIMITS.maxKeyLength) {
      return reject(
        "max-key-length-exceeded",
        path,
        `object key length exceeds ${CONFIG_SNAPSHOT_LIMITS.maxKeyLength}`,
      );
    }
    if (isDangerousKey(key)) {
      return reject(
        "dangerous-key",
        childPath(path, key),
        `property name ${JSONStringify(key)} is not allowed`,
      );
    }

    addEstimatedBytes(
      state,
      estimateJsonStringBytes(key.length) + OBJECT_PROPERTY_SEPARATOR_BYTES,
      path,
    );
    defineDataProperty(keys, index, key, true, true, true);
  }
  ReflectApply(ArrayPrototypeSort, keys, [compareCanonicalKeys]);

  const output = ObjectCreate(null) as Record<string, ConfigSnapshotValue>;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const keyPath = childPath(path, key);
    const descriptor = inspectDescriptor(value, key, keyPath);
    const child = canonicalizeValue(
      descriptorValue(descriptor, keyPath),
      keyPath,
      depth + 1,
      state,
    );
    defineDataProperty(output, key, child, true, false, false);
  }
  return ObjectFreeze(output);
}

function canonicalizeValue(
  value: unknown,
  path: string,
  depth: number,
  state: SnapshotState,
): ConfigSnapshotValue {
  if (depth > CONFIG_SNAPSHOT_LIMITS.maxDepth) {
    return reject(
      "max-depth-exceeded",
      path,
      `nesting depth exceeds ${CONFIG_SNAPSHOT_LIMITS.maxDepth}`,
    );
  }
  addNode(state, path);

  if (value === null) {
    addEstimatedBytes(state, 4, path);
    return null;
  }

  switch (typeof value) {
    case "boolean":
      addEstimatedBytes(state, 5, path);
      return value;
    case "number":
      if (!NumberIsFinite(value)) {
        return reject("non-finite-number", path, "numbers must be finite");
      }
      addEstimatedBytes(state, JSON_NUMBER_MAX_BYTES, path);
      return value;
    case "string":
      if (value.length > CONFIG_SNAPSHOT_LIMITS.maxStringLength) {
        return reject(
          "max-string-length-exceeded",
          path,
          `string length exceeds ${CONFIG_SNAPSHOT_LIMITS.maxStringLength}`,
        );
      }
      addEstimatedBytes(state, estimateJsonStringBytes(value.length), path);
      return value;
    case "object":
      if (hasSeen(state, value)) {
        return reject(
          "duplicate-reference",
          path,
          "cycles and shared object references are not allowed",
        );
      }
      markSeen(state, value);
      return inspectIsArray(value, path)
        ? canonicalizeArray(value, path, depth, state)
        : canonicalizeRecord(value, path, depth, state);
    default:
      return reject(
        "unsupported-type",
        path,
        `${typeof value} values are not allowed`,
      );
  }
}

/**
 * Returns a detached, deeply frozen configuration snapshot.
 *
 * Records are rebuilt with null prototypes and canonical ECMAScript own-key
 * order: integer indices numerically, followed by other keys lexicographically.
 * Arrays retain the intrinsic array prototype for existing collection, JSON,
 * and structured-clone consumers, but their own state is rebuilt densely and
 * deeply frozen.
 *
 * Actively hostile values should reach this function through a non-executable
 * decoding boundary such as JSON parsing. JavaScript cannot reliably identify
 * proxies, whose reflection traps can execute during any descriptor walk.
 *
 * @throws {ConfigSnapshotError} when the input is not bounded plain data.
 */
export function canonicalizeConfigSnapshot(value: unknown): ConfigSnapshotValue {
  return canonicalizeValue(value, "$", 0, {
    seen: new IntrinsicWeakSet<object>(),
    nodeCount: 0,
    propertyCount: 0,
    estimatedBytes: 0,
  });
}
