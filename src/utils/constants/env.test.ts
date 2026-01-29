import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isAnyDebugEnabled,
  isDebugEnabled,
  isDeepInspectEnabled,
  isTruthyEnvValue,
} from "./env.ts";

describe("constants/env", () => {
  describe("isTruthyEnvValue", () => {
    it("should return true for '1'", () => {
      assertEquals(isTruthyEnvValue("1"), true);
    });

    it("should return true for 'true'", () => {
      assertEquals(isTruthyEnvValue("true"), true);
    });

    it("should return true for 'yes'", () => {
      assertEquals(isTruthyEnvValue("yes"), true);
    });

    it("should be case-insensitive", () => {
      assertEquals(isTruthyEnvValue("TRUE"), true);
      assertEquals(isTruthyEnvValue("Yes"), true);
    });

    it("should handle whitespace", () => {
      assertEquals(isTruthyEnvValue("  true  "), true);
    });

    it("should return false for '0'", () => {
      assertEquals(isTruthyEnvValue("0"), false);
    });

    it("should return false for 'false'", () => {
      assertEquals(isTruthyEnvValue("false"), false);
    });

    it("should return false for empty string", () => {
      assertEquals(isTruthyEnvValue(""), false);
    });

    it("should return false for undefined", () => {
      assertEquals(isTruthyEnvValue(undefined), false);
    });

    it("should return false for arbitrary strings", () => {
      assertEquals(isTruthyEnvValue("maybe"), false);
    });
  });

  describe("isDebugEnabled", () => {
    it("should return true when VERYFRONT_DEBUG is truthy", () => {
      const env = { get: (key: string) => key === "VERYFRONT_DEBUG" ? "1" : undefined };
      assertEquals(isDebugEnabled(env), true);
    });

    it("should return false when VERYFRONT_DEBUG is not set", () => {
      const env = { get: () => undefined };
      assertEquals(isDebugEnabled(env), false);
    });
  });

  describe("isDeepInspectEnabled", () => {
    it("should return true when VERYFRONT_DEEP_INSPECT is truthy", () => {
      const env = { get: (key: string) => key === "VERYFRONT_DEEP_INSPECT" ? "true" : undefined };
      assertEquals(isDeepInspectEnabled(env), true);
    });

    it("should return false when not set", () => {
      const env = { get: () => undefined };
      assertEquals(isDeepInspectEnabled(env), false);
    });
  });

  describe("isAnyDebugEnabled", () => {
    it("should return true when debug is enabled", () => {
      const env = { get: (key: string) => key === "VERYFRONT_DEBUG" ? "1" : undefined };
      assertEquals(isAnyDebugEnabled(env), true);
    });

    it("should return true when deep inspect is enabled", () => {
      const env = { get: (key: string) => key === "VERYFRONT_DEEP_INSPECT" ? "1" : undefined };
      assertEquals(isAnyDebugEnabled(env), true);
    });

    it("should return false when neither is enabled", () => {
      const env = { get: () => undefined };
      assertEquals(isAnyDebugEnabled(env), false);
    });
  });
});
