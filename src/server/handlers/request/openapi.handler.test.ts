import "#veryfront/schemas/_test-setup.ts";
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
    isLocalProject: true,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi.handler", () => {
  describe("remote execution isolation", () => {
    it("fails closed before route discovery or proxy context setup", async () => {
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

      assertEquals(result.response?.status, 503);
      const body = JSON.parse(await result.response!.text());
      assertEquals(body.error, "Isolated OpenAPI generation is unavailable");
      assertEquals(calls.includes("runWithContext"), false);
      assertEquals(calls.some((call) => call.startsWith("exists:")), false);
    });
  });

  describe("local generation", () => {
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
  });
});
