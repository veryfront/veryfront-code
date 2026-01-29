import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getProductionStyles } from "./production-styles.ts";

describe("html/styles-builder/production-styles", () => {
  describe("getProductionStyles", () => {
    it("should return a style tag", () => {
      const styles = getProductionStyles();
      assertEquals(styles.includes("<style"), true);
      assertEquals(styles.includes("</style>"), true);
    });

    it("should include base body styles", () => {
      const styles = getProductionStyles();
      assertEquals(styles.includes("margin: 0"), true);
      assertEquals(styles.includes("font-family"), true);
    });

    it("should include prose styles", () => {
      const styles = getProductionStyles();
      assertEquals(styles.includes(".prose"), true);
    });

    it("should include responsive container breakpoints", () => {
      const styles = getProductionStyles();
      assertEquals(styles.includes("@media"), true);
      assertEquals(styles.includes(".container"), true);
    });

    it("should include nonce when provided", () => {
      const styles = getProductionStyles("sec-nonce");
      assertEquals(styles.includes('nonce="sec-nonce"'), true);
    });
  });
});
