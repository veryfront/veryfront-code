import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CACHE_TTL_SECONDS } from "../backends/ttl.ts";
import { CacheSetBatchEntrySchema } from "./cache-backend.schema.ts";

describe("cache backend schemas", () => {
  it("accepts the same finite TTL range as cache backends", () => {
    assertEquals(
      CacheSetBatchEntrySchema.parse({ key: "zero", value: "value", ttl: 0 }),
      { key: "zero", value: "value", ttl: 0 },
    );
    assertEquals(
      CacheSetBatchEntrySchema.parse({ key: "negative", value: "value", ttl: -1 }),
      { key: "negative", value: "value", ttl: -1 },
    );
    assertEquals(
      CacheSetBatchEntrySchema.parse({ key: "fractional", value: "value", ttl: 0.5 }),
      { key: "fractional", value: "value", ttl: 0.5 },
    );
  });

  it("rejects TTLs beyond the backend protocol limit", () => {
    assertThrows(() =>
      CacheSetBatchEntrySchema.parse({
        key: "oversized",
        value: "value",
        ttl: MAX_CACHE_TTL_SECONDS + 1,
      })
    );
  });
});
