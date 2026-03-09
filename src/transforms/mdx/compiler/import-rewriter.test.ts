import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.ts";
import type { ImportRewriterConfig } from "./import-rewriter.ts";

describe("transforms/mdx/compiler/import-rewriter", () => {
  describe("rewriteBodyImports", () => {
    it("rewrites relative import for SSR", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "ssr",
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
        target: "ssr",
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
        target: "ssr",
      };
      const body = `import { Button } from "@/components/Button";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("@/components/Button"), true);
    });

    it("does not touch non-import lines", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "ssr",
      };
      const body = `const x = 1;\nimport React from "react";`;
      const result = rewriteBodyImports(body, config);
      assertEquals(result.includes("const x = 1;"), true);
    });

    it("handles export from statement", () => {
      const config: ImportRewriterConfig = {
        filePath: "/project/app/page.mdx",
        target: "ssr",
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
        target: "ssr",
      };
      assertEquals(rewriteBodyImports("", config), "");
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
        target: "ssr",
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
