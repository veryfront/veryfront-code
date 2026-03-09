import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, SSRHandler } from "./ssr.handler.ts";
import type { HandlerContext } from "../../types.ts";
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

describe("server/handlers/request/ssr/ssr.handler", () => {
  describe("SSRHandler metadata", () => {
    it("has correct name", () => {
      const handler = new SSRHandler();
      assertEquals(handler.metadata.name, "SSRHandler");
    });

    it("has pattern for GET and HEAD methods", () => {
      const handler = new SSRHandler();
      const methods = handler.metadata.patterns?.[0]?.method;
      assertEquals(Array.isArray(methods), true);
      assertEquals((methods as string[]).includes("GET"), true);
      assertEquals((methods as string[]).includes("HEAD"), true);
    });
  });

  describe("handle - path filtering", () => {
    it("continues for /_veryfront/ paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/_veryfront/rsc/probe");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for file extension paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/styles.css");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .js file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/app.js");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .json file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/data.json");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .ico file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/favicon.ico");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for dot-segment paths in production", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/.env");
      const ctx = makeCtx({ resolvedEnvironment: "production" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for /_veryfront/ deeply nested paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/_veryfront/modules/test");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("isProductionMode", () => {
    it("returns true when config has productionMode = true", () => {
      const ctx = makeCtx({
        config: { fs: { veryfront: { productionMode: true } } } as any,
      });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns true when resolvedEnvironment is production", () => {
      const ctx = makeCtx({ resolvedEnvironment: "production" });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns false when resolvedEnvironment is preview", () => {
      const ctx = makeCtx({ resolvedEnvironment: "preview" });
      assertEquals(isProductionMode(ctx), false);
    });

    it("falls back to requestContext.mode when resolvedEnvironment is not set", () => {
      const ctx = makeCtx({
        requestContext: { mode: "production" } as any,
      });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns false when neither resolvedEnvironment nor mode is set", () => {
      const ctx = makeCtx();
      assertEquals(isProductionMode(ctx), false);
    });

    it("config productionMode overrides resolvedEnvironment", () => {
      const ctx = makeCtx({
        config: { fs: { veryfront: { productionMode: true } } } as any,
        resolvedEnvironment: "preview",
      });
      assertEquals(isProductionMode(ctx), true);
    });
  });
});
