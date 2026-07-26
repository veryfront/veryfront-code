import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeCacheKeyPercentSegment, encodeCacheKeyPercentSegment } from "./segment-codec.ts";

describe("cache key percent segment codec", () => {
  it("round-trips arbitrary JavaScript strings without aliases", () => {
    const values = [
      "",
      "plain",
      "with:delimiter/and spaces",
      "emoji-\u{1f642}",
      "high-\ud800",
      "low-\udc00",
      "literal-%uD800",
    ];
    const encodings = values.map(encodeCacheKeyPercentSegment);

    assertEquals(
      encodings.map(decodeCacheKeyPercentSegment),
      values,
    );
    assertEquals(new Set(encodings).size, values.length);
    assertNotEquals(
      encodeCacheKeyPercentSegment("\ud800"),
      encodeCacheKeyPercentSegment("\udc00"),
    );
  });

  it("rejects malformed and non-canonical encodings", () => {
    for (
      const encoded of [
        "%",
        "%FF",
        "%u0041",
        "%ud800",
        "%uD83D%uDE42",
        "%70lain",
      ]
    ) {
      assertEquals(decodeCacheKeyPercentSegment(encoded), null);
    }
  });
});
