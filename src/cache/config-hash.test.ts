import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeConfigHash, computeConfigHashSync } from "./config-hash.ts";

describe("cache/config-hash", () => {
  describe("computeConfigHash", () => {
    it("should return a 64-char hex hash", async () => {
      const hash = await computeConfigHash({});
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should be consistent for same config", async () => {
      const config = { reactVersion: "19.1.1", dev: false };
      const h1 = await computeConfigHash(config);
      const h2 = await computeConfigHash(config);
      assertEquals(h1, h2);
    });

    it("should differ for different React versions", async () => {
      const h1 = await computeConfigHash({ reactVersion: "18.3.1" });
      const h2 = await computeConfigHash({ reactVersion: "19.1.1" });
      assertNotEquals(h1, h2);
    });

    it("should differ when the emitted module server base changes", async () => {
      const h1 = await computeConfigHash({
        moduleServerUrl: "/_vf_modules",
        dependencyPinningCacheKey: "on:snapshot",
      });
      const h2 = await computeConfigHash({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        dependencyPinningCacheKey: "on:snapshot",
      });
      assertNotEquals(h1, h2);
    });

    it("should differ when the static module request origin changes", async () => {
      const h1 = await computeConfigHash({
        moduleServerOrigin: "https://preview-a.example",
        dependencyPinningCacheKey: "on:snapshot",
      });
      const h2 = await computeConfigHash({
        moduleServerOrigin: "https://preview-b.example",
        dependencyPinningCacheKey: "on:snapshot",
      });
      assertNotEquals(h1, h2);
    });

    it("should differ when the emitted vendor bundle revision changes", async () => {
      const h1 = await computeConfigHash({
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: "on:snapshot",
      });
      const h2 = await computeConfigHash({
        vendorBundleHash: "vendor-b",
        dependencyPinningCacheKey: "on:snapshot",
      });
      assertNotEquals(h1, h2);
    });

    it("preserves the legacy hash when dependency pinning is off or unset", async () => {
      const unkeyed = await computeConfigHash({});
      const flagOff = await computeConfigHash({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        moduleServerOrigin: "https://preview.example",
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: "off",
      });

      assertEquals(flagOff, unkeyed);
    });

    it("should differ when dev mode changes", async () => {
      const h1 = await computeConfigHash({ dev: false });
      const h2 = await computeConfigHash({ dev: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when studioEmbed changes", async () => {
      const h1 = await computeConfigHash({ studioEmbed: false });
      const h2 = await computeConfigHash({ studioEmbed: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when dependency-pin state changes", async () => {
      const h1 = await computeConfigHash({ dependencyPinningCacheKey: "off" });
      const h2 = await computeConfigHash({ dependencyPinningCacheKey: "on:abc" });
      assertNotEquals(h1, h2);
    });
  });

  describe("computeConfigHashSync", () => {
    it("should return a string", () => {
      const hash = computeConfigHashSync({});
      assertEquals(typeof hash, "string");
      assertEquals(hash.length > 0, true);
    });

    it("should be consistent", () => {
      const config = { dev: true };
      const h1 = computeConfigHashSync(config);
      const h2 = computeConfigHashSync(config);
      assertEquals(h1, h2);
    });

    it("should differ for dev vs non-dev", () => {
      const h1 = computeConfigHashSync({ dev: false });
      const h2 = computeConfigHashSync({ dev: true });
      assertNotEquals(h1, h2);
    });

    it("should differ when module and vendor URL inputs change", () => {
      const h1 = computeConfigHashSync({
        moduleServerUrl: "/_vf_modules",
        moduleServerOrigin: "https://preview-a.example",
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: "on:snapshot",
      });
      const h2 = computeConfigHashSync({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        moduleServerOrigin: "https://preview-b.example",
        vendorBundleHash: "vendor-b",
        dependencyPinningCacheKey: "on:snapshot",
      });
      assertNotEquals(h1, h2);
    });

    it("preserves the legacy sync hash when dependency pinning is off or unset", () => {
      const unkeyed = computeConfigHashSync({});
      const flagOff = computeConfigHashSync({
        moduleServerUrl: "https://modules.example.test/_vf_modules",
        moduleServerOrigin: "https://preview.example",
        vendorBundleHash: "vendor-a",
        dependencyPinningCacheKey: "off",
      });

      assertEquals(flagOff, unkeyed);
    });

    it("should include version prefix", () => {
      const hash = computeConfigHashSync({});
      assertEquals(hash.startsWith("v"), true);
    });

    it("should differ when dependency-pin state changes", () => {
      const h1 = computeConfigHashSync({ dependencyPinningCacheKey: "on:abc" });
      const h2 = computeConfigHashSync({ dependencyPinningCacheKey: "on:def" });
      assertNotEquals(h1, h2);
    });
  });
});
