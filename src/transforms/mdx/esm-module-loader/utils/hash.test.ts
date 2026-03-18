import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hashString } from "./hash.ts";

describe("hashString", () => {
  it("returns a string", () => {
    assertEquals(typeof hashString("hello"), "string");
  });

  it("returns consistent results for same input", () => {
    assertEquals(hashString("test"), hashString("test"));
  });

  it("returns different results for different input", () => {
    const a = hashString("foo");
    const b = hashString("bar");
    assertEquals(a !== b, true);
  });

  it("handles empty string", () => {
    const result = hashString("");
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);
  });
});
