import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ModuleHandler } from "./module.handler.ts";
import { handleBatchModuleEndpoint } from "./batch-module-handler.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "../../../shared/renderer/index.ts";

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

function createInitializer(renderer: Partial<Renderer>): RendererInitializer {
  return {
    initialize: () => Promise.resolve(renderer as Renderer),
    isInitialized: () => true,
    get: () => renderer as Renderer,
    destroy: () => Promise.resolve(),
  };
}

describe("server/handlers/request/module/module.handler", () => {
  afterEach(async () => {
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  describe("ModuleHandler metadata", () => {
    it("has correct name", () => {
      const handler = new ModuleHandler();
      assertEquals(handler.metadata.name, "ModuleHandler");
    });

    it("has 5 route patterns", () => {
      const handler = new ModuleHandler();
      assertEquals(handler.metadata.patterns?.length, 5);
    });

    it("includes _vf_modules pattern", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns?.map((p) => p.pattern) ?? [];
      assertEquals(patterns.includes("/_vf_modules/"), true);
    });

    it("includes _veryfront/modules pattern", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns?.map((p) => p.pattern) ?? [];
      assertEquals(patterns.includes("/_veryfront/modules/"), true);
    });

    it("includes _veryfront/pages pattern", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns?.map((p) => p.pattern) ?? [];
      assertEquals(patterns.includes("/_veryfront/pages/"), true);
    });

    it("includes _veryfront/data pattern", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns?.map((p) => p.pattern) ?? [];
      assertEquals(patterns.includes("/_veryfront/data/"), true);
    });

    it("includes _veryfront/page-data pattern", () => {
      const handler = new ModuleHandler();
      const patterns = handler.metadata.patterns?.map((p) => p.pattern) ?? [];
      assertEquals(patterns.includes("/_veryfront/page-data/"), true);
    });

    it("all patterns are prefix matches", () => {
      const handler = new ModuleHandler();
      const allPrefix = handler.metadata.patterns?.every((p) => p.prefix === true) ?? false;
      assertEquals(allPrefix, true);
    });
  });

  describe("handle - non-matching paths", () => {
    it("continues for unmatched paths", async () => {
      const handler = new ModuleHandler();
      const req = new Request("http://localhost/some/other/path");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for root path", async () => {
      const handler = new ModuleHandler();
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for similar but non-matching prefix", async () => {
      const handler = new ModuleHandler();
      const req = new Request("http://localhost/_veryfront/other/");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("rejects unsupported methods for every owned namespace", async () => {
      const handler = new ModuleHandler();
      for (
        const pathname of [
          "/_vf_modules/page.js",
          "/_veryfront/modules/runtime.js",
          "/_veryfront/pages/page.js",
          "/_veryfront/data/page.json",
          "/_veryfront/page-data/page.json",
        ]
      ) {
        const result = await handler.handle(
          new Request(`http://localhost${pathname}`, { method: "POST" }),
          makeCtx(),
        );
        assertEquals(result.continue, false);
        assertEquals(result.response?.status, 405);
        assertEquals(result.response?.headers.get("allow"), "GET, HEAD");
      }
    });
  });

  describe("removed batch endpoint", () => {
    const respond = (response: Response) => ({
      continue: false as const,
      response,
    });

    it("returns an explicit non-cacheable 410 response", async () => {
      const result = await handleBatchModuleEndpoint(
        new Request("http://localhost/_vf_modules/_batch?paths=page.js"),
        respond,
      );

      assertEquals(result.response?.status, 410);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(
        await result.response?.text(),
        "Module batch endpoint has been removed",
      );
    });

    it("does not include a response body for HEAD", async () => {
      const result = await handleBatchModuleEndpoint(
        new Request("http://localhost/_vf_modules/_batch", {
          method: "HEAD",
        }),
        respond,
      );

      assertEquals(result.response?.status, 410);
      assertEquals(await result.response?.text(), "");
    });

    it("rejects unsupported methods before returning the tombstone", async () => {
      const result = await handleBatchModuleEndpoint(
        new Request("http://localhost/_vf_modules/_batch", {
          method: "POST",
        }),
        respond,
      );

      assertEquals(result.response?.status, 405);
      assertEquals(result.response?.headers.get("allow"), "GET, HEAD");
    });
  });

  describe("handle - page modules", () => {
    it("returns 404 when a missing page module falls through from static handling", async () => {
      setRendererInitializer(createInitializer({
        renderPage: () => {
          throw FILE_NOT_FOUND.create({
            detail: "Page not found: no-such",
            context: { slug: "no-such" },
          });
        },
      }));

      const handler = new ModuleHandler();
      const req = new Request("http://localhost/_veryfront/pages/no-such.js");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 404);
    });
  });
});
