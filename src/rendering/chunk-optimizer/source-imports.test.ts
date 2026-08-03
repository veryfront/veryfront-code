import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { utf8ByteLength } from "./source-imports.ts";

describe("utf8ByteLength", () => {
  it("measures UTF-8 bytes", () => {
    assertEquals(utf8ByteLength("abc"), 3);
    assertEquals(utf8ByteLength("å"), 2);
  });
});
