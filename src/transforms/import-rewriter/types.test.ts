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
    it("should classify 'react' as react", () => {
      assertEquals(classifySpecifier("react"), "react");
    });

    it("should classify 'react-dom' as react", () => {
      assertEquals(classifySpecifier("react-dom"), "react");
    });

    it("should classify 'react/jsx-runtime' as react", () => {
      assertEquals(classifySpecifier("react/jsx-runtime"), "react");
    });

    it("should classify 'react-dom/client' as react", () => {
      assertEquals(classifySpecifier("react-dom/client"), "react");
    });

    it("should classify https URLs as url", () => {
      assertEquals(classifySpecifier("https://esm.sh/lodash"), "url");
    });

    it("should classify http URLs as url", () => {
      assertEquals(classifySpecifier("http://cdn.com/lib.js"), "url");
    });

    it("should classify #veryfront/ as veryfront", () => {
      assertEquals(classifySpecifier("#veryfront/utils"), "veryfront");
    });

    it("should classify veryfront/ as veryfront", () => {
      assertEquals(classifySpecifier("veryfront/client"), "veryfront");
    });

    it("should classify @veryfront/ as veryfront", () => {
      assertEquals(classifySpecifier("@veryfront/sdk"), "veryfront");
    });

    it("should classify @/ as alias", () => {
      assertEquals(classifySpecifier("@/components/Button"), "alias");
    });

    it("should classify ./ as relative", () => {
      assertEquals(classifySpecifier("./utils"), "relative");
    });

    it("should classify ../ as relative", () => {
      assertEquals(classifySpecifier("../lib/helper"), "relative");
    });

    it("should classify cross-project imports", () => {
      assertEquals(classifySpecifier("myproject@1.0.0/@/components"), "cross-project");
    });

    it("should classify bare specifiers", () => {
      assertEquals(classifySpecifier("lodash"), "bare");
    });

    it("should classify scoped packages as bare", () => {
      assertEquals(classifySpecifier("@tanstack/react-query"), "bare");
    });
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
