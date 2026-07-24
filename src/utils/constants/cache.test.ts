import "#veryfront/schemas/_test-setup.ts";
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

async function importCacheConstantsWithEnv(
  overrides: Record<string, string>,
): Promise<typeof import("./cache.ts")> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }

  try {
    return await import(`./cache.ts?cache-env-test=${crypto.randomUUID()}`);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

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

  describe("environment overrides", () => {
    it("uses strict bounded integers instead of partially parsed values", async () => {
      for (const value of ["10junk", "1.5", "-1", "9007199254740992"]) {
        const constants = await importCacheConstantsWithEnv({
          LRU_DEFAULT_MAX_ENTRIES: value,
        });
        assertEquals(constants.DEFAULT_LRU_MAX_ENTRIES, 100);
      }
    });

    it("bounds byte-size and concurrency overrides", async () => {
      const constants = await importCacheConstantsWithEnv({
        LRU_MAX_SIZE_MB: "9007199254740991",
        MAX_CONCURRENT_HTTP_FETCHES: "1000000000",
      });

      assertEquals(constants.LRU_DEFAULT_MAX_SIZE_BYTES, 200 * 1024 * 1024);
      assertEquals(constants.MAX_CONCURRENT_HTTP_FETCHES, 50);
    });

    it("preserves zero only for the documented fairness-limit disable switch", async () => {
      const constants = await importCacheConstantsWithEnv({
        REVALIDATION_PER_PROJECT_LIMIT: "0",
      });

      assertEquals(constants.REVALIDATION_PER_PROJECT_LIMIT, 0);
    });

    it("accepts valid decimal overrides", async () => {
      const constants = await importCacheConstantsWithEnv({
        LRU_DEFAULT_MAX_ENTRIES: "42",
      });

      assertEquals(constants.DEFAULT_LRU_MAX_ENTRIES, 42);
    });
  });
});
