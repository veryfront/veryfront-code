import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detachRetainedString, estimateRetainedStringBytes } from "./retained-string.ts";

describe("retained string cache utilities", () => {
  it("copies exact UTF-16 content across chunk and surrogate boundaries", () => {
    const value = `${"a".repeat(8 * 1024 - 1)}😀${"z".repeat(8 * 1024 + 7)}`;
    const detached = detachRetainedString(value);
    assertEquals(detached, value);
    assertEquals(detached.length, value.length);
  });

  it("accounts for the larger of UTF-8 and UTF-16 storage", () => {
    assertEquals(estimateRetainedStringBytes("a") >= 2, true);
    assertEquals(estimateRetainedStringBytes("😀") >= 4, true);
    assertEquals(
      estimateRetainedStringBytes("a".repeat(100)) >= 200,
      true,
    );

    const threeByteText = "\u3042".repeat(4_096);
    assertEquals(
      estimateRetainedStringBytes(threeByteText) >= threeByteText.length * 3,
      true,
      "three-byte UTF-8 text must be accounted at its UTF-8 size, not its UTF-16 size",
    );
  });

  it("uses captured copy intrinsics", () => {
    const originalApply = Reflect.apply;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalJoin = Array.prototype.join;
    let copied: string | undefined;
    try {
      Reflect.apply = () => {
        throw new Error("poisoned Reflect.apply");
      };
      String.prototype.charCodeAt = () => 0;
      Array.prototype.join = () => "poisoned";
      copied = detachRetainedString("a".repeat(9 * 1024));
    } finally {
      Reflect.apply = originalApply;
      String.prototype.charCodeAt = originalCharCodeAt;
      Array.prototype.join = originalJoin;
    }
    assertEquals(copied, "a".repeat(9 * 1024));
  });
});
