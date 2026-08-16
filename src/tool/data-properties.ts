import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectOwnKeys = Reflect.ownKeys;
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

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, value, [key]) as boolean;
}

function getOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
  label: string,
): PropertyDescriptor | undefined {
  try {
    return ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw invalidDataProperties(label);
  }
}

/** Read one own data property without invoking accessors or proxy getters. */
export function getOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
): OwnDataPropertyValue {
  rejectProxy(value, label);
  const descriptor = getOwnPropertyDescriptor(value, key, label);
  if (descriptor === undefined) return MISSING_OWN_DATA_PROPERTY;
  if (!hasOwn(descriptor, "value")) throw invalidDataProperties(label);
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
    return ReflectApply(ReflectOwnKeys, undefined, [value]) as PropertyKey[];
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
    const descriptor = getOwnPropertyDescriptor(value, key, label);
    if (descriptor === undefined) throw invalidDataProperties(label);
    if (!descriptor.enumerable) continue;
    if (!hasOwn(descriptor, "value")) throw invalidDataProperties(label);
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
    const descriptor = getOwnPropertyDescriptor(value, key, label);
    if (descriptor === undefined) throw invalidDataProperties(label);
    if (!descriptor.enumerable) continue;
    if (!hasOwn(descriptor, "value")) throw invalidDataProperties(label);
    const defined = ReflectApply(ReflectDefineProperty, undefined, [
      snapshot,
      key,
      {
        value: descriptor.value,
        writable: true,
        enumerable: true,
        configurable: true,
      },
    ]) as boolean;
    if (!defined) throw invalidDataProperties(label);
  }
  return snapshot as T;
}
