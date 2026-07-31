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

  it("is independent of later built-in and error-constructor mutation", () => {
    const NativeRangeError = RangeError;
    const NativeTypeError = TypeError;
    const targets = [
      [Reflect, "apply"],
      [Number, "isSafeInteger"],
      [String.prototype, "charCodeAt"],
      [globalThis, "TypeError"],
      [globalThis, "RangeError"],
    ] as const;
    const originals = targets.map(([target, property]) =>
      Object.getOwnPropertyDescriptor(target, property)
    );
    let hookCalls = 0;

    try {
      for (const [target, property] of targets) {
        Object.defineProperty(target, property, {
          configurable: true,
          value() {
            hookCalls += 1;
            throw new Error("mutated built-in must not run");
          },
          writable: true,
        });
      }
      assertEquals(utf8ByteLength("aé🙂"), 7);
      assertEquals(utf8ByteLength("ééé", 4), 5);
      assertThrows(() => utf8ByteLength("value", -1), NativeRangeError, "stopAfter");
      assertThrows(() => utf8ByteLength(1 as never), NativeTypeError, "must be a string");
    } finally {
      targets.forEach(([target, property], index) => {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(target, property, descriptor);
      });
    }

    assertEquals(hookCalls, 0);
  });
});
