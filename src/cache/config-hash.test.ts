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
      const h1 = await computeConfigHash({ reactVersion: "19.1.1", dev: false });
      const h2 = await computeConfigHash({ reactVersion: "19.1.1", dev: false });
      assertEquals(h1, h2);
    });

    it("should differ for different React versions", async () => {
      const h1 = await computeConfigHash({ reactVersion: "18.3.1" });
      const h2 = await computeConfigHash({ reactVersion: "19.1.1" });
      assertNotEquals(h1, h2);
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
  });

  describe("computeConfigHashSync", () => {
    it("should return a string", () => {
      const hash = computeConfigHashSync({});
      assertEquals(typeof hash, "string");
      assertEquals(hash.length > 0, true);
    });

    it("should be consistent", () => {
      const h1 = computeConfigHashSync({ dev: true });
      const h2 = computeConfigHashSync({ dev: true });
      assertEquals(h1, h2);
    });

    it("should differ for dev vs non-dev", () => {
      const h1 = computeConfigHashSync({ dev: false });
      const h2 = computeConfigHashSync({ dev: true });
      assertNotEquals(h1, h2);
    });

    it("should include version prefix", () => {
      const hash = computeConfigHashSync({});
      assertEquals(hash.startsWith("v"), true);
    });
  });
});
