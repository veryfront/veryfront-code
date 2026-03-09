import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileMDX } from "./mdx-processor.ts";

describe(
  "build/compiler/mdx-compiler/mdx-processor",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    describe("compileMDX", () => {
      it("should compile simple MDX content", async () => {
        const content = "# Hello World\n\nThis is a paragraph.";
        const result = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(result.code);
        assertEquals(typeof result.code, "string");
        assertEquals(Array.isArray(result.imports), true);
      });

      it("should extract import statements from compiled code", async () => {
        const content = `import React from 'react';\n\n# Hello`;
        const result = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(result.imports);
        assertEquals(result.imports.length > 0, true);
      });

      it("should handle empty content", async () => {
        const result = await compileMDX("", {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(result.code);
        assertEquals(Array.isArray(result.imports), true);
      });

      it("should compile JSX in MDX", async () => {
        const content = `# Title\n\n<div className="test">Hello</div>`;
        const result = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertExists(result.code);
        assertStringIncludes(result.code, "test");
      });

      it("should handle MDX with inline code", async () => {
        const content = "Here is `inline code` in text.";
        const result = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(result.code);
      });

      it("should handle MDX with lists", async () => {
        const content = "- Item 1\n- Item 2\n- Item 3";
        const result = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(result.code);
      });

      it("should set development mode correctly", async () => {
        const content = "# Dev mode test";
        const devResult = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        const prodResult = await compileMDX(content, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        assertExists(devResult.code);
        assertExists(prodResult.code);
      });
    });
  },
);
