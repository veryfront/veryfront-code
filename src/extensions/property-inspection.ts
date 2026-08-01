/** Bounded, descriptor-only inspection for extension contract implementations. */

const MAX_EXTENSION_PROTOTYPE_DEPTH = 32;
const apply = Reflect.apply;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const isWellFormedString = String.prototype.isWellFormed;
const normalizeString = String.prototype.normalize;
const trimString = String.prototype.trim;
const executeRegularExpression = RegExp.prototype.exec;
const addToSet = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const CONTROL_OR_LINE_SEPARATOR_PATTERN = /[\p{Cc}\u2028\u2029]/u;

/** Captured invocation intrinsic for extension methods. */
export const applyExtensionMethod: typeof Reflect.apply = apply;

/** Captured freeze intrinsic for immutable contract snapshots. */
export const freezeExtensionContract: typeof Object.freeze = freeze;

/** Captured array brand check for extension-boundary values. */
export const isExtensionArray: typeof Array.isArray = isArray;

/** Read one own descriptor through the captured inspection intrinsic. */
export function getExtensionOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return getOwnPropertyDescriptor(value, property);
}

/** Return whether a descriptor owns a data value without walking its prototype. */
export function isDataPropertyDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined && hasOwn(descriptor, "value");
}

/** Validate the canonical, bounded identity shared by asset engine contracts. */
export function isStableExtensionCacheIdentity(
  value: unknown,
  maxCharacters: number,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxCharacters &&
    apply(isWellFormedString, value, []) &&
    apply(trimString, value, []) === value &&
    apply(normalizeString, value, ["NFC"]) === value &&
    apply(executeRegularExpression, CONTROL_OR_LINE_SEPARATOR_PATTERN, [value]) === null;
}

/**
 * Find a property without invoking accessors or trusting a hostile prototype
 * chain. Cycles and implausibly deep chains fail closed.
 */
export function findExtensionPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new SetConstructor<object>();
  let owner: object | null = value;
  let depth = 0;

  while (owner !== null) {
    if (
      depth >= MAX_EXTENSION_PROTOTYPE_DEPTH ||
      apply(setHas, visited, [owner])
    ) {
      throw new TypeError("Extension implementation has an invalid prototype chain");
    }
    apply(addToSet, visited, [owner]);
    const descriptor = getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) return descriptor;
    owner = getPrototypeOf(owner);
    depth++;
  }

  return undefined;
}
