import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLoaderFromPath, needsTransform } from "./transform-utils.ts";

describe("transforms/esm/transform-utils", () => {
  describe("getLoaderFromPath", () => {
    const cases: Array<[string, string]> = [
      ["pages/index.tsx", "tsx"],
      ["utils/helper.ts", "ts"],
      ["components/Button.jsx", "jsx"],
      ["lib/main.js", "js"],
      ["posts/hello.mdx", "jsx"],
      ["docs/readme.md", "jsx"],
      ["styles/main.css", "css"],
      ["config.json", "json"],
      ["file.unknown", "tsx"],
      ["Makefile", "tsx"],
    ];

    for (const [path, expected] of cases) {
      it(`should return ${expected} for ${path}`, () => {
        assertEquals(getLoaderFromPath(path), expected);
      });
    }
  });

  describe("needsTransform", () => {
    const cases: Array<[string, boolean]> = [
      ["file.ts", true],
      ["file.tsx", true],
      ["file.js", true],
      ["file.jsx", true],
      ["file.mdx", true],
      ["file.md", true],
      ["file.css", false],
      ["file.json", false],
      ["Makefile", false],
    ];

    for (const [path, expected] of cases) {
      it(`should return ${expected} for ${path}`, () => {
        assertEquals(needsTransform(path), expected);
      });
    }
  });
});
