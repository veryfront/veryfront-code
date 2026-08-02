import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const MISSING_OWN_DATA_PROPERTY = Symbol("veryfront.missing-own-data-property");

export type OwnDataPropertyValue =
  | unknown
  | typeof MISSING_OWN_DATA_PROPERTY;

function invalidDataProperties(label: string): TypeError {
  return new TypeError(`${label} must contain only own data properties`);
}

function rejectProxy(value: object, label: string): void {
  if (isProxyWithoutHooks(value)) throw invalidDataProperties(label);
}

/** Read one own data property without invoking accessors or proxy getters. */
export function getOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
): OwnDataPropertyValue {
  rejectProxy(value, label);
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    throw invalidDataProperties(label);
  }
  if (descriptor === undefined) return MISSING_OWN_DATA_PROPERTY;
  if (!("value" in descriptor)) throw invalidDataProperties(label);
  return descriptor.value;
}

/** Check the sentinel returned when an own data property is absent. */
export function isMissingOwnDataProperty(
  value: OwnDataPropertyValue,
): value is typeof MISSING_OWN_DATA_PROPERTY {
  return value === MISSING_OWN_DATA_PROPERTY;
}

function ownKeys(value: object, label: string): PropertyKey[] {
  rejectProxy(value, label);
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw invalidDataProperties(label);
  }
}

/** Snapshot enumerable string-keyed entries without invoking caller code. */
export function getEnumerableOwnStringDataEntries(
  value: object,
  label: string,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key of ownKeys(value, label)) {
    if (typeof key !== "string") continue;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidDataProperties(label);
    }
    if (descriptor === undefined) throw invalidDataProperties(label);
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) throw invalidDataProperties(label);
    entries.push([key, descriptor.value]);
  }
  return entries;
}

/**
 * Copy enumerable own data properties, including symbols, into a plain object.
 *
 * Symbols are retained because the internal remote-tool provenance marker is
 * deliberately propagated through framework-owned host wrappers.
 */
export function snapshotEnumerableOwnDataObject<T extends object>(
  value: T,
  label: string,
): T {
  const snapshot = {};
  for (const key of ownKeys(value, label)) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidDataProperties(label);
    }
    if (descriptor === undefined) throw invalidDataProperties(label);
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) throw invalidDataProperties(label);
    Reflect.defineProperty(snapshot, key, {
      value: descriptor.value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return snapshot as T;
}
