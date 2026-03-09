import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeVendorExportName } from "./vendor-export-name.ts";

describe("transforms/shared/vendor-export-name", () => {
  describe("sanitizeVendorExportName", () => {
    const table: [string, string, string][] = [
      ["simple package", "react", "react"],
      ["hyphenated package", "react-dom", "reactDom"],
      ["scoped package", "@tanstack/react-query", "tanstackReactQuery"],
      ["scoped with hyphens", "@my-org/my-lib", "myOrgMyLib"],
      ["slashed package", "lodash/fp", "lodashFp"],
      ["multiple hyphens", "a-b-c-d", "aBCD"],
      ["leading @", "@scope/name", "scopeName"],
      ["underscores (camelCase)", "my_lib", "myLib"],
      ["empty string", "", ""],
      ["just @", "@", ""],
      ["single char", "x", "x"],
      ["already camelCase-ish", "myLib", "myLib"],
    ];

    for (const [label, input, expected] of table) {
      it(`handles ${label}: "${input}" → "${expected}"`, () => {
        assertEquals(sanitizeVendorExportName(input), expected);
      });
    }
  });
});
