import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validatePathSync } from "#veryfront/security";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../types.ts";
import { SnippetHandler } from "./snippet.handler.ts";

function makeContext(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: {},
    cspUserHeader: null,
    config: {} as HandlerContext["config"],
  } as HandlerContext;
}

/**
 * Tests that validatePathSync correctly blocks path traversal for paths
 * produced by SnippetHandler.resolveFilePath(). The handler validates
 * resolved paths before passing them to fs.readFile().
 *
 * Note: The URL constructor normalizes basic `..` traversals (e.g.,
 * `/@/../../etc/passwd` → `/etc/passwd`) before the handler sees them.
 * These tests verify the validatePathSync safety net catches traversals
 * that survive URL normalization or arrive via non-browser HTTP clients.
 */
describe("snippet handler path validation", () => {
  const baseDir = "/project";

  describe("blocks traversal in resolved paths", () => {
    it("rejects ../../etc/passwd (from /@/ prefix)", () => {
      // resolveFilePath("/@/../../etc/passwd") → "../../etc/passwd"
      const result = validatePathSync("../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects components/../../../etc/passwd (from /@components/ prefix)", () => {
      // resolveFilePath("/@components/../../../etc/passwd") → "components/../../../etc/passwd"
      const result = validatePathSync("components/../../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects paths with null bytes", () => {
      const result = validatePathSync("components/foo\0bar", { baseDir });
      assertEquals(result.valid, false);
    });

    it("rejects deeply nested traversal", () => {
      const result = validatePathSync("a/b/c/../../../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
    });
  });

  describe("allows valid paths", () => {
    it("allows components/button.snippet.mdx", () => {
      const result = validatePathSync("components/button.snippet.mdx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("allows nested component paths", () => {
      const result = validatePathSync("components/ui/card.snippet.mdx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("allows paths from /@/ prefix", () => {
      // resolveFilePath("/@/components/button.mdx") → "components/button.mdx"
      const result = validatePathSync("components/button.mdx", { baseDir });
      assertEquals(result.valid, true);
    });
  });
});

describe("SnippetHandler request boundary", () => {
  it("rejects an explicitly remote snippet before filesystem access", async () => {
    const ctx = makeContext();
    ctx.isLocalProject = false;
    let filesystemCalls = 0;
    ctx.adapter.fs.stat = () => {
      filesystemCalls++;
      return Promise.reject(new Error("must not run"));
    };

    const result = await new SnippetHandler().handle(
      new Request("https://runtime.example.com/@/components/private.mdx"),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
    assertEquals(filesystemCalls, 0);
  });

  it("returns a private 500 for filesystem permission failures", async () => {
    const ctx = makeContext();
    ctx.adapter.fs.stat = () =>
      Promise.reject(new Deno.errors.PermissionDenied("private filesystem detail"));

    const result = await new SnippetHandler().handle(
      new Request("http://localhost/@/components/private.mdx"),
      ctx,
    );

    assertEquals(result.response?.status, 500);
    assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
    assertEquals((await result.response!.text()).includes("private filesystem detail"), false);
  });

  it("rejects a symlink before reading snippet source", async () => {
    const ctx = makeContext();
    let readCalls = 0;
    ctx.adapter.fs.lstat = () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: true,
        size: 1,
        mtime: null,
      });
    ctx.adapter.fs.realPath = (path) =>
      Promise.resolve(path === "/project" ? "/project" : "/outside/private.mdx");
    ctx.adapter.fs.readFile = () => {
      readCalls++;
      return Promise.resolve("private");
    };

    const result = await new SnippetHandler().handle(
      new Request("http://localhost/@/components/private.mdx"),
      ctx,
    );

    assertEquals(result.response?.status, 403);
    assertEquals(readCalls, 0);
  });
});
