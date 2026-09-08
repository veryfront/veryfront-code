import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const hasOwn = Object.hasOwn;

/** Map private arrays without consulting caller-visible methods or array species. */
export function mapPrivateArray<T, U>(
  values: readonly T[],
  mapper: (value: T, index: number, values: readonly T[]) => U,
): U[] {
  const length = values.length;
  const output: U[] = [];
  output.length = length;
  for (let index = 0; index < length; index++) {
    if (!hasOwn(values, index)) continue;
    defineOwnDataProperty(output, index, mapper(values[index]!, index, values), {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}
