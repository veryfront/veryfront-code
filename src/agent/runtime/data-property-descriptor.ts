const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;

/** Return whether a reflected descriptor owns a data-property value. */
export function isOwnDataPropertyDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined &&
    (ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) as boolean);
}
