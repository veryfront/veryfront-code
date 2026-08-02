import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HandlerContext } from "../types.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MarkdownPreviewHandler } from "./markdown-preview.handler.ts";

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

Deno.test("MarkdownPreviewHandler admits the resolver result before reading", async () => {
  let reads = 0;
  const handler = new MarkdownPreviewHandler();
  const ctx = {
    projectDir: "/project",
    isLocalProject: true,
    adapter: {
      fs: {
        resolveFile: () => Promise.resolve("../outside/secret.md"),
        readFile: () => {
          reads += 1;
          return Promise.resolve("secret");
        },
      },
    },
  } as unknown as HandlerContext;

  const result = await handler.handle(new Request("http://localhost/README.md"), ctx);
  assertEquals(result.continue, true);
  assertEquals(reads, 0);
});
