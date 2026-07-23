import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";

describe("workflow/blob/blob-id", () => {
  it("accepts primitive public IDs up to the documented limit", () => {
    assertEquals(isSafeBlobId("a"), true);
    assertEquals(isSafeBlobId("a".repeat(255)), true);
  });

  it("rejects non-string runtime values", () => {
    for (const value of [123, null, undefined, {}, ["blob"]]) {
      assertEquals(isSafeBlobId(value as never), false);
      assertThrows(
        () => assertSafeBlobId(value as never),
        Error,
        "primitive strings",
      );
    }
  });

  it("rejects IDs longer than a filesystem component", () => {
    const oversized = "a".repeat(256);
    assertEquals(isSafeBlobId(oversized), false);
    assertThrows(
      () => assertSafeBlobId(oversized),
      Error,
      "255 characters",
    );
  });
});
