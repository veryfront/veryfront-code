import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deepEquals, safeStringify } from "./utils.ts";

describe("testing/utils", () => {
  it("distinguishes unequal built-in values", () => {
    assertEquals(deepEquals(new Date(0), new Date(1)), false);
    assertEquals(deepEquals(new Map([["key", 1]]), new Map([["key", 2]])), false);
    assertEquals(deepEquals(new Set([1]), new Set([2])), false);
  });

  it("compares cyclic object pairs instead of accepting any repeated left node", () => {
    const left: { self?: unknown } = {};
    left.self = left;

    const right = { self: {} };

    assertEquals(deepEquals(left, right), false);
  });

  it("always returns a string for values JSON.stringify omits", () => {
    assertEquals(safeStringify(undefined), "undefined");
    assertEquals(safeStringify(() => undefined), "[Function]");
    assertEquals(safeStringify(Symbol.for("veryfront")), "Symbol(veryfront)");
  });

  it("does not throw while describing hostile objects", () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error("blocked property access");
      },
      ownKeys() {
        throw new Error("blocked enumeration");
      },
    });

    assertEquals(safeStringify(hostile), "[Object]");
  });
});
