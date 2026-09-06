import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  primordialArrayAt,
  primordialArrayFilter,
  primordialArrayJoin,
  primordialArrayMap,
  primordialArrayPop,
  primordialArrayPush,
  primordialArraySort,
  primordialArrayValues,
} from "./array.ts";

describe("platform/compat/primordials/array", () => {
  it("uses module-load-time captures after array prototypes are replaced", () => {
    const originals = {
      at: Array.prototype.at,
      filter: Array.prototype.filter,
      join: Array.prototype.join,
      map: Array.prototype.map,
      pop: Array.prototype.pop,
      push: Array.prototype.push,
      sort: Array.prototype.sort,
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

    try {
      Array.prototype.at = poisoned;
      Array.prototype.filter = poisoned;
      Array.prototype.join = poisoned;
      Array.prototype.map = poisoned;
      Array.prototype.pop = poisoned;
      Array.prototype.push = poisoned;
      Array.prototype.sort = poisoned;
      Array.prototype[Symbol.iterator] = poisoned;

      first = primordialArrayAt(values, 0);
      filtered = primordialArrayFilter(values, (value) => value > 1);
      joined = primordialArrayJoin(values, ":");
      mapped = primordialArrayMap(values, (value) => value * 2);
      primordialArrayPush(values, 4);
      popped = primordialArrayPop(values);
      sorted = primordialArraySort(values, (left, right) => left - right);
      for (const value of primordialArrayValues(values)) iterated[iterated.length] = value;
    } finally {
      Array.prototype.at = originals.at;
      Array.prototype.filter = originals.filter;
      Array.prototype.join = originals.join;
      Array.prototype.map = originals.map;
      Array.prototype.pop = originals.pop;
      Array.prototype.push = originals.push;
      Array.prototype.sort = originals.sort;
      Array.prototype[Symbol.iterator] = originals.iterator;
    }

    assertEquals(first, 3);
    assertEquals(filtered, [3, 2]);
    assertEquals(joined, "3:1:2");
    assertEquals(mapped, [6, 2, 4]);
    assertEquals(popped, 4);
    assertEquals(sorted, [1, 2, 3]);
    assertEquals(iterated, [1, 2, 3]);
  });
});
