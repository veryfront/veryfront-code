// Capture shared array intrinsics once, before project code can replace mutable
// prototype methods in a long-lived runtime. Keep this module dependency-free so
// low-level compatibility code and higher framework layers can use the same
// trusted operations without introducing an import cycle.
const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypePop = Array.prototype.pop;
const ArrayPrototypeSort = Array.prototype.sort;
const ArrayPrototypeShift = Array.prototype.shift;
const ReflectApply = Reflect.apply;
const ObjectDefineProperty = Object.defineProperty;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const iteratorSymbol: typeof Symbol.iterator = Symbol.iterator;

function hasOwnIndex(values: readonly unknown[], index: number): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, values, [index]) as boolean;
}

/** Define an own indexed data slot without invoking an inherited setter. */
export function primordialArraySet<T>(values: T[], index: number, value: T): void {
  ObjectDefineProperty(values, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Iterate a trusted array without consulting mutable array iterator hooks. */
export function primordialArrayValues<T>(values: readonly T[]): Iterable<T> {
  return {
    [iteratorSymbol](): Iterator<T> {
      let index = 0;
      return {
        next(): IteratorResult<T> {
          return index < values.length
            ? { value: values[index++]!, done: false }
            : { value: undefined, done: true };
        },
      };
    },
  };
}

export function primordialArrayAt<T>(
  values: readonly T[],
  index: number,
): T | undefined {
  return ReflectApply(ArrayPrototypeAt, values, [index]) as T | undefined;
}

export function primordialArrayFilter<T>(
  values: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
): T[] {
  const result: T[] = [];
  const length = values.length;
  for (let index = 0; index < length; index++) {
    if (!hasOwnIndex(values, index)) continue;
    const value = values[index]!;
    if (predicate(value, index, values)) primordialArraySet(result, result.length, value);
  }
  return result;
}

export function primordialArrayJoin(
  values: readonly unknown[],
  separator: string,
): string {
  return ReflectApply(ArrayPrototypeJoin, values, [separator]) as string;
}

export function primordialArrayMap<T, U>(
  values: readonly T[],
  callback: (value: T, index: number, array: readonly T[]) => U,
): U[] {
  const result: U[] = [];
  const length = values.length;
  result.length = length;
  for (let index = 0; index < length; index++) {
    if (!hasOwnIndex(values, index)) continue;
    primordialArraySet(result, index, callback(values[index]!, index, values));
  }
  return result;
}

export function primordialArrayPop<T>(values: T[]): T | undefined {
  return ReflectApply(ArrayPrototypePop, values, []) as T | undefined;
}

export function primordialArrayShift<T>(values: T[]): T | undefined {
  return ReflectApply(ArrayPrototypeShift, values, []) as T | undefined;
}

export function primordialArrayIndexOf<T>(values: readonly T[], value: T): number {
  return ReflectApply(ArrayPrototypeIndexOf, values, [value]) as number;
}

export function primordialArraySplice<T>(values: T[], start: number, count: number): T[] {
  const length = values.length;
  const relativeStart = start < 0 ? length + start : start;
  const actualStart = relativeStart < 0 ? 0 : relativeStart > length ? length : relativeStart;
  const available = length - actualStart;
  const actualCount = count < 0 ? 0 : count > available ? available : count;
  const removed: T[] = [];
  removed.length = actualCount;
  for (let index = 0; index < actualCount; index++) {
    const sourceIndex = actualStart + index;
    if (hasOwnIndex(values, sourceIndex)) {
      primordialArraySet(removed, index, values[sourceIndex]!);
    }
  }
  for (let index = actualStart; index < length - actualCount; index++) {
    const sourceIndex = index + actualCount;
    if (hasOwnIndex(values, sourceIndex)) {
      primordialArraySet(values, index, values[sourceIndex]!);
    } else {
      delete values[index];
    }
  }
  values.length = length - actualCount;
  return removed;
}

export function primordialArrayPush<T>(values: T[], value: T): void {
  primordialArraySet(values, values.length, value);
}

export function primordialArraySort<T>(
  values: T[],
  compare: (left: T, right: T) => number,
): T[] {
  return ReflectApply(ArrayPrototypeSort, values, [compare]) as T[];
}
