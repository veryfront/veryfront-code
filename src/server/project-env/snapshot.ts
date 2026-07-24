/**
 * Bounded, immutable project-environment snapshots.
 *
 * Environment values cross an authenticated API boundary before they are
 * exposed to config evaluation and isolated project workers. Keep the shape
 * deliberately narrower than a generic JavaScript record: enumerable string
 * data properties only, with no inherited state or accessors.
 *
 * @module server/project-env/snapshot
 */

import {
  PROJECT_ENV_SNAPSHOT_LIMITS,
  type ProjectEnvSnapshot,
} from "#veryfront/platform/compat/process/project-env-contract.ts";

export {
  PROJECT_ENV_SNAPSHOT_LIMITS,
  type ProjectEnvSnapshot,
} from "#veryfront/platform/compat/process/project-env-contract.ts";

const IntrinsicArray = Array;
const ArrayIsArray = Array.isArray;
const ArrayPrototypeSort = Array.prototype.sort;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const NumberIsSafeInteger = Number.isSafeInteger;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const intrinsicTextEncoder = new TextEncoder();
const typedArrayPrototype = ObjectGetPrototypeOf(Uint8Array.prototype);
const maybeTypedArrayByteLengthGetter = typedArrayPrototype
  ? ObjectGetOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get
  : undefined;

if (!maybeTypedArrayByteLengthGetter) {
  throw new TypeError("Typed-array byte-length intrinsic is unavailable");
}
const typedArrayByteLengthGetter = maybeTypedArrayByteLengthGetter as () => number;

/** Stable rejection reasons for project-environment boundary failures. */
export type ProjectEnvSnapshotErrorCode =
  | "accessor-property"
  | "duplicate-key"
  | "inspection-failed"
  | "invalid-key"
  | "invalid-prototype"
  | "invalid-value"
  | "max-entries-exceeded"
  | "max-key-length-exceeded"
  | "max-total-bytes-exceeded"
  | "max-value-length-exceeded"
  | "non-enumerable-property"
  | "symbol-key";

/** Error raised when an environment value is unsafe or exceeds its budget. */
export class ProjectEnvSnapshotError extends TypeError {
  readonly code: ProjectEnvSnapshotErrorCode;

  constructor(code: ProjectEnvSnapshotErrorCode, reason: string) {
    super(`Invalid project environment snapshot: ${reason}`);
    this.name = "ProjectEnvSnapshotError";
    this.code = code;
  }
}

function reject(code: ProjectEnvSnapshotErrorCode, reason: string): never {
  throw new ProjectEnvSnapshotError(code, reason);
}

function inspectPrototype(value: object): object | null {
  try {
    return ObjectGetPrototypeOf(value);
  } catch {
    return reject("inspection-failed", "prototype inspection failed");
  }
}

function inspectIsArray(value: object): boolean {
  try {
    return ArrayIsArray(value);
  } catch {
    return reject("inspection-failed", "array inspection failed");
  }
}

function inspectKeys(value: object): PropertyKey[] {
  try {
    return ReflectOwnKeys(value);
  } catch {
    return reject("inspection-failed", "property-key inspection failed");
  }
}

function inspectDescriptor(value: object, key: string): PropertyDescriptor {
  try {
    const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
    if (descriptor) return descriptor;
  } catch {
    // Fall through to the stable boundary error below.
  }
  return reject("inspection-failed", "property descriptor inspection failed");
}

function compareStrings(left: string, right: string): number {
  const leftIndex = toArrayIndex(left);
  const rightIndex = toArrayIndex(right);
  if (leftIndex !== null && rightIndex !== null) return leftIndex - rightIndex;
  if (leftIndex !== null) return -1;
  if (rightIndex !== null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
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

function isValidEnvironmentKey(key: string): boolean {
  if (key.length === 0) return false;
  for (let index = 0; index < key.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, key, [index]) as number;
    if (code === 0 || code === 61) return false;
  }
  return true;
}

function isValidEnvironmentValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if ((ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number) === 0) {
      return false;
    }
  }
  return true;
}

function utf8Length(value: string): number {
  const encoded = ReflectApply(
    TextEncoderPrototypeEncode,
    intrinsicTextEncoder,
    [value],
  ) as Uint8Array;
  return ReflectApply(typedArrayByteLengthGetter, encoded, []) as number;
}

function hasDescriptorValue(descriptor: PropertyDescriptor): boolean {
  return ReflectApply(
    ObjectPrototypeHasOwnProperty,
    descriptor,
    ["value"],
  ) as boolean;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
  writable = false,
  configurable = false,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = true;
  descriptor.configurable = configurable;
  descriptor.writable = writable;
  ObjectDefineProperty(target, key, descriptor);
}

/**
 * Copy a project environment into a sorted, frozen, null-prototype record.
 *
 * Property descriptors are inspected without reading property values through
 * ordinary access, so getters are rejected without invocation.
 */
export function createProjectEnvSnapshot(
  value: unknown,
): ProjectEnvSnapshot {
  if (typeof value !== "object" || value === null || inspectIsArray(value)) {
    return reject("invalid-prototype", "expected a plain data record");
  }

  const prototype = inspectPrototype(value);
  if (prototype !== null && prototype !== ObjectPrototype) {
    return reject("invalid-prototype", "expected a plain or null-prototype record");
  }

  const ownKeys = inspectKeys(value);
  if (ownKeys.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries) {
    return reject(
      "max-entries-exceeded",
      `entry count exceeds ${PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries}`,
    );
  }

  const keys = new IntrinsicArray<string>(ownKeys.length);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") {
      return reject("symbol-key", "symbol properties are not allowed");
    }
    if (key.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars) {
      return reject(
        "max-key-length-exceeded",
        `key length exceeds ${PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars}`,
      );
    }
    if (!isValidEnvironmentKey(key)) {
      return reject("invalid-key", "keys must be non-empty and cannot contain NUL or '='");
    }
    defineDataProperty(keys, index, key, true, true);
  }
  ReflectApply(ArrayPrototypeSort, keys, [compareStrings]);

  const output = ObjectCreate(null) as Record<string, string>;
  let totalBytes = 0;
  let previousKey: string | undefined;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key === previousKey) {
      return reject("duplicate-key", "duplicate keys are not allowed");
    }
    previousKey = key;

    const descriptor = inspectDescriptor(value, key);
    if (!hasDescriptorValue(descriptor)) {
      return reject("accessor-property", "accessor properties are not allowed");
    }
    if (!descriptor.enumerable) {
      return reject("non-enumerable-property", "non-enumerable properties are not allowed");
    }
    const descriptorValue = descriptor.value;
    if (typeof descriptorValue !== "string") {
      return reject("invalid-value", "values must be strings without NUL characters");
    }
    if (descriptorValue.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars) {
      return reject(
        "max-value-length-exceeded",
        `value length exceeds ${PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars}`,
      );
    }
    if (!isValidEnvironmentValue(descriptorValue)) {
      return reject("invalid-value", "values must be strings without NUL characters");
    }

    totalBytes += utf8Length(key) + utf8Length(descriptorValue);
    if (totalBytes > PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes) {
      return reject(
        "max-total-bytes-exceeded",
        `UTF-8 size exceeds ${PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes} bytes`,
      );
    }

    defineDataProperty(output, key, descriptorValue);
  }

  return ObjectFreeze(output);
}
