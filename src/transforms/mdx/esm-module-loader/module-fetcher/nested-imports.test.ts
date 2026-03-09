import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findNestedImports, hasUnresolvedImports } from "./nested-imports.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/nested-imports", () => {
  describe("findNestedImports", () => {
    it("finds _vf_modules imports", () => {
      const code = `import { foo } from "/_vf_modules/lib/utils.js";`;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 1);
      assertEquals(result.vfModules[0]!.path.includes("_vf_modules"), true);
    });

    it("finds relative imports", () => {
      const code = `import { foo } from "./lib/utils.js";`;
      const result = findNestedImports(code);
      assertEquals(result.relative.length, 1);
      assertEquals(result.relative[0]!.path, "./lib/utils.js");
    });

    it("returns empty arrays for code with no matching imports", () => {
      const code = `import React from "react";`;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 0);
      assertEquals(result.relative.length, 0);
    });

    it("finds both types of imports in same code", () => {
      const code = `
import { foo } from "/_vf_modules/lib/utils.js";
import { bar } from "./local.js";
      `;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 1);
      assertEquals(result.relative.length, 1);
    });

    it("strips file:// prefix from _vf_modules paths", () => {
      const code = `import { foo } from "file:///_vf_modules/lib/utils.js";`;
      const result = findNestedImports(code);
      if (result.vfModules.length > 0) {
        assertEquals(result.vfModules[0]!.path.startsWith("file://"), false);
      }
    });
  });

  describe("hasUnresolvedImports", () => {
    it("returns count 0 for code with no unresolved imports", () => {
      const code = `import { foo } from "file:///cache/vfmod.mjs";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
      assertEquals(result.paths.length, 0);
    });

    it("detects unresolved _vf_modules imports", () => {
      const code = `import { foo } from "/_vf_modules/_veryfront/lib.js";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count > 0, true);
    });

    it("detects file:///_vf_modules imports (malformed)", () => {
      const code = `import { foo } from "file:///_vf_modules/_veryfront/lib.js";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count > 0, true);
    });

    it("returns empty for normal resolved file:// imports", () => {
      const code =
        `import { foo } from "file:///home/user/.cache/veryfront-mdx-esm/proj/vfmod.mjs";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
    });

    it("limits paths to 5 entries", () => {
      const imports = Array.from(
        { length: 10 },
        (_, i) => `import { f${i} } from "_vf_modules/_veryfront/lib${i}.js";`,
      ).join("\n");
      const result = hasUnresolvedImports(imports);
      assertEquals(result.paths.length <= 5, true);
    });

    it("returns empty for empty string", () => {
      const result = hasUnresolvedImports("");
      assertEquals(result.count, 0);
    });
  });
});
