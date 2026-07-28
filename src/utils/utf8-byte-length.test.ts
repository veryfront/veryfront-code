import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { utf8ByteLength } from "./utf8-byte-length.ts";

describe("utils/utf8-byte-length", () => {
  it("matches UTF-8 widths for ASCII, multibyte, and surrogate input", () => {
    for (const value of ["hello", "é", "🙂", "\ud800", "aé🙂"]) {
      assertEquals(utf8ByteLength(value), new TextEncoder().encode(value).byteLength);
    }
  });

  it("stops immediately beyond a caller boundary", () => {
    assertEquals(utf8ByteLength("ééé", 4), 5);
    assertEquals(utf8ByteLength("test", 4), 4);
  });

  it("validates the optional boundary", () => {
    for (const stopAfter of [-1, 1.5, Number.NaN]) {
      assertThrows(
        () => utf8ByteLength("value", stopAfter),
        RangeError,
        "stopAfter",
      );
    }
  });
});
