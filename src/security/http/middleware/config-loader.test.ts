import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { isValidSecurityConfig } from "./config-loader.ts";

describe("isValidSecurityConfig", () => {
  it("should return false for null", () => {
    assertEquals(isValidSecurityConfig(null), false);
  });

  it("should return false for undefined", () => {
    assertEquals(isValidSecurityConfig(undefined), false);
  });

  it("should return false for non-object types", () => {
    assertEquals(isValidSecurityConfig("string"), false);
    assertEquals(isValidSecurityConfig(123), false);
    assertEquals(isValidSecurityConfig(true), false);
  });

  it("should return true for empty object", () => {
    assertEquals(isValidSecurityConfig({}), true);
  });

  it("should validate csp as object", () => {
    assertEquals(isValidSecurityConfig({ csp: {} }), true);
    assertEquals(isValidSecurityConfig({ csp: "invalid" }), false);
    assertEquals(isValidSecurityConfig({ csp: 123 }), false);
  });

  it("should validate cors as boolean or object", () => {
    assertEquals(isValidSecurityConfig({ cors: true }), true);
    assertEquals(isValidSecurityConfig({ cors: false }), true);
    assertEquals(isValidSecurityConfig({ cors: {} }), true);
    assertEquals(isValidSecurityConfig({ cors: "invalid" }), false);
  });

  it("should validate coop as string", () => {
    assertEquals(isValidSecurityConfig({ coop: "same-origin" }), true);
    assertEquals(isValidSecurityConfig({ coop: 123 }), false);
    assertEquals(isValidSecurityConfig({ coop: {} }), false);
  });

  it("should validate corp as string", () => {
    assertEquals(isValidSecurityConfig({ corp: "same-origin" }), true);
    assertEquals(isValidSecurityConfig({ corp: 123 }), false);
  });

  it("should validate coep as string", () => {
    assertEquals(isValidSecurityConfig({ coep: "require-corp" }), true);
    assertEquals(isValidSecurityConfig({ coep: false }), false);
  });

  it("should handle multiple valid fields", () => {
    const config = {
      csp: {},
      cors: true,
      coop: "same-origin",
      corp: "cross-origin",
      coep: "require-corp",
    };
    assertEquals(isValidSecurityConfig(config), true);
  });

  it("should reject if any field is invalid", () => {
    const config = {
      csp: {},
      cors: true,
      coop: 123, // invalid
    };
    assertEquals(isValidSecurityConfig(config), false);
  });

  it("should allow undefined optional fields", () => {
    const config = {
      csp: undefined,
      cors: undefined,
      coop: undefined,
    };
    assertEquals(isValidSecurityConfig(config), true);
  });

  it("should handle extra unknown fields", () => {
    const config = {
      csp: {},
      unknownField: "value",
    };
    assertEquals(isValidSecurityConfig(config), true);
  });
});
