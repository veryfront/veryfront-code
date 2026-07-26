import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  rewriteBodyImports,
  rewriteCompiledImports,
  rewriteImportSpecifier,
} from "./import-rewriter.ts";
import type { ImportRewriterConfig } from "./import-rewriter.ts";

describe("transforms/mdx/compiler/import-rewriter", () => {
  describe("rewriteImportSpecifier", () => {
    it("encodes filesystem paths as valid file URLs", () => {
      const result = rewriteImportSpecifier("./my component.tsx", {
        filePath: "/project/app/page.mdx",
        target: "server",
      });

      assertStringIncludes(result, "file://");
      assertStringIncludes(result, "/project/app/my%20component.tsx");
    });

    it("rejects malformed file URLs instead of remapping them as paths", () => {
      assertThrows(
        () =>
          rewriteImportSpecifier("file://%", {
            filePath: "/project/app/page.mdx",
            target: "server",
          }),
        TypeError,
      );
    });

    it("resolves root-relative project imports against projectDir", () => {
      const result = rewriteImportSpecifier("/components/Button.tsx", {
        filePath: "/project/pages/page.mdx",
        projectDir: "/project",
        target: "server",
      });

      assertEquals(result, "file:///project/components/Button.tsx");
    });

    it("preserves query and fragment suffixes on local module specifiers", () => {
      const result = rewriteImportSpecifier("./Button.tsx?client#preview", {
        filePath: "/project/pages/page.mdx",
        target: "server",
      });

      assertEquals(result, "file:///project/pages/Button.tsx?client#preview");
    });

    it("resolves relative filePath hints from projectDir", () => {
      const result = rewriteImportSpecifier("./Button.tsx", {
        filePath: "pages/page.mdx",
        projectDir: "/project",
        target: "server",
      });

      assertEquals(result, "file:///project/pages/Button.tsx");
    });

    it("joins browser filesystem URLs without duplicate path separators", () => {
      const result = rewriteImportSpecifier("./Button.tsx", {
        filePath: "/project/pages/page.mdx",
        target: "browser",
        baseUrl: "https://cdn.example.com/",
      });

      assertStringIncludes(result, "https://cdn.example.com/_veryfront/fs/");
    });

    it("normalizes source extensions in browser alias imports", () => {
      const result = rewriteImportSpecifier("@/components/Button.tsx?client", {
        filePath: "/project/pages/page.mdx",
        target: "browser",
        baseUrl: "https://cdn.example.com/",
      });

      assertEquals(
        result,
        "https://cdn.example.com/_vf_modules/components/Button.js?client",
      );
    });
  });

  describe("rewriteBodyImports", () => {
    it("rewrites relative import for SSR", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `import { foo } from "./utils.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("file://"), true);
    });

    it("rewrites relative import for browser", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
      };
      const body = `import { foo } from "./utils.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("/_veryfront/fs/"), true);
    });

    it("leaves bare imports unchanged", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `import React from "react";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result, `import React from "react";`);
    });

    it("rewrites @/ alias for browser", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
      };
      const body = `import { Button } from "@/components/Button";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("/_vf_modules/components/Button.js"), true);
    });

    it("leaves @/ alias unchanged for SSR", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `import { Button } from "@/components/Button";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("@/components/Button"), true);
    });

    it("does not touch non-import lines", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `const x = 1;\nimport React from "react";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("const x = 1;"), true);
    });

    it("handles export from statement", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `export { foo } from "./utils.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("file://"), true);
    });

    it("uses baseUrl for browser mode", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
        baseUrl: "https://cdn.example.com",
      };
      const body = `import { foo } from "./utils.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("https://cdn.example.com"), true);
    });

    it("handles empty body", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      assertEquals(rewriteBodyImports("", config), "");
    });

    it("rewrites multiline destructured import for SSR", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = `import {\n  Foo,\n  Bar\n} from "./utils.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("file://"), true);
      // The from specifier must be rewritten; Foo/Bar bindings are preserved
      assertEquals(result.includes("Foo"), true);
      assertEquals(result.includes("Bar"), true);
      assertEquals(result.includes("./utils.js"), false);
    });

    it("rewrites multiline destructured import for browser", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
      };
      const body = `import {\n  Alpha,\n  Beta\n} from "./components.js";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("/_veryfront/fs/"), true);
      assertEquals(result.includes("Alpha"), true);
      assertEquals(result.includes("Beta"), true);
    });

    it("rewrites multiple imports where one is multiline", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const body = [
        `import { A } from "./a.js";`,
        `import {`,
        `  B,`,
        `  C`,
        `} from "./bc.js";`,
        `const x = A;`,
      ].join("\n");
      const result = rewriteBodyImports(body, config);
      // Both imports must be rewritten
      assertEquals(result.includes("./a.js"), false);
      assertEquals(result.includes("./bc.js"), false);
      assertEquals(result.split("file://").length - 1 >= 2, true);
      assertEquals(result.includes("const x = A"), true);
    });
  });

  describe("rewriteCompiledImports", () => {
    it("rewrites @/ imports for browser", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
      };
      const code = `const x = require;from "@/components/Button"`;
      const result = rewriteCompiledImports(code, config);
      assertEquals(result.includes("/_vf_modules/"), true);
    });

    it("rewrites relative from imports for SSR", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "server",
      };
      const code = `from "./utils.js"`;
      const result = rewriteCompiledImports(code, config);
      assertEquals(result.includes("file://"), true);
    });

    it("rewrites file:// imports for browser", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "browser",
      };
      const code = `from "file:///project/app/utils.js"`;
      const result = rewriteCompiledImports(code, config);
      assertEquals(result.includes("/_veryfront/fs/"), true);
    });
  });
});
