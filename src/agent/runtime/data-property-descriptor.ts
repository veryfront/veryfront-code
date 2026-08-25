import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;

/** Return whether a reflected descriptor owns a data-property value. */
export function isOwnDataPropertyDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined &&
    (ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) as boolean);
}

/** Read an own data property without invoking an accessor on the input object. */
export function readOwnDataProperty(
  input: unknown,
  key: PropertyKey,
  label: string,
  required = true,
): unknown {
  if (!input || typeof input !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  if (isProxyWithoutHooks(input)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      input,
      key,
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }

  if (descriptor === undefined) {
    if (required) {
      throw new TypeError(`${label}.${String(key)} must be a data property`);
    }
    return undefined;
  }
  if (!isOwnDataPropertyDescriptor(descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }
  return descriptor.value;
}

/**
 * Snapshot a bounded Array using only captured reflection intrinsics.
 *
 * The Array length and every indexed value must be own data properties. This
 * keeps accessors, inherited values, hostile `get` traps, and later mutation
 * outside the returned immutable snapshot.
 */
export function snapshotOwnDataPropertyArray<T>(
  input: unknown,
  options: {
    label: string;
    maximumEntries: number;
    mapValue: (value: unknown, index: number) => T;
  },
): readonly T[] {
  if (isProxyWithoutHooks(input)) {
    throw new TypeError(`${options.label} must not be a Proxy`);
  }
  let isArray = false;
  try {
    isArray = ArrayIsArray(input);
  } catch {
    throw new TypeError(`${options.label} must be an array`);
  }
  if (!isArray) {
    throw new TypeError(`${options.label} must be an array`);
  }

  const length = readOwnDataProperty(input, "length", options.label);
  if (!NumberIsSafeInteger(length) || (length as number) < 0) {
    throw new TypeError(`${options.label}.length must be a non-negative safe integer`);
  }
  if ((length as number) > options.maximumEntries) {
    throw new RangeError(
      `${options.label} may contain at most ${options.maximumEntries} entries`,
    );
  }

  const snapshot: T[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        input,
        index,
      ]) as PropertyDescriptor | undefined;
    } catch {
      throw new TypeError(`${options.label} entry ${index} must be a data property`);
    }
    if (!isOwnDataPropertyDescriptor(descriptor)) {
      throw new TypeError(`${options.label} entry ${index} must be a data property`);
    }
    const value = descriptor.value;
    ReflectApply(ArrayPrototypePush, snapshot, [options.mapValue(value, index)]);
  }
  return ObjectFreeze(snapshot);
}
