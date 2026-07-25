const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Read an own data property without invoking project-owned accessors. Missing,
 * inherited, accessor-backed, revoked, and throwing-descriptor values are
 * treated as absent. JavaScript cannot distinguish a transparent Proxy from
 * its target, so a non-throwing Proxy is governed by the descriptor it reports.
 */
export function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  try {
    const descriptor = apply(getOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (
      !descriptor ||
      !apply(objectPrototypeHasOwnProperty, descriptor, ["value"])
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

/**
 * Local-project privileges require an explicit own boolean data property.
 * Every ambiguous runtime value fails closed.
 */
export function isExplicitlyLocalProject(value: unknown): boolean {
  return readOwnDataProperty(value, "isLocalProject") === true;
}
