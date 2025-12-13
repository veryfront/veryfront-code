import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { hasReactDOM, hasVeryFrontCache } from "./global-guards.ts";

describe("types/global-guards", () => {
  describe("hasReactDOM", () => {
    it("should return false for non-objects", () => {
      assertEquals(hasReactDOM(null), false);
      assertEquals(hasReactDOM(undefined), false);
      assertEquals(hasReactDOM(123), false);
      assertEquals(hasReactDOM("string"), false);
      assertEquals(hasReactDOM(true), false);
    });

    it("should return false for empty objects", () => {
      assertEquals(hasReactDOM({}), false);
    });

    it("should return false for objects without ReactDOM", () => {
      assertEquals(hasReactDOM({ other: "property" }), false);
    });

    it("should return false when ReactDOM is undefined", () => {
      assertEquals(hasReactDOM({ ReactDOM: undefined }), false);
    });

    it("should return true when ReactDOM is present", () => {
      assertEquals(hasReactDOM({ ReactDOM: {} }), true);
      assertEquals(hasReactDOM({ ReactDOM: { render: () => {} } }), true);
    });
  });

  describe("hasVeryFrontCache", () => {
    it("should return false for non-objects", () => {
      assertEquals(hasVeryFrontCache(null), false);
      assertEquals(hasVeryFrontCache(undefined), false);
      assertEquals(hasVeryFrontCache(123), false);
      assertEquals(hasVeryFrontCache("string"), false);
      assertEquals(hasVeryFrontCache(true), false);
    });

    it("should return false for empty objects", () => {
      assertEquals(hasVeryFrontCache({}), false);
    });

    it("should return false for objects without cache namespace", () => {
      assertEquals(hasVeryFrontCache({ other: "property" }), false);
    });

    it("should return true when cache namespace is present", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: "test" }), true);
    });

    it("should return true even when cache namespace is undefined", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: undefined }), true);
    });

    it("should return true even when cache namespace is empty string", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: "" }), true);
    });
  });

  describe("guard combinations", () => {
    it("should handle objects with both properties", () => {
      const obj = {
        ReactDOM: {},
        __VF_CACHE_NAMESPACE__: "test",
      };
      assertEquals(hasReactDOM(obj), true);
      assertEquals(hasVeryFrontCache(obj), true);
    });

    it("should handle objects with neither property", () => {
      const obj = { other: "value" };
      assertEquals(hasReactDOM(obj), false);
      assertEquals(hasVeryFrontCache(obj), false);
    });
  });
});
