import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  asBundleHash,
  asLocalModuleCode,
  assertLocal,
  assertPortable,
  CACHE_DIR_TOKEN,
} from "./http-cache-invariants.ts";

describe("transforms/esm/http-cache-invariants", () => {
  describe("CACHE_DIR_TOKEN", () => {
    it("is a non-empty string", () => {
      assertEquals(typeof CACHE_DIR_TOKEN, "string");
      assertEquals(CACHE_DIR_TOKEN.length > 0, true);
    });
  });

  describe("assertPortable", () => {
    it("does not throw for code without hardcoded paths", () => {
      const code =
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs";`;
      // Should not throw
      assertPortable(code as never);
    });

    it("does not throw for plain JavaScript code", () => {
      assertPortable("const x = 1;" as never);
    });
  });

  describe("assertLocal", () => {
    it("does not throw for code without tokens", () => {
      const code = `import foo from "file:///home/user/.cache/veryfront-http-bundle/http-123.mjs";`;
      assertLocal(code as never);
    });

    it("throws for code containing CACHE_DIR_TOKEN", () => {
      const code =
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs";`;
      let threw = false;
      try {
        assertLocal(code as never);
      } catch (_) {
        threw = true;
      }
      assertEquals(threw, true);
    });

    it("does not throw for plain JavaScript code", () => {
      assertLocal("const x = 1;" as never);
    });
  });

  describe("asBundleHash", () => {
    it("accepts numeric hash strings", () => {
      const hash = asBundleHash("12345");
      assertEquals(typeof hash, "string");
    });

    it("throws for non-numeric hash", () => {
      let threw = false;
      try {
        asBundleHash("abc-not-numeric");
      } catch (_) {
        threw = true;
      }
      assertEquals(threw, true);
    });

    it("throws for empty string", () => {
      let threw = false;
      try {
        asBundleHash("");
      } catch (_) {
        threw = true;
      }
      assertEquals(threw, true);
    });

    it("accepts large numeric strings", () => {
      const hash = asBundleHash("999999999999");
      assertEquals(typeof hash, "string");
    });
  });

  describe("asLocalModuleCode", () => {
    it("returns code as LocalModuleCode for valid local code", () => {
      const code = "const x = 1;";
      const result = asLocalModuleCode(code);
      assertEquals(typeof result, "string");
    });

    it("throws for code containing portable tokens", () => {
      const code = `import foo from "file://${CACHE_DIR_TOKEN}/test.mjs";`;
      let threw = false;
      try {
        asLocalModuleCode(code);
      } catch (_) {
        threw = true;
      }
      assertEquals(threw, true);
    });
  });
});
