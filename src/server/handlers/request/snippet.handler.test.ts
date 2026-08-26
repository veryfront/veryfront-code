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

Deno.test("SnippetHandler rejects shared rendering before proxy context or source reads", async () => {
  let contextCalls = 0;
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
      contextCalls++;
      return await fn();
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
      readPath = path;
      return Promise.resolve("");
    },
  };
  // `isLocalProject: false` matters. This context used to say `true`, which
  // reads as a denial test but no longer is one: an explicitly local project
  // carries the host-execution capability, so the surface is now supposed to
  // serve it. Only a shared runtime that was never granted execution belongs
  // here.
  const ctx = {
    projectDir: "/project",
    projectSlug: "project",
    proxyToken: "token",
    isLocalProject: false,
    adapter: { fs },
  } as unknown as HandlerContext;

  const result = await new SnippetHandler().handle(
    new Request("http://localhost/@components/button"),
    ctx,
  );
  assertEquals(result.response?.status, 503);
  assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
  assertEquals(contextCalls, 0);
  assertEquals(readPath, undefined);
});

describe("SnippetHandler host-execution capability", () => {
  it("keeps shared snippet execution denied despite a host grant", async () => {
    // An entrypoint grant cannot override shared-runtime topology. Pin the
    // source-read boundary so this does not regress to capability-only checks.
    let readPath: string | undefined;
    const fs = {
      symlinkSemantics: "none" as const,
      isMultiProjectMode: () => true,
      isContextualMode: () => true,
      runWithContext: async (
        _slug: string,
        _token: string,
        fn: () => Promise<unknown>,
      ) => await fn(),
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
        readPath = path;
        return Promise.resolve("export default function Button() {}\n");
      },
    };
    const ctx = {
      projectDir: "/project",
      projectSlug: "project",
      proxyToken: "token",
      isLocalProject: false,
      allowHostProjectCodeExecution: true,
      adapter: { fs },
    } as unknown as HandlerContext;

    const result = await new SnippetHandler().handle(
      new Request("http://localhost/@components/button"),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(readPath, undefined);
  });

  it("passes the canonical enriched release identity to snippet rendering", async () => {
    let renderedReleaseId: string | undefined;
    const handler = new SnippetHandler({
      renderSnippet: (_content: string, options: { releaseId?: string }) => {
        renderedReleaseId = options.releaseId;
        return Promise.resolve({ html: "<main>Snippet</main>", frontmatter: {} });
      },
    });
    const fs = {
      symlinkSemantics: "none" as const,
      isMultiProjectMode: () => false,
      isContextualMode: () => false,
      exists: () => Promise.resolve(true),
      stat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 1,
          mtime: new Date(),
        }),
      readFile: () => Promise.resolve("# Snippet"),
    };
    const ctx = {
      projectDir: "/project",
      projectId: "serving-project",
      projectSlug: "serving-project",
      releaseId: "serving-release",
      enriched: {
        projectId: "canonical-project",
        projectSlug: "canonical-project",
        contentSourceId: "canonical-content",
        releaseId: "canonical-release",
      },
      isLocalProject: true,
      adapter: { fs },
    } as unknown as HandlerContext;

    const result = await handler.handle(
      new Request("http://localhost/@components/button"),
      ctx,
    );

    assertEquals(result.response?.status, 200);
    assertEquals(renderedReleaseId, "canonical-release");
  });
});

Deno.test("SnippetHandler preserves dedicated local rendering", async () => {
  let readPath: string | undefined;
  const fs = {
    symlinkSemantics: "none" as const,
    isMultiProjectMode: () => false,
    isContextualMode: () => false,
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
      readPath = path;
      return Promise.resolve("");
    },
  };
  const ctx = {
    projectDir: "/project",
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
