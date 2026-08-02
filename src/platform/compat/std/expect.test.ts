import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createNodeExpect } from "./expect.ts";

const nodeExpect = createNodeExpect();

describe("platform/compat/std/expect Node matchers", () => {
  it("distinguishes an omitted property value from explicit undefined", () => {
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
