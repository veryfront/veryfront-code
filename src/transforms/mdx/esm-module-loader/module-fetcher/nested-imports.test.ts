import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findNestedImports,
  hasUnresolvedImports,
  resolveNestedImportBase,
  resolveNestedModuleImports,
} from "./nested-imports.ts";

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

    it("does not count import-looking text in strings or comments", () => {
      const code = [
        `const text = 'from "/_vf_modules/_veryfront/lib.js"';`,
        `// import { foo } from "/_vf_modules/_veryfront/commented.js";`,
      ].join("\n");
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
      assertEquals(result.paths, []);
    });
  });

  describe("resolveNestedModuleImports", () => {
    it("resolves vf module imports before relative imports", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `import { shared } from "/_vf_modules/lib/shared.js";`,
          `import local from "./local.js";`,
          `export { shared, local };`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/lib/shared.js", parent: "_vf_modules/pages/index.js" },
        { path: "./local.js", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          `import { shared } from "file:///cache/_vf_modules__lib__shared.js.mjs";`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { shared, local };`,
        ].join("\n"),
      );
    });

    it("rewrites the matched import instead of the same text in an earlier comment", async () => {
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `// Previous example: from "./local.js"`,
          `import local from "./local.js";`,
          `export { local };`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
      });

      assertEquals(
        result,
        [
          `// Previous example: from "./local.js"`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { local };`,
        ].join("\n"),
      );
    });
  });

  describe("resolveNestedImportBase", () => {
    // A barrel lives at lib/index.ts but is addressed as _vf_modules/lib.
    // Resolving its children against "_vf_modules/lib.js" drops the "lib"
    // segment, so ./constants.js resolved to _vf_modules/constants.js, one
    // directory too high. The file was then stubbed and the barrel silently
    // stopped re-exporting: "does not provide an export named 'COLORS'".
    it("keeps the directory segment for an index module", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib.js", "/project/lib/index.ts"),
        "_vf_modules/lib/index.js",
      );
      assertEquals(
        resolveNestedImportBase("_vf_modules/components.js", "/project/components/index.tsx"),
        "_vf_modules/components/index.js",
      );
    });

    it("leaves a plain module untouched", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/constants.js", "/project/lib/constants.ts"),
        "_vf_modules/lib/constants.js",
      );
    });

    it("does not double up when the path already names index", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index.js", "/project/lib/index.ts"),
        "_vf_modules/lib/index.js",
      );
    });

    // The import rewriter preserves .mdx specifiers rather than rewriting them
    // to .js, so an index module can reach here still carrying its source
    // extension. Appending another /index.js invents a directory that has no
    // file under it, and every relative import inside that page then 500s.
    it("does not double up when the path names index with a source extension", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/posts/index.mdx", "/project/posts/index.mdx"),
        "_vf_modules/posts/index.mdx",
      );
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index.ts", "/project/lib/index.ts"),
        "_vf_modules/lib/index.ts",
      );
    });

    it("is a no-op without a resolved file path", () => {
      assertEquals(resolveNestedImportBase("_vf_modules/lib.js"), "_vf_modules/lib.js");
    });

    it("does not treat a file merely named index-something as an index module", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib.js", "/project/lib/indexer.ts"),
        "_vf_modules/lib.js",
      );
    });

    // Which extensions arrive depends on the resolver: the project adapter
    // resolves .md and .mdx alongside the script extensions, and each of those
    // is a transformable module. All of them are their directory's index.
    it("recognises an index file whatever extension it carries", () => {
      for (const ext of ["ts", "tsx", "js", "jsx", "mdx", "md"]) {
        assertEquals(
          resolveNestedImportBase("_vf_modules/lib.js", `/project/lib/index.${ext}`),
          "_vf_modules/lib/index.js",
          ext,
        );
      }
    });

    it("keeps an extensionless index path as it is", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index", "/project/lib/index.ts"),
        "_vf_modules/lib/index",
      );
    });
  });
});
