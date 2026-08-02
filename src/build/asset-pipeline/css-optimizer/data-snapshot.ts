/** Descriptor-only snapshots for values accepted by CSS optimizer boundaries. */

const arrayIsArray = Array.isArray;
const apply = Reflect.apply;
const executeRegularExpression = RegExp.prototype.exec;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwn = Object.hasOwn;
const isSafeInteger = Number.isSafeInteger;
const ownKeys = Reflect.ownKeys;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;

function matches(pattern: RegExp, value: string): boolean {
  return apply(executeRegularExpression, pattern, [value]) !== null;
}

/** Brand-check an array without consulting its iterator or property getters. */
export function isArrayValue(value: unknown, label: string): value is unknown[] {
  try {
    return arrayIsArray(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
}

/** Capture every own descriptor without reading property values through accessors. */
export function inspectOwnProperties(
  value: object,
  label: string,
): PropertyDescriptorMap {
  try {
    return getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

/** Retrieve one descriptor from a trusted descriptor snapshot. */
export function inspectedProperty(
  values: PropertyDescriptorMap,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return getOwnPropertyDescriptor(values, key)?.value as
    | PropertyDescriptor
    | undefined;
}

/** Read a required own data property from a descriptor snapshot. */
export function readOwnDataProperty(
  values: PropertyDescriptorMap,
  key: string,
  label: string,
  enumerable?: boolean,
): unknown {
  const property = inspectedProperty(values, key);
  if (property === undefined) {
    throw new TypeError(`${label} must define ${key}`);
  }
  if (!hasOwn(property, "value")) {
    throw new TypeError(`${label} ${key} must be an own data property`);
  }
  if (enumerable !== undefined && property.enumerable !== enumerable) {
    throw new TypeError(
      `${label} ${key} must be ${
        enumerable ? "an enumerable" : "a non-enumerable"
      } own data property`,
    );
  }
  return property.value;
}

/** Reject symbol and string properties outside a boundary's explicit schema. */
export function rejectUnknownOwnProperties(
  values: PropertyDescriptorMap,
  allowed: readonly PropertyKey[],
  label: string,
): void {
  const keys = ownKeys(values);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!;
    let isAllowed = false;
    for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex++) {
      if (allowed[allowedIndex] === key) {
        isAllowed = true;
        break;
      }
    }
    if (!isAllowed) {
      throw new TypeError(`${label} contains unsupported properties`);
    }
  }
}

/**
 * Snapshot a bounded dense array using only own data descriptors. Custom
 * iterators, sparse indices, accessors, symbols, and expando properties fail
 * closed.
 */
export function snapshotDenseDataArray(
  value: unknown,
  maximum: number,
  label: string,
): unknown[] {
  if (!isArrayValue(value, label)) {
    throw new TypeError(`${label} must be an array`);
  }
  const values = inspectOwnProperties(value, label);
  const length = readOwnDataProperty(values, "length", label, false);
  if (
    !isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > maximum
  ) {
    throw new TypeError(`${label} exceeds ${maximum} entries`);
  }

  const keys = ownKeys(values);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (
      typeof key !== "string" ||
      (key !== "length" && !matches(ARRAY_INDEX_PATTERN, key))
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
  }

  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index++) {
    result[index] = readOwnDataProperty(
      values,
      String(index),
      label,
      true,
    );
  }
  if (keys.length !== (length as number) + 1) {
    throw new TypeError(`${label} must be a dense data-property array`);
  }
  return result;
}
