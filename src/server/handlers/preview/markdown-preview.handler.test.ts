import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { MarkdownPreviewHandler } from "./markdown-preview.handler.ts";
import type { HandlerContext } from "../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    ...overrides,
  } as HandlerContext;
}

describe("MarkdownPreviewHandler.metadata.enabled", () => {
  it("is enabled for a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: true });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is enabled for host-derived preview (mode: preview)", () => {
    // After VULN-SRV-1/2 fix, requestContext.mode === 'preview' only happens
    // when the Host / X-Forwarded-Host is server-trusted preview. The
    // x-environment client header is ignored — see request-context.test.ts.
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is NOT enabled for a non-local production request", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "production" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });

  it("is NOT enabled when no request context and not a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: false });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });
});

describe("MarkdownPreviewHandler path admission", () => {
  it("reads the canonical project path when the project root differs from cwd", async () => {
    const adapter = createMockAdapter();
    let readPath: string | undefined;
    adapter.fs.readFile = (path: string) => {
      readPath = path;
      return Promise.resolve("---\nprose: false\n---\n# Not rendered");
    };

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/docs/readme.md"),
      makeCtx({
        projectDir: "/workspace/project",
        adapter,
        isLocalProject: true,
      }),
    );

    assertEquals(readPath, "/workspace/project/docs/readme.md");
    assertEquals(result.continue, true);
  });

  it("rejects an adapter-resolved path outside the project before reading", async () => {
    const adapter = createMockAdapter();
    const readPaths: string[] = [];
    adapter.fs.resolveFile = () => Promise.resolve("/outside/secret.md");
    adapter.fs.readFile = (path: string) => {
      readPaths.push(path);
      return Promise.resolve("secret");
    };

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/docs/readme.md"),
      makeCtx({
        projectDir: "/workspace/project",
        adapter,
        isLocalProject: true,
      }),
    );

    assertEquals(readPaths, []);
    assertEquals(result.continue, true);
  });
});
