import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { isValidSecurityConfig } from "./config-loader.ts";

describe("security/http/middleware/config-loader", () => {
  describe("isValidSecurityConfig", () => {
    it("should return false for null/undefined", () => {
      assertEquals(isValidSecurityConfig(null), false);
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

    it("should validate csp", () => {
      assertEquals(
        isValidSecurityConfig({ csp: { "default-src": "'self'" } }),
        true,
      );
      assertEquals(isValidSecurityConfig({ csp: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ csp: null }), false);
    });

    it("should validate cors", () => {
      assertEquals(isValidSecurityConfig({ cors: true }), true);
      assertEquals(isValidSecurityConfig({ cors: false }), true);
      assertEquals(isValidSecurityConfig({ cors: { origin: "*" } }), true);

      assertEquals(isValidSecurityConfig({ cors: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ cors: 123 }), false);
      assertEquals(isValidSecurityConfig({ cors: null }), false);
    });

    it("should validate coop", () => {
      assertEquals(isValidSecurityConfig({ coop: "same-origin" }), true);
      assertEquals(isValidSecurityConfig({ coop: 123 }), false);
    });

    it("should validate corp", () => {
      assertEquals(isValidSecurityConfig({ corp: "same-origin" }), true);
      assertEquals(isValidSecurityConfig({ corp: true }), false);
    });

    it("should validate coep", () => {
      assertEquals(isValidSecurityConfig({ coep: "require-corp" }), true);
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
