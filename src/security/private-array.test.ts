import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { appendPrivateArray, concatPrivateArrays, pushPrivateArray } from "./private-array.ts";

describe("private array concatenation", () => {
  it("appends arrays without consulting an overridden iterator", () => {
    const value = { text: "Synthetic output" };
    const source = [value];
    let observations = 0;
    Object.defineProperty(source, Symbol.iterator, {
      get() {
        observations++;
        return Array.prototype[Symbol.iterator];
      },
    });
    const target: typeof source = [];
    assertEquals(appendPrivateArray(target, source), 1);
    assertStrictEquals(target[0], value);
    assertEquals(observations, 0);
  });

  it("appends retained objects without consulting push or inherited index setters", () => {
    const part = { text: "" };
    const values: typeof part[] = [];
    let observations = 0;
    Object.setPrototypeOf(
      values,
      Object.create(Array.prototype, {
        push: {
          get() {
            observations++;
            return Array.prototype.push;
          },
        },
        0: {
          set(value: typeof part) {
            observations++;
            Object.defineProperty(this, "0", {
              value,
              writable: true,
              configurable: true,
              enumerable: true,
            });
          },
        },
      }),
    );
    assertEquals(pushPrivateArray(values, part), 1);
    part.text = "Synthetic reasoning";
    assertStrictEquals(values[0], part);
    assertEquals(values[0]?.text, "Synthetic reasoning");
    assertEquals(observations, 0);
  });

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
