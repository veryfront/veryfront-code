import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { validateLexicalPath } from "#veryfront/security";
import type { HandlerContext } from "../types.ts";
import { SnippetHandler } from "./snippet.handler.ts";

function createSnippetContext(): HandlerContext {
  return {
    projectDir: "/workspace/project",
    adapter: createMockAdapter(),
    isLocalProject: true,
    securityConfig: {},
    cspUserHeader: null,
  } as HandlerContext;
}

function snippetRequest(): Request {
  return new Request("http://localhost/@/components/card.mdx");
}

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
    const ctx = createSnippetContext();
    const { adapter } = ctx;
    let readPath: string | undefined;
    adapter.fs.readFile = (path: string) => {
      readPath = path;
      return Promise.resolve("");
    };

    await new SnippetHandler(async () => ({ html: "", frontmatter: {} })).handle(
      snippetRequest(),
      ctx,
    );

    assertEquals(readPath, "/workspace/project/components/card.mdx");
  });
});

describe("snippet handler file and render failures", () => {
  it("returns the existing no-cache 404 response for a canonical missing file", async () => {
    const ctx = createSnippetContext();
    ctx.adapter.fs.readFile = () => Promise.reject(new Deno.errors.NotFound("missing snippet"));

    const result = await new SnippetHandler().handle(snippetRequest(), ctx);
    const response = result.response;
    assertExists(response);

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("cache-control"), "no-cache");
  });

  for (
    const [label, failure] of [
      [
        "a NotFound-named lookalike",
        Object.assign(new Error("missing snippet"), { name: "NotFound" }),
      ],
      ["an EACCES failure", Object.assign(new Error("access denied"), { code: "EACCES" })],
      ["an EIO failure", Object.assign(new Error("I/O failure"), { code: "EIO" })],
      ["an arbitrary failure", new Error("unexpected read failure")],
      ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    ] as const
  ) {
    it(`propagates ${label} from the filesystem unchanged`, async () => {
      const ctx = createSnippetContext();
      ctx.adapter.fs.readFile = () => Promise.reject(failure);

      const actual = await assertRejects(() => new SnippetHandler().handle(snippetRequest(), ctx));

      assertStrictEquals(actual, failure);
    });
  }

  it("propagates a hostile non-Error filesystem rejection unchanged", async () => {
    const failure = new Proxy({}, {
      get() {
        throw new Error("read trap must not be invoked");
      },
    });
    const ctx = createSnippetContext();
    ctx.adapter.fs.readFile = () => Promise.reject(failure);

    let actual: unknown;
    try {
      await new SnippetHandler().handle(snippetRequest(), ctx);
    } catch (error) {
      actual = error;
    }

    assertStrictEquals(actual, failure);
  });

  it("renders an empty snippet file", async () => {
    const ctx = createSnippetContext();
    ctx.adapter.fs.readFile = () => Promise.resolve("");
    const handler = new SnippetHandler(async () => ({
      html: "<main>empty snippet rendered</main>",
      frontmatter: {},
    }));

    const result = await handler.handle(snippetRequest(), ctx);
    const response = result.response;
    assertExists(response);

    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get("cache-control") ?? "", "no-cache");
    assertEquals(await response.text(), "<main>empty snippet rendered</main>");
  });

  it("propagates a renderer failure unchanged", async () => {
    const ctx = createSnippetContext();
    ctx.adapter.fs.readFile = () => Promise.resolve("# snippet");
    const failure = new Error("snippet compiler failed");
    const handler = new SnippetHandler(async () => {
      throw failure;
    });

    const actual = await assertRejects(() => handler.handle(snippetRequest(), ctx));

    assertStrictEquals(actual, failure);
  });
});
