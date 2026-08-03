// Capture shared array intrinsics once, before project code can replace mutable
// prototype methods in a long-lived runtime. Keep this module dependency-free so
// low-level compatibility code and higher framework layers can use the same
// trusted operations without introducing an import cycle.
const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeMap = Array.prototype.map;
const ArrayPrototypePop = Array.prototype.pop;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSort = Array.prototype.sort;
const ReflectApply = Reflect.apply;

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
  return ReflectApply(ArrayPrototypeFilter, values, [predicate]) as T[];
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
  return ReflectApply(ArrayPrototypeMap, values, [callback]) as U[];
}

export function primordialArrayPop<T>(values: T[]): T | undefined {
  return ReflectApply(ArrayPrototypePop, values, []) as T | undefined;
}

export function primordialArrayPush<T>(values: T[], value: T): void {
  ReflectApply(ArrayPrototypePush, values, [value]);
}

export function primordialArraySort<T>(
  values: T[],
  compare: (left: T, right: T) => number,
): T[] {
  return ReflectApply(ArrayPrototypeSort, values, [compare]) as T[];
}
