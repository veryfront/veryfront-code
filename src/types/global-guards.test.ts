import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals } from "@veryfront/testing/assert";
import { hasReactDOM, hasVeryFrontCache } from "./global-guards.ts";

describe("global-guards", () => {
  describe("hasReactDOM", () => {
    it("should return false for null/undefined", () => {
      assertEquals(hasReactDOM(null), false);
      assertEquals(hasReactDOM(undefined), false);
    });

    it("should return false for non-object values", () => {
      assertEquals(hasReactDOM("string"), false);
      assertEquals(hasReactDOM(123), false);
      assertEquals(hasReactDOM(true), false);
    });

    it("should return false for object without ReactDOM", () => {
      assertEquals(hasReactDOM({}), false);
      assertEquals(hasReactDOM({ other: "value" }), false);
    });

    it("should return false for object with undefined ReactDOM", () => {
      assertEquals(hasReactDOM({ ReactDOM: undefined }), false);
    });

    it("should return true for object with ReactDOM property", () => {
      const mockReactDOM = { createRoot: () => {} };
      assertEquals(hasReactDOM({ ReactDOM: mockReactDOM }), true);
    });
  });

  describe("hasVeryFrontCache", () => {
    it("should return false for null/undefined", () => {
      assertEquals(hasVeryFrontCache(null), false);
      assertEquals(hasVeryFrontCache(undefined), false);
    });

    it("should return false for non-object values", () => {
      assertEquals(hasVeryFrontCache("string"), false);
      assertEquals(hasVeryFrontCache(123), false);
      assertEquals(hasVeryFrontCache(true), false);
    });

    it("should return false for object without __VF_CACHE_NAMESPACE__", () => {
      assertEquals(hasVeryFrontCache({}), false);
      assertEquals(hasVeryFrontCache({ other: "value" }), false);
    });

    it("should return true for object with __VF_CACHE_NAMESPACE__ property", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: "test" }), true);
    });

    it("should return true even if __VF_CACHE_NAMESPACE__ is undefined", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: undefined }), true);
    });
  });
});
