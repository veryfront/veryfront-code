import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __injectCacheForTests, tryErrorPageFallback } from "./error-page-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(
  overrides: {
    stat?: (
      path: string,
    ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: null }>;
    readFile?: (path: string) => Promise<string>;
    resolveFile?: ((path: string) => Promise<string | null>) | undefined;
  } = {},
): RuntimeAdapter {
  return {
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
      exists: () => Promise.resolve(false),
      readFile: overrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: overrides.stat ??
        (() => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null })),
      ...(overrides.resolveFile !== undefined ? { resolveFile: overrides.resolveFile } : {}),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    projectId: "test-proj",
    ...overrides,
  };
}

afterEach(() => {
  __injectCacheForTests(null);
});

describe("server/handlers/request/ssr/error-page-fallback", () => {
  describe("tryErrorPageFallback", () => {
    it("returns null when pages directory does not exist", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error("not found")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("returns null when pages is not a directory", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("returns null when no error page files exist", async () => {
      const _statResults: Record<
        string,
        { isFile: boolean; isDirectory: boolean; size: number; mtime: null }
      > = {};

      const adapter = createMockAdapter({
        stat: (path: string) => {
          // pages dir exists as directory
          if (path.endsWith("/pages")) {
            return Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null });
          }
          // No error page files exist
          return Promise.reject(new Error("not found"));
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("returns null when no error page files exist and resolveFile returns null", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null });
          }
          return Promise.reject(new Error("not found"));
        },
        resolveFile: () => Promise.resolve(null),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 500,
      });
      assertEquals(result, null);
    });
  });

  describe("__injectCacheForTests", () => {
    it("can inject and reset cache repo", () => {
      const mockRepo = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      __injectCacheForTests(mockRepo as any);
      __injectCacheForTests(null);
    });
  });
});
