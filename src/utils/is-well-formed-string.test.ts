import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isWellFormedString } from "./is-well-formed-string.ts";

describe("isWellFormedString", () => {
  it("accepts ordinary strings and valid surrogate pairs", () => {
    assertEquals(isWellFormedString(""), true);
    assertEquals(isWellFormedString("styles/app.css"), true);
    assertEquals(isWellFormedString("before\uD83D\uDE00after"), true);
  });

  it("rejects lone and mismatched surrogates", () => {
    assertEquals(isWellFormedString("\uD800"), false);
    assertEquals(isWellFormedString("\uDC00"), false);
    assertEquals(isWellFormedString("\uD800x"), false);
    assertEquals(isWellFormedString("\uD800\uD800"), false);
    assertEquals(isWellFormedString("\uDC00\uDC00"), false);
  });
});
