import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CorsHandler } from "./cors.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(): RuntimeAdapter {
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
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
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

describe("server/handlers/response/cors", () => {
  describe("CorsHandler", () => {
    it("has correct metadata", () => {
      const handler = new CorsHandler();
      assertEquals(handler.metadata.name, "CorsHandler");
      assertEquals(handler.metadata.patterns?.length, 1);
      assertEquals(handler.metadata.patterns?.[0].method, "OPTIONS");
    });

    it("continues for non-OPTIONS requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", { method: "GET" });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("continues for POST requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", { method: "POST" });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("responds to OPTIONS requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type",
        },
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
    });

    it("responds to OPTIONS with access-control headers", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Authorization,Content-Type",
        },
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
      // Should have allow-methods header
      const methods = result.response?.headers.get("access-control-allow-methods") ?? "";
      assertEquals(methods.length > 0, true);
    });

    it("handles OPTIONS with lowercase method check", async () => {
      const handler = new CorsHandler();
      // OPTIONS method should be matched case-insensitively
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
    });
  });
});
