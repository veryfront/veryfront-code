import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { concatPrivateArrays } from "./private-array.ts";

describe("private array concatenation", () => {
  it("preserves order, element identity, sparse positions, and the source arrays", () => {
    const first = { value: "first" };
    const last = { value: "last" };
    const left = [first, , first];
    const right = [, last];
    const joined = concatPrivateArrays(left, right);
    assertEquals(joined.length, 5);
    assertEquals(Object.keys(joined), ["0", "2", "4"]);
    assertStrictEquals(joined[0], first);
    assertStrictEquals(joined[2], first);
    assertStrictEquals(joined[4], last);
    assertEquals(left.length, 3);
    assertEquals(Object.keys(left), ["0", "2"]);
    assertEquals(right.length, 2);
    assertEquals(Object.keys(right), ["1"]);
  });
});
