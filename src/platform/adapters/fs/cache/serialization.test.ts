import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deserializeFileCacheEntry, serializeFileCacheEntry } from "./serialization.ts";

describe("file cache serialization", () => {
  it("round-trips byte values without changing their runtime type", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    const serialized = serializeFileCacheEntry({
      value: bytes,
      timestamp: 123,
      size: bytes.length,
    });
    const restored = deserializeFileCacheEntry<Uint8Array>(serialized);

    assertEquals(restored.timestamp, 123);
    assertEquals(restored.size, bytes.length);
    assertEquals(restored.value instanceof Uint8Array, true);
    assertEquals(restored.value, bytes);
  });

  it("preserves JSON-compatible values", () => {
    const entry = {
      value: { files: [{ path: "pages/index.tsx", content: "source" }] },
      timestamp: 456,
      size: 42,
    };
    assertEquals(deserializeFileCacheEntry(serializeFileCacheEntry(entry)), entry);
  });

  it("reads legacy untagged cache entries", () => {
    const legacy = JSON.stringify({ value: "cached", timestamp: 789, size: 12 });
    assertEquals(deserializeFileCacheEntry(legacy), {
      value: "cached",
      timestamp: 789,
      size: 12,
    });
  });

  it("rejects malformed cache entries", () => {
    for (
      const serialized of [
        "null",
        "not-json",
        JSON.stringify({ value: "cached", timestamp: "invalid", size: 1 }),
        JSON.stringify({ value: "cached", timestamp: -1, size: 1 }),
        JSON.stringify({ value: "%%%", timestamp: 1, size: 1, valueEncoding: "bytes-v1" }),
      ]
    ) {
      assertThrows(() => deserializeFileCacheEntry(serialized), Error);
    }
  });

  it("normalizes unsupported values to a cache invariant error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const value of [42n, cyclic]) {
      try {
        serializeFileCacheEntry({ value, timestamp: 1, size: 1 });
        throw new Error("Expected serialization to fail");
      } catch (error) {
        assertEquals((error as { slug?: string }).slug, "cache-invariant-violation");
      }
    }
  });
});
