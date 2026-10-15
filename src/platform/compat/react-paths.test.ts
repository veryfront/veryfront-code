import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isReactSpecifier } from "./react-paths.ts";
describe("isReactSpecifier", () => {
  const cases: Array<[string, boolean]> = [
    ["react", true],
    ["react-dom", true],
    ["react/jsx-runtime", true],
    ["react/jsx-dev-runtime", true],
    ["react-dom/client", true],
    ["react-dom/server", true],
    ["vue", false],
    ["preact", false],
    ["react-query", false],
    ["", false],
    ["@react-spring/core", false],
  ];

  for (const [specifier, expected] of cases) {
    it(`should return ${expected} for '${specifier}'`, () => {
      assertEquals(isReactSpecifier(specifier), expected);
    });
  }
});
describe("isReactSpecifier edge cases", () => {
  it("should return true for react-dom/* subpaths", () => {
    assertEquals(isReactSpecifier("react-dom/test-utils"), true);
  });

  it("should return true for react/* subpaths", () => {
    assertEquals(isReactSpecifier("react/compiler"), true);
  });

  it("should return false for react-native", () => {
    assertEquals(isReactSpecifier("react-native"), false);
  });
});
