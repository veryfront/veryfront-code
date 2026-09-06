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
  primordialArrayShift,
  primordialArraySort,
  primordialArraySplice,
  primordialArrayValues,
} from "./array.ts";

describe("platform/compat/primordials/array", () => {
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
