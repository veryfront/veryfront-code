const defineProperty = Object.defineProperty;
const hasOwn = Object.hasOwn;

/** Define own data without inherited descriptor accessors or target setters. */
export function defineOwnDataProperty<T extends object>(
  target: T,
  key: PropertyKey,
  value: unknown,
  attributes: Pick<PropertyDescriptor, "enumerable" | "configurable" | "writable"> = {},
): T {
  const descriptor = {
    __proto__: null,
    value,
    enumerable: hasOwn(attributes, "enumerable") && attributes.enumerable === true,
    configurable: hasOwn(attributes, "configurable") && attributes.configurable === true,
    writable: hasOwn(attributes, "writable") && attributes.writable === true,
  };
  return defineProperty(target, key, descriptor);
}
