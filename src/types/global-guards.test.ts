import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { hasReactDOM, hasVeryFrontCache } from "./global-guards.ts";

function getCreateRoot(global: unknown) {
  if (!hasReactDOM(global)) return undefined;
  return global.ReactDOM.createRoot;
}

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

    it("should return false when ReactDOM does not expose createRoot", () => {
      assertEquals(hasReactDOM({ ReactDOM: 1 }), false);
      assertEquals(hasReactDOM({ ReactDOM: {} }), false);
      assertEquals(hasReactDOM({ ReactDOM: { createRoot: "invalid" } }), false);
    });

    it("fails closed when global properties cannot be inspected", () => {
      const unreadableGlobal = new Proxy({}, {
        get() {
          throw new Error("outer proxy detail");
        },
      });
      const unreadableReactDOM = new Proxy({}, {
        get() {
          throw new Error("nested proxy detail");
        },
      });

      assertEquals(hasReactDOM(unreadableGlobal), false);
      assertEquals(hasReactDOM({ ReactDOM: unreadableReactDOM }), false);
    });

    it("does not invoke ReactDOM accessors while checking capabilities", () => {
      let globalReads = 0;
      let createRootReads = 0;
      const accessorGlobal = Object.defineProperty({}, "ReactDOM", {
        get() {
          globalReads++;
          return { createRoot: () => {} };
        },
      });
      const accessorReactDOM = Object.defineProperty({}, "createRoot", {
        get() {
          createRootReads++;
          return () => {};
        },
      });

      assertEquals(hasReactDOM(accessorGlobal), false);
      assertEquals(hasReactDOM({ ReactDOM: accessorReactDOM }), false);
      assertEquals(globalReads, 0);
      assertEquals(createRootReads, 0);
    });

    it("narrows ReactDOM to the usable client contract", () => {
      const createRoot = () => {};

      assertEquals(typeof getCreateRoot({ ReactDOM: { createRoot } }), "function");
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

    it("should return false for a non-string cache namespace", () => {
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: 123 }), false);
      assertEquals(hasVeryFrontCache({ __VF_CACHE_NAMESPACE__: null }), false);
    });

    it("requires an own cache namespace property", () => {
      const inherited = Object.create({ __VF_CACHE_NAMESPACE__: "shared" });

      assertEquals(hasVeryFrontCache(inherited), false);
    });

    it("fails closed when the cache namespace cannot be inspected", () => {
      const unreadableGlobal = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor proxy detail");
        },
      });

      assertEquals(hasVeryFrontCache(unreadableGlobal), false);
    });

    it("does not invoke a cache namespace accessor", () => {
      let accessorReads = 0;
      const accessorGlobal = Object.defineProperty({}, "__VF_CACHE_NAMESPACE__", {
        get() {
          accessorReads++;
          return "unsafe";
        },
      });

      assertEquals(hasVeryFrontCache(accessorGlobal), false);
      assertEquals(accessorReads, 0);
    });
  });
});
