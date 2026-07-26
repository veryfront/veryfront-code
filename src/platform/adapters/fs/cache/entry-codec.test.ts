import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeCacheEntry, encodeCacheEntry } from "./entry-codec.ts";

describe("file-cache entry codec", () => {
  it("round-trips JSON-compatible values", () => {
    const entry = {
      value: { files: ["index.ts", "about.ts"] },
      timestamp: 123,
      size: 42,
    };

    assertEquals(decodeCacheEntry(encodeCacheEntry(entry)), entry);
  });

  it("round-trips Uint8Array values without losing their type", () => {
    const entry = {
      value: new Uint8Array([0, 1, 127, 128, 255]),
      timestamp: 123,
      size: 5,
    };

    const decoded = decodeCacheEntry<Uint8Array>(encodeCacheEntry(entry));
    assertEquals(decoded.value instanceof Uint8Array, true);
    assertEquals(decoded, entry);
  });

  it("rejects malformed and unsupported cache envelopes", () => {
    for (
      const serialized of [
        "null",
        "[]",
        "{}",
        '{"value":"x","timestamp":"123","size":1}',
        '{"value":"x","timestamp":123,"size":-1}',
        '{"value":"x","timestamp":123,"size":1,"valueEncoding":"future"}',
        '{"value":"***","timestamp":123,"size":1,"valueEncoding":"uint8array-base64url-v1"}',
      ]
    ) {
      assertThrows(() => decodeCacheEntry(serialized), TypeError);
    }
  });
});
