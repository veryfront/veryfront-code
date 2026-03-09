import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compileMDXRuntime } from "./mdx-compiler.ts";

describe("transforms/mdx/compiler/mdx-compiler", () => {
  describe("compileMDXRuntime", () => {
    it("is a function", () => {
      assertEquals(typeof compileMDXRuntime, "function");
    });

    it("compiles simple MDX content", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "# Hello World\n\nSome text.",
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(result.compiledCode.length > 0, true);
    });

    it("compiles MDX with frontmatter", async () => {
      const content = "---\ntitle: Test\n---\n\n# Hello";
      const result = await compileMDXRuntime(
        "production",
        "/project",
        content,
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(result.frontmatter !== undefined, true);
    });

    it("compiles MDX for browser target", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "# Hello",
        undefined,
        "test.mdx",
        "browser",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("handles empty content", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "",
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("handles content with JSX components", async () => {
      const content = "# Hello\n\n<div>JSX content</div>";
      const result = await compileMDXRuntime(
        "production",
        "/project",
        content,
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
    });
  });
});
