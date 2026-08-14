import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/content-processor-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
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

    it("classifies tenant MDX syntax failures explicitly", async () => {
      const error = await assertRejects(
        () =>
          compileMDXRuntime(
            "production",
            "/project",
            "<Unclosed",
            undefined,
            "broken.mdx",
            "server",
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "mdx-compile-error");
      assertEquals(error.category, "BUILD");
    });

    it("preserves non-source processor failures", async () => {
      const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
      registerContract(
        "ContentProcessor",
        {
          compileMdx() {
            throw new Error("Expected ContentProcessor to initialize");
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        const error = await assertRejects(() =>
          compileMDXRuntime(
            "production",
            "/project",
            "# Hello",
            undefined,
            "framework-failure.mdx",
            "server",
          )
        );

        assertInstanceOf(error, Error);
        assertEquals(error instanceof VeryfrontError, false);
        assertEquals((error as Error).message, "Expected ContentProcessor to initialize");
      } finally {
        registerContract("ContentProcessor", previous);
      }
    });
  });
});
