import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { isValidSecurityConfig } from "./config-loader.ts";

describe("security/http/middleware/config-loader", () => {
  describe("isValidSecurityConfig", () => {
    it("should return false for null", () => {
      assertEquals(isValidSecurityConfig(null), false);
    });

    it("should return false for undefined", () => {
      assertEquals(isValidSecurityConfig(undefined), false);
    });

    it("should return false for a non-object", () => {
      assertEquals(isValidSecurityConfig("string"), false);
      assertEquals(isValidSecurityConfig(123), false);
      assertEquals(isValidSecurityConfig(true), false);
    });

    it("should return true for an empty object", () => {
      assertEquals(isValidSecurityConfig({}), true);
    });

    it("should return true for valid csp object", () => {
      assertEquals(
        isValidSecurityConfig({ csp: { "default-src": "'self'" } }),
        true,
      );
    });

    it("should return false for invalid csp (non-object)", () => {
      assertEquals(isValidSecurityConfig({ csp: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ csp: null }), false);
    });

    it("should return true for cors = true", () => {
      assertEquals(isValidSecurityConfig({ cors: true }), true);
    });

    it("should return true for cors = false", () => {
      assertEquals(isValidSecurityConfig({ cors: false }), true);
    });

    it("should return true for cors as object", () => {
      assertEquals(
        isValidSecurityConfig({ cors: { origin: "*" } }),
        true,
      );
    });

    it("should return false for cors as non-boolean non-object", () => {
      assertEquals(isValidSecurityConfig({ cors: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ cors: 123 }), false);
    });

    it("should return false for cors = null", () => {
      assertEquals(isValidSecurityConfig({ cors: null }), false);
    });

    it("should return true for valid coop string", () => {
      assertEquals(isValidSecurityConfig({ coop: "same-origin" }), true);
    });

    it("should return false for non-string coop", () => {
      assertEquals(isValidSecurityConfig({ coop: 123 }), false);
    });

    it("should return true for valid corp string", () => {
      assertEquals(isValidSecurityConfig({ corp: "same-origin" }), true);
    });

    it("should return false for non-string corp", () => {
      assertEquals(isValidSecurityConfig({ corp: true }), false);
    });

    it("should return true for valid coep string", () => {
      assertEquals(isValidSecurityConfig({ coep: "require-corp" }), true);
    });

    it("should return false for non-string coep", () => {
      assertEquals(isValidSecurityConfig({ coep: [] }), false);
    });

    it("should return true for a full valid config", () => {
      assertEquals(
        isValidSecurityConfig({
          cors: true,
          csp: { "default-src": "'self'" },
          coop: "same-origin",
          corp: "same-origin",
          coep: "require-corp",
        }),
        true,
      );
    });
  });
});
