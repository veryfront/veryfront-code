import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findVfModuleImports } from "./loader-helpers.ts";

describe("transforms/mdx/esm-module-loader/loader-helpers", () => {
  describe("findVfModuleImports", () => {
    it("finds _vf_modules imports with leading slash", () => {
      const code = `import { foo } from "/_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
    });

    it("finds _vf_modules imports without leading slash", () => {
      const code = `import { foo } from "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
    });

    it("finds multiple imports", () => {
      const code = `
import { foo } from "_vf_modules/lib/utils.js";
import { bar } from "/_vf_modules/components/Button.js";
      `;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 2);
    });

    it("returns empty for code with no _vf_modules imports", () => {
      const code = `import React from "react";`;
      assertEquals(findVfModuleImports(code), []);
    });

    it("returns empty for empty string", () => {
      assertEquals(findVfModuleImports(""), []);
    });

    it("captures the original match text", () => {
      const code = `import { foo } from "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result[0]!.original.includes("from"), true);
    });

    it("handles single-quoted imports", () => {
      const code = `import { foo } from '_vf_modules/lib/utils.js';`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
    });
  });
});
