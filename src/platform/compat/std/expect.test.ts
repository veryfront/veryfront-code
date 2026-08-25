import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createNodeExpect } from "./expect.ts";

const nodeExpect = createNodeExpect();

describe("platform/compat/std/expect Node matchers", () => {
  it("distinguishes an omitted property value from explicit undefined", () => {
    // The single-argument form is a presence check and must not compare
    // the value against undefined.
    nodeExpect({ value: 1 }).toHaveProperty("value");
    assertThrows(
      () => nodeExpect({ value: 1 }).toHaveProperty("missing"),
      Error,
      "to have property",
      "an absent key fails the presence check",
    );
    nodeExpect({ value: undefined }).toHaveProperty("value", undefined);
    assertThrows(
      () => nodeExpect({ value: 1 }).toHaveProperty("value", undefined),
      Error,
      "Expected",
    );
  });

  it("fails rejects.not matchers when the promise resolves", async () => {
    await assertRejects(
      () => nodeExpect(Promise.resolve("ok")).rejects.not.toBe("different"),
      Error,
      "Expected promise to reject",
    );
  });

  it("allows rejects.not matchers for a different rejection value", async () => {
    await nodeExpect(Promise.reject("actual")).rejects.not.toBe("different");
  });

  it("fails rejects.not matchers when the rejection matches", async () => {
    await assertRejects(
      () => nodeExpect(Promise.reject("actual")).rejects.not.toBe("actual"),
      Error,
      "not to reject with",
      "a matching rejection must fail the negated toBe matcher",
    );
    await assertRejects(
      () => nodeExpect(Promise.reject({ a: 1 })).rejects.not.toEqual({ a: 1 }),
      Error,
      "not to reject with",
      "a deep-equal rejection must fail the negated toEqual matcher",
    );
  });

  it("uses stateful regular expressions deterministically", () => {
    const pattern = /match/g;
    pattern.lastIndex = 3;

    nodeExpect("match").toMatch(pattern);
    nodeExpect("match").toMatch(pattern);

    assertEquals(pattern.lastIndex, 3);
  });

  it("reports a matcher failure for non-object toMatchObject inputs", () => {
    assertThrows(
      () => nodeExpect(null).toMatchObject({ value: 1 }),
      Error,
      "Expected",
    );
  });
});
