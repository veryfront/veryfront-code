import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  primordialArrayAt,
  primordialArrayFilter,
  primordialArrayIndexOf,
  primordialArrayJoin,
  primordialArrayMap,
  primordialArrayPop,
  primordialArrayPush,
  primordialArraySet,
  primordialArrayShift,
  primordialArraySort,
  primordialArraySplice,
  primordialArrayValues,
} from "./array.ts";

describe("platform/compat/primordials/array", () => {
  it("constructs filter, map, and splice results without consulting Array species", () => {
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    const inheritedZero = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const values = [1, 2, 3];
    const queue = [1, 2, 3];
    const appended: number[] = [];
    let inheritedWrite = false;
    let filtered: number[] = [];
    let mapped: number[] = [];
    let removed: number[] = [];
    try {
      Object.defineProperty(Array, Symbol.species, {
        configurable: true,
        get() {
          throw new Error("poisoned Array species");
        },
      });
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          inheritedWrite = true;
        },
      });
      filtered = primordialArrayFilter(values, (value) => value > 1);
      mapped = primordialArrayMap(values, (value) => value * 2);
      removed = primordialArraySplice(queue, 1, 1);
      primordialArrayPush(appended, 4);
    } finally {
      if (species) Object.defineProperty(Array, Symbol.species, species);
      else delete (Array as unknown as Record<PropertyKey, unknown>)[Symbol.species];
      if (inheritedZero) Object.defineProperty(Array.prototype, "0", inheritedZero);
      else delete Array.prototype[0];
    }
    assertEquals(inheritedWrite, false);
    assertEquals(filtered, [2, 3]);
    assertEquals(mapped, [2, 4, 6]);
    assertEquals(removed, [2]);
    assertEquals(queue, [1, 3]);
    assertEquals(appended, [4]);
    assertEquals(Object.getOwnPropertyDescriptor(appended, "0"), {
      configurable: true,
      enumerable: true,
      value: 4,
      writable: true,
    });
  });

  it("snapshots map and filter length while preserving their hole contracts", () => {
    const sparse = new Array<number>(3);
    primordialArraySet(sparse, 0, 1);
    primordialArraySet(sparse, 2, 3);
    const mapped = primordialArrayMap(sparse, (value, index, values) => {
      if (index === 0) primordialArrayPush(values as number[], 4);
      return value * 2;
    });
    const filtered = primordialArrayFilter(sparse, (value, index, values) => {
      if (index === 0) primordialArrayPush(values as number[], 5);
      return value > 0;
    });
    assertEquals(mapped.length, 3);
    assertEquals(1 in mapped, false);
    assertEquals(mapped[0], 2);
    assertEquals(mapped[2], 6);
    assertEquals(filtered, [1, 3, 4]);
  });

  it("uses module-load-time captures after array prototypes are replaced", () => {
    const originals = {
      at: Array.prototype.at,
      filter: Array.prototype.filter,
      join: Array.prototype.join,
      indexOf: Array.prototype.indexOf,
      map: Array.prototype.map,
      pop: Array.prototype.pop,
      push: Array.prototype.push,
      sort: Array.prototype.sort,
      shift: Array.prototype.shift,
      splice: Array.prototype.splice,
      iterator: Array.prototype[Symbol.iterator],
    };
    const poisoned = () => {
      throw new Error("poisoned array primordial");
    };

    let first: number | undefined;
    let filtered: number[] | undefined;
    let joined: string | undefined;
    let mapped: number[] | undefined;
    let popped: number | undefined;
    let sorted: number[] | undefined;
    const values = [3, 1, 2];
    const iterated: number[] = [];
    const queue = [9, 8];
    let queueIndex: number | undefined;
    let removed: number[] | undefined;
    let shifted: number | undefined;

    try {
      Array.prototype.at = poisoned;
      Array.prototype.filter = poisoned;
      Array.prototype.join = poisoned;
      Array.prototype.indexOf = poisoned;
      Array.prototype.map = poisoned;
      Array.prototype.pop = poisoned;
      Array.prototype.push = poisoned;
      Array.prototype.sort = poisoned;
      Array.prototype.shift = poisoned;
      Array.prototype.splice = poisoned;
      Array.prototype[Symbol.iterator] = poisoned;

      first = primordialArrayAt(values, 0);
      filtered = primordialArrayFilter(values, (value) => value > 1);
      joined = primordialArrayJoin(values, ":");
      mapped = primordialArrayMap(values, (value) => value * 2);
      primordialArrayPush(values, 4);
      popped = primordialArrayPop(values);
      sorted = primordialArraySort(values, (left, right) => left - right);
      for (const value of primordialArrayValues(values)) iterated[iterated.length] = value;
      queueIndex = primordialArrayIndexOf(queue, 8);
      removed = primordialArraySplice(queue, 0, 1);
      shifted = primordialArrayShift(queue);
    } finally {
      Array.prototype.at = originals.at;
      Array.prototype.filter = originals.filter;
      Array.prototype.join = originals.join;
      Array.prototype.indexOf = originals.indexOf;
      Array.prototype.map = originals.map;
      Array.prototype.pop = originals.pop;
      Array.prototype.push = originals.push;
      Array.prototype.sort = originals.sort;
      Array.prototype.shift = originals.shift;
      Array.prototype.splice = originals.splice;
      Array.prototype[Symbol.iterator] = originals.iterator;
    }

    assertEquals(first, 3);
    assertEquals(filtered, [3, 2]);
    assertEquals(joined, "3:1:2");
    assertEquals(mapped, [6, 2, 4]);
    assertEquals(popped, 4);
    assertEquals(sorted, [1, 2, 3]);
    assertEquals(iterated, [1, 2, 3]);
    assertEquals(queueIndex, 1);
    assertEquals(removed, [9]);
    assertEquals(shifted, 8);
    assertEquals(queue, []);
  });
});
