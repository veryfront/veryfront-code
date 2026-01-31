import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getDistributedCacheTTL,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  ONE_DAY_MS,
  SECONDS_PER_MINUTE,
} from "./cache.ts";

describe("constants/cache", () => {
  describe("time constants", () => {
    it("should have correct MS_PER_SECOND", () => {
      assertEquals(MS_PER_SECOND, 1000);
    });

    it("should have correct MS_PER_MINUTE", () => {
      assertEquals(MS_PER_MINUTE, 60_000);
    });

    it("should have correct MS_PER_HOUR", () => {
      assertEquals(MS_PER_HOUR, 3_600_000);
    });

    it("should have correct ONE_DAY_MS", () => {
      assertEquals(ONE_DAY_MS, 86_400_000);
    });
  });

  describe("getDistributedCacheTTL", () => {
    const cacheTypes = ["ssr-module", "transform", "file", "css"] as const;

    it("should return production TTL for ssr-module when production", () => {
      const ttl = getDistributedCacheTTL("ssr-module", true);
      assertEquals(typeof ttl, "number");
      assertEquals(ttl > SECONDS_PER_MINUTE, true);
    });

    it("should return preview TTL for ssr-module when not production", () => {
      const ttl = getDistributedCacheTTL("ssr-module", false);
      assertEquals(typeof ttl, "number");

      // Preview TTL should be shorter than production
      const prodTtl = getDistributedCacheTTL("ssr-module", true);
      assertEquals(ttl < prodTtl, true);
    });

    it("should return values for all cache types", () => {
      for (const type of cacheTypes) {
        const prodTtl = getDistributedCacheTTL(type, true);
        const previewTtl = getDistributedCacheTTL(type, false);

        assertEquals(typeof prodTtl, "number");
        assertEquals(typeof previewTtl, "number");
        assertEquals(prodTtl > 0, true);
        assertEquals(previewTtl > 0, true);
      }
    });

    it("should return production TTL >= preview TTL for all types", () => {
      for (const type of cacheTypes) {
        const prodTtl = getDistributedCacheTTL(type, true);
        const previewTtl = getDistributedCacheTTL(type, false);

        assertEquals(prodTtl >= previewTtl, true);
      }
    });
  });
});
