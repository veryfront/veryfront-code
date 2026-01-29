import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearReactPathsCache, getLocalReactPaths, isReactSpecifier } from "./react-paths.ts";

describe("react-paths", () => {
  describe("isReactSpecifier", () => {
    it("should return true for 'react'", () => {
      assertEquals(isReactSpecifier("react"), true);
    });

    it("should return true for 'react-dom'", () => {
      assertEquals(isReactSpecifier("react-dom"), true);
    });

    it("should return true for 'react/jsx-runtime'", () => {
      assertEquals(isReactSpecifier("react/jsx-runtime"), true);
    });

    it("should return true for 'react/jsx-dev-runtime'", () => {
      assertEquals(isReactSpecifier("react/jsx-dev-runtime"), true);
    });

    it("should return true for 'react-dom/client'", () => {
      assertEquals(isReactSpecifier("react-dom/client"), true);
    });

    it("should return true for 'react-dom/server'", () => {
      assertEquals(isReactSpecifier("react-dom/server"), true);
    });

    it("should return false for 'vue'", () => {
      assertEquals(isReactSpecifier("vue"), false);
    });

    it("should return false for 'preact'", () => {
      assertEquals(isReactSpecifier("preact"), false);
    });

    it("should return false for 'react-query'", () => {
      assertEquals(isReactSpecifier("react-query"), false);
    });

    it("should return false for empty string", () => {
      assertEquals(isReactSpecifier(""), false);
    });

    it("should return false for '@react-spring/core'", () => {
      assertEquals(isReactSpecifier("@react-spring/core"), false);
    });
  });

  describe("getLocalReactPaths", () => {
    it("should return an empty object on Deno", () => {
      // On Deno, returns empty because Deno uses esm.sh URLs
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
      assertEquals(Object.keys(paths).length, 0);
    });
  });

  describe("clearReactPathsCache", () => {
    it("should not throw when clearing cache", () => {
      clearReactPathsCache();
      // Should still return valid result after clearing
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });
  });
});
