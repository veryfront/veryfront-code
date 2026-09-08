import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const hasOwn = Object.hasOwn;
const isArray = Array.isArray;

/** Filter private arrays through own elements without consulting array species. */
export function filterPrivateArray<T, S extends T>(
  values: readonly T[],
  predicate: (value: T, index: number, values: readonly T[]) => value is S,
): S[];
export function filterPrivateArray<T>(
  values: readonly T[],
  predicate: (value: T, index: number, values: readonly T[]) => unknown,
): T[];
export function filterPrivateArray<T>(
  values: readonly T[],
  predicate: (value: T, index: number, values: readonly T[]) => unknown,
): T[] {
  const output: T[] = [];
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (!hasOwn(values, index)) continue;
    const value = values[index]!;
    if (predicate(value, index, values)) pushPrivateArray(output, value);
  }
  return output;
}

/** Map and flatten one level of private array elements without observable methods. */
export function flatMapPrivateArray<T, U>(
  values: readonly T[],
  mapper: (value: T, index: number, values: readonly T[]) => U | readonly U[],
): U[] {
  const output: U[] = [];
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (!hasOwn(values, index)) continue;
    const mapped = mapper(values[index]!, index, values);
    if (isArray(mapped)) {
      for (let inner = 0; inner < mapped.length; inner++) {
        if (hasOwn(mapped, inner)) pushPrivateArray(output, mapped[inner]!);
      }
    } else pushPrivateArray(output, mapped as U);
  }
  return output;
}

/** Join private strings without dispatching through a writable array method. */
export function joinPrivateArray(values: readonly (string | undefined)[], separator = ","): string {
  let output = "";
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (index > 0) output += separator;
    if (hasOwn(values, index)) output += values[index] ?? "";
  }
  return output;
}

/** Append one private value without looking up push or invoking inherited setters. */
export function pushPrivateArray<T>(values: T[], value: T): number {
  defineOwnDataProperty(values, values.length, value, {
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return values.length;
}

/** Append another private array without consulting its iterator or inherited entries. */
export function appendPrivateArray<T>(values: T[], items: readonly T[]): number {
  const offset = values.length;
  const length = items.length;
  values.length = offset + length;
  for (let index = 0; index < length; index++) {
    if (!hasOwn(items, index)) continue;
    defineOwnDataProperty(values, offset + index, items[index], {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return values.length;
}

/** Join private arrays through own indexed elements, preserving sparse positions. */
export function concatPrivateArrays<T>(left: readonly T[], right: readonly T[]): T[] {
  const output = mapPrivateArray(left, (value) => value);
  output.length = left.length + right.length;
  for (let index = 0; index < right.length; index++) {
    if (!hasOwn(right, index)) continue;
    defineOwnDataProperty(output, left.length + index, right[index], {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

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
