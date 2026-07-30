/** Bounded, descriptor-only inspection for extension contract implementations. */

const MAX_EXTENSION_PROTOTYPE_DEPTH = 32;

/**
 * Find a property without invoking accessors or trusting a hostile prototype
 * chain. Cycles and implausibly deep chains fail closed.
 */
export function findExtensionPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new Set<object>();
  let owner: object | null = value;
  let depth = 0;

  while (owner !== null) {
    if (
      depth >= MAX_EXTENSION_PROTOTYPE_DEPTH ||
      visited.has(owner)
    ) {
      throw new TypeError("Extension implementation has an invalid prototype chain");
    }
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner);
    depth++;
  }

  return undefined;
}
