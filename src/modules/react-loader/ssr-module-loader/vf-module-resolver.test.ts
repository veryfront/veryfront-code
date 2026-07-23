import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findVfModuleImports } from "./vf-module-resolver.ts";

describe("modules/react-loader/ssr-module-loader/vf-module-resolver", () => {
  describe("findVfModuleImports", () => {
    it("finds /_vf_modules imports and normalizes paths", async () => {
      const code = [
        `import a from "/_vf_modules/react@18/index.js";`,
        `import b from "file:///_vf_modules/lodash@4/chunk.js";`,
      ].join("\n");

      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js",
          path: "_vf_modules/react@18/index.js",
        },
        {
          specifier: "file:///_vf_modules/lodash@4/chunk.js",
          path: "_vf_modules/lodash@4/chunk.js",
        },
      ]);
    });

    it("strips query params from normalized paths", async () => {
      const code = `import a from "/_vf_modules/react@18/index.js?ssr=true";`;
      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js?ssr=true",
          path: "_vf_modules/react@18/index.js",
        },
      ]);
    });

    it("does not match import-looking text in strings or comments", async () => {
      const code = `
        const text = 'from "/_vf_modules/react@18/index.js"';
        // import a from "/_vf_modules/commented.js";
      `;
      assertEquals(await findVfModuleImports(code), []);
    });

    it("returns empty array when code has no /_vf_modules imports", async () => {
      const code = `import x from "./local.js";`;
      assertEquals(await findVfModuleImports(code), []);
    });

    it("rejects traversal-shaped runtime module paths", async () => {
      const code = [
        `import a from "/_vf_modules/../secret.js";`,
        `import b from "/_vf_modules/%2e%2e/secret.js";`,
      ].join("\n");
      assertEquals(await findVfModuleImports(code), []);
    });

    it("rejects runtime module specifiers whose query makes them oversized", async () => {
      const code = 'import a from "/_vf_modules/react/index.js?' + "x".repeat(8_200) + '";';
      assertEquals(await findVfModuleImports(code), []);
    });

    it("deduplicates identical runtime module imports", async () => {
      const code = [
        `import a from "/_vf_modules/react@18/index.js";`,
        `import b from "/_vf_modules/react@18/index.js";`,
      ].join("\n");
      assertEquals(await findVfModuleImports(code), [
        {
          specifier: "/_vf_modules/react@18/index.js",
          path: "_vf_modules/react@18/index.js",
        },
      ]);
    });
  });
});
