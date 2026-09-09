import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const objectCreate = Object.create;
const objectKeys = Object.keys;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const arrayIsArray = Array.isArray;

export function snapshotOwnDataRecords(
  value: unknown,
  budget = { remaining: 100_000 },
  depth = 0,
): unknown {
  if (--budget.remaining < 0 || depth > 64) throw new Error("Invalid own-data record");
  if (value === null || typeof value !== "object") return value;
  const array = arrayIsArray(value);
  if (array && value.length > 100_000) throw new Error("Invalid own-data record");
  const result = array ? [] : objectCreate(null);
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
      throw new Error("Invalid data accessor");
    }
    defineOwnDataProperty(
      result,
      key,
      snapshotOwnDataRecords(descriptor.value, budget, depth + 1),
      {
        enumerable: true,
        configurable: true,
        writable: true,
      },
    );
  }
  if (array) result.length = value.length;
  return result;
}
