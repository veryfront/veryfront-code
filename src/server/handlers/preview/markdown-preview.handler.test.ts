import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MarkdownPreviewHandler } from "./markdown-preview.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    ...overrides,
  } as HandlerContext;
}

function makeRequestContext(
  fsOverrides: Partial<RuntimeAdapter["fs"]> = {},
): HandlerContext {
  const adapter = {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(true),
      readFile: () => Promise.resolve("# Preview"),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 9,
          mtime: null,
        }),
      ...fsOverrides,
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as never),
  } as unknown as RuntimeAdapter;

  return makeCtx({
    adapter,
    config: {} as HandlerContext["config"],
    securityConfig: {},
    cspUserHeader: null,
    isLocalProject: false,
    requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
  });
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

describe("MarkdownPreviewHandler request boundary", () => {
  it("continues without storage access for an explicit production request", async () => {
    let storageCalls = 0;
    const ctx = makeRequestContext({
      stat: () => {
        storageCalls++;
        return Promise.reject(new Error("storage must not be called"));
      },
    });
    ctx.requestContext = { mode: "production" } as HandlerContext["requestContext"];

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/guide.md"),
      ctx,
    );

    assertEquals(result.continue, true);
    assertEquals(storageCalls, 0);
  });

  it("fails closed when remote project context has no request credential", async () => {
    const envKey = "VERYFRONT_API_TOKEN";
    const originalToken = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-token-must-not-be-used");
    let contextCalls = 0;
    const ctx = makeRequestContext({
      getUnderlyingAdapter: () => ({}),
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => true,
      isContextualMode: () => true,
      runWithContext: async <T>(
        _slug: string,
        _token: string,
        fn: () => Promise<T>,
      ): Promise<T> => {
        contextCalls++;
        return await fn();
      },
    } as Partial<RuntimeAdapter["fs"]>);
    ctx.projectSlug = "remote-project";
    ctx.projectId = "proj_123";
    ctx.proxyToken = undefined;

    try {
      const result = await new MarkdownPreviewHandler().handle(
        new Request("http://localhost/guide.md"),
        ctx,
      );

      assertEquals(result.response?.status, 503);
      assertEquals(contextCalls, 0);
    } finally {
      if (originalToken === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, originalToken);
    }
  });

  it("does not mutate an unscoped remote contextual adapter", async () => {
    let mutationCalls = 0;
    const ctx = makeRequestContext({
      getUnderlyingAdapter: () => ({}),
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => false,
      isContextualMode: () => true,
      setRequestToken: () => mutationCalls++,
      setRequestBranch: () => mutationCalls++,
      setProductionMode: () => mutationCalls++,
    } as Partial<RuntimeAdapter["fs"]>);
    ctx.projectSlug = "remote-project";
    ctx.projectId = "proj_123";
    ctx.proxyToken = "proxy-token";

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/guide.md"),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(mutationCalls, 0);
  });

  it("rejects mutation methods before touching project storage", async () => {
    let storageCalls = 0;
    const ctx = makeRequestContext({
      stat: () => {
        storageCalls += 1;
        return Promise.reject(new Error("storage must not be called"));
      },
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/guide.md", { method: "POST" }),
      ctx,
    );

    assertEquals(result.response?.status, 405);
    assertEquals(result.response?.headers.get("allow"), "GET, HEAD");
    assertEquals(storageCalls, 0);
  });

  it("rejects encoded traversal before touching project storage", async () => {
    let storageCalls = 0;
    const ctx = makeRequestContext({
      stat: () => {
        storageCalls += 1;
        return Promise.reject(new Error("storage must not be called"));
      },
      readFile: () => {
        storageCalls += 1;
        return Promise.reject(new Error("storage must not be called"));
      },
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/%2e%2e%2fprivate.md"),
      ctx,
    );

    assertEquals(result.response?.status, 404);
    assertEquals(storageCalls, 0);
    assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
  });

  it("returns a private 500 when preview storage is unreadable", async () => {
    const ctx = makeRequestContext({
      stat: () =>
        Promise.reject(
          new Deno.errors.PermissionDenied("private-canary /private/preview/path"),
        ),
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/guide.md"),
      ctx,
    );

    assertEquals(result.response?.status, 500);
    assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
    const body = await result.response!.text();
    assertEquals(body.includes("private-canary"), false);
    assertEquals(body.includes("/private/preview/path"), false);
  });

  it("returns a secured 404 for a missing remote preview without a host fallback", async () => {
    const ctx = makeRequestContext({
      stat: () => Promise.reject(new Deno.errors.NotFound("missing")),
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/missing.md"),
      ctx,
    );

    assertEquals(result.response?.status, 404);
    assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
  });

  it("rejects an oversized preview before reading it into memory", async () => {
    let readCalls = 0;
    const ctx = makeRequestContext({
      stat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 5 * 1024 * 1024,
          mtime: null,
        }),
      readFile: () => {
        readCalls += 1;
        return Promise.resolve("# Preview");
      },
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/large.md"),
      ctx,
    );

    assertEquals(result.response?.status, 500);
    assertEquals(readCalls, 0);
  });

  it("rejects a canonical path that escapes through a symbolic link", async () => {
    let readCalls = 0;
    const ctx = makeRequestContext({
      realPath: (path) => {
        if (path === "/project") return Promise.resolve("/project");
        if (path === "/project/link.md") return Promise.resolve("/private/secret.md");
        return Promise.reject(new Deno.errors.NotFound("missing ancestor"));
      },
      readFile: () => {
        readCalls += 1;
        return Promise.resolve("private");
      },
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/link.md"),
      ctx,
    );

    assertEquals(result.response?.status, 404);
    assertEquals(readCalls, 0);
  });

  it("does not silently accept malformed frontmatter", async () => {
    const malformed = "---\ntitle: [\n---\n# Preview";
    const ctx = makeRequestContext({
      stat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: malformed.length,
          mtime: null,
        }),
      readFile: () => Promise.resolve(malformed),
    });

    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/broken.md"),
      ctx,
    );

    assertEquals(result.response?.status, 500);
    assertEquals(await result.response!.text(), "Markdown preview unavailable");
  });
});
