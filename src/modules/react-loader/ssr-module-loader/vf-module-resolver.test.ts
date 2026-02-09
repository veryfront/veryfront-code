import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findVfModuleImports } from "./vf-module-resolver.ts";

describe("modules/react-loader/ssr-module-loader/vf-module-resolver", () => {
  describe("findVfModuleImports", () => {
    it("finds /_vf_modules imports and normalizes paths", () => {
      const code = [
        `import a from "/_vf_modules/react@18/index.js";`,
        `import b from "file:///_vf_modules/lodash@4/chunk.js";`,
      ].join("\n");

      assertEquals(findVfModuleImports(code), [
        {
          original: `from "/_vf_modules/react@18/index.js"`,
          path: "_vf_modules/react@18/index.js",
        },
        {
          original: `from "file:///_vf_modules/lodash@4/chunk.js"`,
          path: "_vf_modules/lodash@4/chunk.js",
        },
      ]);
    });

    it("returns empty array when code has no /_vf_modules imports", () => {
      const code = `import x from "./local.js";`;
      assertEquals(findVfModuleImports(code), []);
    });
  });
});
