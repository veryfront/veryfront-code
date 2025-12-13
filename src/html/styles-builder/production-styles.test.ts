import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getProductionStyles } from "./production-styles.ts";

describe("production-styles", () => {
  describe("getProductionStyles", () => {
    it("should return CSS style tag", () => {
      const styles = getProductionStyles();

      assert(styles.includes("<style>"));
      assert(styles.includes("</style>"));
    });

    it("should include nonce attribute if provided", () => {
      const styles = getProductionStyles("test-nonce");

      assert(styles.includes('<style nonce="test-nonce">'));
    });

    it("should include body reset styles", () => {
      const styles = getProductionStyles();

      assert(styles.includes("body {"));
      assert(styles.includes("margin: 0"));
    });

    it("should include prose styles", () => {
      const styles = getProductionStyles();

      assert(styles.includes(".prose"));
      assert(styles.includes("max-width: 65ch"));
    });

    it("should include container styles", () => {
      const styles = getProductionStyles();

      assert(styles.includes(".container"));
      assert(styles.includes("margin-right: auto"));
    });

    it("should include responsive breakpoints", () => {
      const styles = getProductionStyles();

      assert(styles.includes("@media (min-width:"));
    });

    it("should include utility classes", () => {
      const styles = getProductionStyles();

      assert(styles.includes(".mx-auto"));
      assert(styles.includes(".px-4"));
      assert(styles.includes(".py-8"));
      assert(styles.includes(".max-w-4xl"));
    });

    it("should not include nonce for empty string", () => {
      const styles = getProductionStyles("");

      assert(!styles.includes('nonce=""'));
    });
  });
});
