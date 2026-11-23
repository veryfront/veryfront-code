/**
 * Copy a trusted host tool definition without flattening its accessors.
 *
 * Trusted platform definitions may compute fields on read: load_skill
 * advertises its provider schema through an `inputSchemaJson` getter whose read
 * also refreshes reference authorization. Spreading or data-only copies
 * evaluate or drop that getter, so every wrapper of a trusted definition must
 * forward own accessors to the original on each read instead.
 *
 * Only call this for definitions with trusted host provenance: it never reads
 * an accessor while copying, but the copy's getters do run the originals.
 *
 * @module tool/host-tool-definition-copy
 */

import type { HostToolDefinition } from "./host-tools.ts";

const apply = Reflect.apply;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectOwnKeys = Reflect.ownKeys;

function defineOwn(
  target: HostToolDefinition,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  apply(objectDefineProperty, Object, [target, key, descriptor]);
}

/**
 * Copy own enumerable fields of `definition` onto `target`. Data fields are
 * copied as writable data (undefined values are skipped); getters become
 * getters that call the original with `definition` as the receiver.
 */
export function copyTrustedHostToolDefinition(
  target: HostToolDefinition,
  definition: HostToolDefinition,
): HostToolDefinition {
  const keys = apply(reflectOwnKeys, Reflect, [definition]) as PropertyKey[];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const source = apply(objectGetOwnPropertyDescriptor, Object, [definition, key]) as
      | PropertyDescriptor
      | undefined;
    if (source === undefined || source.enumerable !== true) continue;
    const descriptor = objectCreate(null) as PropertyDescriptor;
    descriptor.configurable = true;
    descriptor.enumerable = true;
    if (objectHasOwn(source, "value")) {
      if (source.value === undefined) continue;
      descriptor.writable = true;
      descriptor.value = source.value;
    } else {
      const getter = source.get;
      if (typeof getter !== "function") continue;
      descriptor.get = () => apply(getter, definition, []);
    }
    defineOwn(target, key, descriptor);
  }
  return target;
}
