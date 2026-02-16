import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loadClientStyles } from "./asset-generation.ts";

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
  });
});
