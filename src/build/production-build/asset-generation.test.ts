import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loadClientStyles } from "./asset-generation.ts";
import type { AssetStats } from "./asset-generation.ts";

describe("build/production-build/asset-generation", () => {
  describe("loadClientStyles", () => {
    it("should return a non-empty string", () => {
      const styles = loadClientStyles();
      assertEquals(typeof styles, "string");
      assertEquals(styles.length > 0, true);
    });

    it("should contain error container styles only", () => {
      const styles = loadClientStyles();
      assertEquals(styles.includes(".error-container"), true);
      assertEquals(styles.includes(".prose"), false);
      assertEquals(styles.includes(".loading-container"), false);
    });

    it("should be consistent across calls", () => {
      const styles1 = loadClientStyles();
      const styles2 = loadClientStyles();
      assertEquals(styles1, styles2);
    });

    it("should contain CSS properties", () => {
      const styles = loadClientStyles();
      assertEquals(styles.includes("max-width"), true);
      assertEquals(styles.includes("border-radius"), true);
    });
  });

  describe("AssetStats type", () => {
    it("should have assets and totalSize fields", () => {
      const stats: AssetStats = { assets: 0, totalSize: 0 };
      assertEquals(stats.assets, 0);
      assertEquals(stats.totalSize, 0);
    });

    it("should represent a typical result", () => {
      const stats: AssetStats = { assets: 15, totalSize: 1024000 };
      assertEquals(stats.assets, 15);
      assertEquals(stats.totalSize, 1024000);
    });
  });
});
