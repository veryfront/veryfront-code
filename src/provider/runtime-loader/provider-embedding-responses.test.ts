import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNumberArray } from "./provider-embedding-responses.ts";

describe("provider/runtime-loader/provider-embedding-responses", () => {
  it("accepts only finite embedding coordinates", () => {
    assertEquals(isNumberArray([0, 1.5, -2]), true);
    assertEquals(isNumberArray([1, Number.NaN]), false);
    assertEquals(isNumberArray([1, Number.POSITIVE_INFINITY]), false);
    assertEquals(isNumberArray([1, Number.NEGATIVE_INFINITY]), false);
    assertEquals(isNumberArray([1, "2"]), false);
  });
});
