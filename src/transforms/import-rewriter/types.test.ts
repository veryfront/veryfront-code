import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  classifySpecifier,
  isBareSpecifier,
  isReactSpecifier,
  isRelativeSpecifier,
  isUrlSpecifier,
} from "./types.ts";

describe("transforms/import-rewriter/types", () => {
  describe("classifySpecifier", () => {
    const cases: Array<[string, ReturnType<typeof classifySpecifier>]> = [
      ["react", "react"],
      ["react-dom", "react"],
      ["react/jsx-runtime", "react"],
      ["react-dom/client", "react"],
      ["https://esm.sh/lodash", "url"],
      ["http://cdn.com/lib.js", "url"],
      ["#veryfront/utils", "veryfront"],
      ["veryfront/client", "veryfront"],
      ["@/components/Button", "alias"],
      ["./utils", "relative"],
      ["../lib/helper", "relative"],
      ["myproject@1.0.0/@/components", "cross-project"],
      ["lodash", "bare"],
      ["@tanstack/react-query", "bare"],
    ];

    for (const [specifier, expected] of cases) {
      it(`should classify '${specifier}' as ${expected}`, () => {
        assertEquals(classifySpecifier(specifier), expected);
      });
    }
  });

  describe("isReactSpecifier", () => {
    it("should return true for react", () => {
      assertEquals(isReactSpecifier("react"), true);
    });

    it("should return false for lodash", () => {
      assertEquals(isReactSpecifier("lodash"), false);
    });
  });

  describe("isRelativeSpecifier", () => {
    it("should return true for ./foo", () => {
      assertEquals(isRelativeSpecifier("./foo"), true);
    });

    it("should return false for react", () => {
      assertEquals(isRelativeSpecifier("react"), false);
    });
  });

  describe("isBareSpecifier", () => {
    it("should return true for lodash", () => {
      assertEquals(isBareSpecifier("lodash"), true);
    });

    it("should return false for ./foo", () => {
      assertEquals(isBareSpecifier("./foo"), false);
    });
  });

  describe("isUrlSpecifier", () => {
    it("should return true for https URLs", () => {
      assertEquals(isUrlSpecifier("https://esm.sh/react"), true);
    });

    it("should return false for bare specifiers", () => {
      assertEquals(isUrlSpecifier("lodash"), false);
    });
  });
});
