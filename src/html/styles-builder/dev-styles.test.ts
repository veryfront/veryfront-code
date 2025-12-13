import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getDevStyles } from "./dev-styles.ts";

describe("dev-styles", () => {
  describe("getDevStyles", () => {
    it("should return CSS style tag", () => {
      const styles = getDevStyles();

      assert(styles.includes("<style>"));
      assert(styles.includes("</style>"));
    });

    it("should include nonce attribute if provided", () => {
      const styles = getDevStyles("test-nonce");

      assert(styles.includes('<style nonce="test-nonce">'));
    });

    it("should include dev-indicator styles", () => {
      const styles = getDevStyles();

      assert(styles.includes(".dev-indicator"));
      assert(styles.includes("position: fixed"));
      assert(styles.includes("z-index:"));
    });

    it("should include dev-indicator-close styles", () => {
      const styles = getDevStyles();

      assert(styles.includes(".dev-indicator-close"));
      assert(styles.includes("cursor: pointer"));
    });

    it("should include error overlay styles", () => {
      const styles = getDevStyles();

      assert(styles.includes("#veryfront-error-overlay"));
      assert(styles.includes("position: fixed"));
    });

    it("should include custom animations", () => {
      const styles = getDevStyles();

      assert(styles.includes(".animate-bounce-delay-200"));
      assert(styles.includes(".animate-bounce-delay-400"));
      assert(styles.includes("@keyframes vf-bounce"));
    });

    it("should not include nonce for empty string", () => {
      const styles = getDevStyles("");

      assert(!styles.includes('nonce=""'));
    });
  });
});
