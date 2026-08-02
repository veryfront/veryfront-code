import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateLexicalPath } from "#veryfront/security";
import { SnippetHandler } from "./snippet.handler.ts";
import type { HandlerContext } from "../types.ts";

/**
 * Tests that lexical containment correctly blocks path traversal for paths
 * produced by SnippetHandler.resolveFilePath(). The handler validates
 * resolved paths before passing them to fs.readFile().
 *
 * Note: The URL constructor normalizes basic `..` traversals (e.g.,
 * `/@/../../etc/passwd` → `/etc/passwd`) before the handler sees them.
 * These tests verify the lexical safety net catches traversals
 * that survive URL normalization or arrive via non-browser HTTP clients.
 */
describe("snippet handler path validation", () => {
  const baseDir = "/project";

  describe("blocks traversal in resolved paths", () => {
    it("rejects ../../etc/passwd (from /@/ prefix)", () => {
      // resolveFilePath("/@/../../etc/passwd") → "../../etc/passwd"
      const result = validateLexicalPath("../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects components/../../../etc/passwd (from /@components/ prefix)", () => {
      // resolveFilePath("/@components/../../../etc/passwd") → "components/../../../etc/passwd"
      const result = validateLexicalPath("components/../../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects paths with null bytes", () => {
      const result = validateLexicalPath("components/foo\0bar", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects deeply nested traversal", () => {
      const result = validateLexicalPath("a/b/c/../../../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });
  });

  describe("allows valid paths", () => {
    it("allows components/button.snippet.mdx", () => {
      const result = validateLexicalPath("components/button.snippet.mdx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("allows nested component paths", () => {
      const result = validateLexicalPath("components/ui/card.snippet.mdx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("allows paths from /@/ prefix", () => {
      // resolveFilePath("/@/components/button.mdx") → "components/button.mdx"
      const result = validateLexicalPath("components/button.mdx", { baseDir });
      assertEquals(result.valid, true);
    });
  });
});

Deno.test("SnippetHandler validates and reads inside the same proxy context", async () => {
  let inContext = false;
  let readPath: string | undefined;
  const fs = {
    symlinkSemantics: "none" as const,
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    runWithContext: async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
    ) => {
      inContext = true;
      try {
        return await fn();
      } finally {
        inContext = false;
      }
    },
    exists: () => Promise.resolve(true),
    stat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 0,
        mtime: new Date(),
      }),
    readFile: (path: string) => {
      assertEquals(inContext, true);
      readPath = path;
      return Promise.resolve("");
    },
  };
  const ctx = {
    projectDir: "/project",
    projectSlug: "project",
    proxyToken: "token",
    isLocalProject: true,
    adapter: { fs },
  } as unknown as HandlerContext;

  const result = await new SnippetHandler().handle(
    new Request("http://localhost/@components/button"),
    ctx,
  );
  assertEquals(result.response?.status, 404);
  assertEquals(readPath, "/project/components/button.snippet.mdx");
});
