export type OwnDataProperty =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Read data at a trust boundary without invoking getters or inherited state.
 */
export function readOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): OwnDataProperty {
  if (value === null || typeof value !== "object") return { found: false };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? { found: true, value: descriptor.value }
      : { found: false };
  } catch {
    return { found: false };
  }
}
