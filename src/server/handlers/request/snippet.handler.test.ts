import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { validateLexicalPath } from "#veryfront/security";
import type { HandlerContext } from "../types.ts";
import { SnippetHandler } from "./snippet.handler.ts";

/**
 * Tests that validateLexicalPath correctly blocks path traversal for paths
 * produced by SnippetHandler.resolveFilePath(). The handler validates
 * resolved paths before passing them to fs.readFile().
 *
 * Note: The URL constructor normalizes basic `..` traversals (e.g.,
 * `/@/../../etc/passwd` → `/etc/passwd`) before the handler sees them.
 * These tests verify the validateLexicalPath safety net catches traversals
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

  it("reads the admitted canonical path rather than a process-relative path", async () => {
    const adapter = createMockAdapter();
    let readPath: string | undefined;
    adapter.fs.readFile = (path: string) => {
      readPath = path;
      return Promise.resolve("");
    };
    const ctx = {
      projectDir: "/workspace/project",
      adapter,
      isLocalProject: true,
      securityConfig: {},
      cspUserHeader: null,
    } as HandlerContext;

    await new SnippetHandler().handle(
      new Request("http://localhost/@/components/card.mdx"),
      ctx,
    );

    assertEquals(readPath, "/workspace/project/components/card.mdx");
  });
});
