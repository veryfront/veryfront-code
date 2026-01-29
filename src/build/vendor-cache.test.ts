import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateVendorCacheKey } from "./vendor-cache.ts";

describe("build/vendor-cache", () => {
  describe("generateVendorCacheKey", () => {
    it("should return a key with vendor prefix and project id", async () => {
      const key = await generateVendorCacheKey("proj1", "18.3.1", {});
      assertEquals(key.startsWith("vendor:proj1:"), true);
    });

    it("should produce 16-char hex hash suffix", async () => {
      const key = await generateVendorCacheKey("proj1", "18.3.1", {});
      const hash = key.split(":")[2];
      assertExists(hash);
      assertEquals(hash.length, 16);
      assertEquals(/^[0-9a-f]{16}$/.test(hash), true);
    });

    it("should be deterministic", async () => {
      const deps = { lodash: "4.17.21", axios: "1.6.0" };
      const key1 = await generateVendorCacheKey("p", "18.3.1", deps);
      const key2 = await generateVendorCacheKey("p", "18.3.1", deps);
      assertEquals(key1, key2);
    });

    it("should differ for different react versions", async () => {
      const key1 = await generateVendorCacheKey("p", "18.3.1", {});
      const key2 = await generateVendorCacheKey("p", "19.0.0", {});
      assertEquals(key1 !== key2, true);
    });

    it("should differ for different dependencies", async () => {
      const key1 = await generateVendorCacheKey("p", "18.3.1", { a: "1.0" });
      const key2 = await generateVendorCacheKey("p", "18.3.1", { b: "2.0" });
      assertEquals(key1 !== key2, true);
    });

    it("should be order-independent for dependencies", async () => {
      const key1 = await generateVendorCacheKey("p", "18.3.1", {
        a: "1.0",
        b: "2.0",
      });
      const key2 = await generateVendorCacheKey("p", "18.3.1", {
        b: "2.0",
        a: "1.0",
      });
      assertEquals(key1, key2);
    });

    it("should differ for different project ids", async () => {
      const key1 = await generateVendorCacheKey("proj1", "18.3.1", {});
      const key2 = await generateVendorCacheKey("proj2", "18.3.1", {});
      assertEquals(key1 !== key2, true);
    });
  });
});
