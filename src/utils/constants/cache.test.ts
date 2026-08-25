import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DISTRIBUTED_CSS_TTL_PREVIEW_SEC,
  DISTRIBUTED_CSS_TTL_PRODUCTION_SEC,
  DISTRIBUTED_FILE_TTL_PREVIEW_SEC,
  DISTRIBUTED_FILE_TTL_PRODUCTION_SEC,
  DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
  DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC,
  DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC,
  DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC,
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
      assertEquals(
        getDistributedCacheTTL("ssr-module", true),
        DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC,
        "ssr-module production TTL must use the ssr-module constant",
      );
      assertEquals(
        getDistributedCacheTTL("ssr-module", false),
        DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
        "ssr-module preview TTL must use the ssr-module constant",
      );

      assertEquals(
        getDistributedCacheTTL("transform", true),
        DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC,
        "transform production TTL must use the transform constant",
      );
      assertEquals(
        getDistributedCacheTTL("transform", false),
        DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC,
        "transform preview TTL must use the transform constant",
      );

      assertEquals(
        getDistributedCacheTTL("file", true),
        DISTRIBUTED_FILE_TTL_PRODUCTION_SEC,
        "file production TTL must use the file constant",
      );
      assertEquals(
        getDistributedCacheTTL("file", false),
        DISTRIBUTED_FILE_TTL_PREVIEW_SEC,
        "file preview TTL must use the file constant",
      );

      assertEquals(
        getDistributedCacheTTL("css", true),
        DISTRIBUTED_CSS_TTL_PRODUCTION_SEC,
        "css production TTL must use the css constant",
      );
      assertEquals(
        getDistributedCacheTTL("css", false),
        DISTRIBUTED_CSS_TTL_PREVIEW_SEC,
        "css preview TTL must use the css constant",
      );
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
