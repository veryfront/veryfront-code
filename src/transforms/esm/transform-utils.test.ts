import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLoaderFromPath, needsTransform } from "./transform-utils.ts";

describe("transforms/esm/transform-utils", () => {
  describe("getLoaderFromPath", () => {
    it("should return tsx for .tsx files", () => {
      assertEquals(getLoaderFromPath("pages/index.tsx"), "tsx");
    });

    it("should return ts for .ts files", () => {
      assertEquals(getLoaderFromPath("utils/helper.ts"), "ts");
    });

    it("should return jsx for .jsx files", () => {
      assertEquals(getLoaderFromPath("components/Button.jsx"), "jsx");
    });

    it("should return js for .js files", () => {
      assertEquals(getLoaderFromPath("lib/main.js"), "js");
    });

    it("should return jsx for .mdx files", () => {
      assertEquals(getLoaderFromPath("posts/hello.mdx"), "jsx");
    });

    it("should return jsx for .md files", () => {
      assertEquals(getLoaderFromPath("docs/readme.md"), "jsx");
    });

    it("should return css for .css files", () => {
      assertEquals(getLoaderFromPath("styles/main.css"), "css");
    });

    it("should return json for .json files", () => {
      assertEquals(getLoaderFromPath("config.json"), "json");
    });

    it("should default to tsx for unknown extensions", () => {
      assertEquals(getLoaderFromPath("file.unknown"), "tsx");
    });

    it("should default to tsx for files with no extension", () => {
      assertEquals(getLoaderFromPath("Makefile"), "tsx");
    });
  });

  describe("needsTransform", () => {
    it("should return true for .ts files", () => {
      assertEquals(needsTransform("file.ts"), true);
    });

    it("should return true for .tsx files", () => {
      assertEquals(needsTransform("file.tsx"), true);
    });

    it("should return true for .js files", () => {
      assertEquals(needsTransform("file.js"), true);
    });

    it("should return true for .jsx files", () => {
      assertEquals(needsTransform("file.jsx"), true);
    });

    it("should return true for .mdx files", () => {
      assertEquals(needsTransform("file.mdx"), true);
    });

    it("should return true for .md files", () => {
      assertEquals(needsTransform("file.md"), true);
    });

    it("should return false for .css files", () => {
      assertEquals(needsTransform("file.css"), false);
    });

    it("should return false for .json files", () => {
      assertEquals(needsTransform("file.json"), false);
    });

    it("should return false for files with no extension", () => {
      assertEquals(needsTransform("Makefile"), false);
    });
  });
});
