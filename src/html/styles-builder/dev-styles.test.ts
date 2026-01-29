import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevStyles } from "./dev-styles.ts";

describe("html/styles-builder/dev-styles", () => {
  describe("getDevStyles", () => {
    it("should return a style tag", () => {
      const styles = getDevStyles();
      assertEquals(styles.includes("<style"), true);
      assertEquals(styles.includes("</style>"), true);
    });

    it("should include error overlay styles", () => {
      const styles = getDevStyles();
      assertEquals(styles.includes("veryfront-error-overlay"), true);
    });

    it("should include animation keyframes", () => {
      const styles = getDevStyles();
      assertEquals(styles.includes("@keyframes"), true);
      assertEquals(styles.includes("vf-bounce"), true);
    });

    it("should include view transition styles", () => {
      const styles = getDevStyles();
      assertEquals(styles.includes("view-transition"), true);
    });

    it("should include nonce when provided", () => {
      const styles = getDevStyles("my-nonce");
      assertEquals(styles.includes('nonce="my-nonce"'), true);
    });
  });
});
