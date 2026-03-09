import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(
  overrides: {
    stat?: (
      path: string,
    ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: null }>;
    readFile?: (path: string) => Promise<string>;
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
      stat: overrides.stat ?? (() => Promise.reject(new Error("not found"))),
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
    ...overrides,
  };
}

describe("server/handlers/request/ssr/not-found-fallback", () => {
  describe("tryNotFoundFallback", () => {
    it("returns null when app directory does not exist", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error("ENOENT")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/not-found");
      const builder = new ResponseBuilder();

      const result = await tryNotFoundFallback(req, "not-found", ctx, builder);
      assertEquals(result, null);
    });

    it("returns null when app path is not a directory", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/not-found");
      const builder = new ResponseBuilder();

      const result = await tryNotFoundFallback(req, "not-found", ctx, builder);
      assertEquals(result, null);
    });

    it("returns null when slug is empty and app directory doesn't exist", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error("ENOENT")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryNotFoundFallback(req, "", ctx, builder);
      assertEquals(result, null);
    });
  });
});
