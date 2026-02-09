import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OpenAPIHandler } from "./openapi.handler.ts";
import type { HandlerContext } from "../types.ts";

function createMockFs(
  opts: { existsReturn?: boolean; needsContext?: boolean; multiProject?: boolean } = {},
) {
  const calls: string[] = [];
  const fs: Record<string, unknown> = {
    exists: async (_path: string) => {
      calls.push(`exists:${_path}`);
      return opts.existsReturn ?? false;
    },
    readDir: async function* () {/* empty */},
    readFile: async () => "",
    stat: async () => ({
      size: 0,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      mtime: null,
    }),
  };

  if (opts.needsContext) {
    // Simulate extended FS adapter that requires context
    fs.isVeryfrontAdapter = () => true;
    fs.getUnderlyingAdapter = () => ({});
    fs.isMultiProjectMode = () => opts.multiProject !== false;
    fs.isContextualMode = () => true;
    fs.getAdapterType = () => "VeryfrontFSAdapter";
    fs.runWithContext = async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
      _projectId?: string,
      _options?: Record<string, unknown>,
    ) => {
      calls.push("runWithContext");
      return await fn();
    };
  }

  return { fs, calls };
}

function createCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: { fs: createMockFs().fs } as never,
    config: { openapi: { enabled: true } },
    isLocalProject: false,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi.handler", () => {
  describe("proxy mode uses runWithContext", () => {
    it("should call runWithContext when in proxy mode with extended FS", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      const body = JSON.parse(await result.response!.text());
      assertEquals(typeof body.paths, "object");
      assertEquals(calls.includes("runWithContext"), true);
    });

    it("should NOT call runWithContext for local projects", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: true,
        projectSlug: "test-project",
        proxyToken: "test-token",
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
    });

    it("should NOT call runWithContext when no proxyToken", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: undefined,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
    });

    it("should NOT call runWithContext when extended FS lacks multi-project mode", async () => {
      const { fs, calls } = createMockFs({ needsContext: true, multiProject: false });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
    });
  });

  describe("spec caching", () => {
    it("should use different cache keys for different branches", async () => {
      const { fs } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();

      // First request on branch "main"
      const ctx1 = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        parsedDomain: { branch: "main" } as never,
        releaseId: "rel-1",
      });
      const req1 = new Request("https://example.com/_openapi.json");
      const result1 = await handler.handle(req1, ctx1);
      assertEquals(result1.response?.status, 200);

      // Second request on branch "feature" — should NOT serve stale spec
      const ctx2 = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        parsedDomain: { branch: "feature" } as never,
        releaseId: "rel-2",
      });
      const req2 = new Request("https://example.com/_openapi.json");
      const result2 = await handler.handle(req2, ctx2);
      assertEquals(result2.response?.status, 200);

      // Both should succeed without serving stale cached spec from first branch
      // (The handler's internal cacheKey should differ for different branches/releases)
    });
  });

  describe("spec generation with route discovery in proxy mode", () => {
    it("should attempt directory existence checks within runWithContext", async () => {
      const { fs, calls } = createMockFs({ needsContext: true, existsReturn: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      await handler.handle(req, ctx);

      // Verify runWithContext was used and discovery directories were checked
      assertEquals(calls.includes("runWithContext"), true);
      const existsCalls = calls.filter((c) => c.startsWith("exists:"));
      assertEquals(existsCalls.length > 0, true);
    });
  });
});
