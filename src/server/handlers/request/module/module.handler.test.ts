import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ModuleHandler } from "./module.handler.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "../../../shared/renderer/index.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

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
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  afterEach(async () => {
    if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
    else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
    Deno.env.delete("WORKER_ISOLATION_ENABLED");
    Deno.env.delete("WORKER_ISOLATION_DATA");
    Deno.env.delete("WORKER_ISOLATION_SSR");
    __resetPoolForTests();
    __resetLogRecordEmitterForTests();
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  describe("remote project authentication", () => {
    it("rejects project module content before the handler when the token is missing", async () => {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      const handler = new ModuleHandler();
      const ctx = makeCtx({
        projectSlug: "remote-project",
        isLocalProject: false,
        config: {} as HandlerContext["config"],
      });

      const result = await handler.handle(
        new Request("https://runtime.example.com/_vf_modules/components/App.js"),
        ctx,
      );

      assertEquals(result.response?.status, 502);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
    });

    it("allows embedded framework modules without a project token", async () => {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      const handler = new ModuleHandler();
      const ctx = makeCtx({
        projectSlug: "remote-project",
        isLocalProject: false,
        config: {} as HandlerContext["config"],
      });

      const result = await handler.handle(
        new Request("https://runtime.example.com/_vf_modules/_veryfront/_dnt.shims.js"),
        ctx,
      );

      assertEquals(result.response?.status, 200);
    });

    it("does not treat encoded framework traversal as an embedded module", async () => {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      const handler = new ModuleHandler();
      const ctx = makeCtx({
        projectSlug: "remote-project",
        isLocalProject: false,
        config: {} as HandlerContext["config"],
      });

      const result = await handler.handle(
        new Request(
          "https://runtime.example.com/_vf_modules/_veryfront/%2e%2e/components/Secret.js",
        ),
        ctx,
      );

      assertEquals(result.response?.status, 502);
    });

    it("rejects remote render-backed module endpoints even when worker flags are enabled", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      Deno.env.set("WORKER_ISOLATION_SSR", "1");
      __resetPoolForTests();

      let rendererCalls = 0;
      setRendererInitializer(createInitializer({
        renderPage: () => {
          rendererCalls++;
          throw new Error("renderer should not run");
        },
      }));
      const handler = new ModuleHandler();
      const ctx = makeCtx({
        projectSlug: "remote-project",
        proxyToken: "project-token",
        isLocalProject: false,
        config: {} as HandlerContext["config"],
      });

      const result = await handler.handle(
        new Request("https://runtime.example.com/_veryfront/data/index.json"),
        ctx,
      );

      assertEquals(result.response?.status, 503);
      assertEquals(rendererCalls, 0);
    });
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

    it("does not expose module generation failures in logs or responses", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      setRendererInitializer(createInitializer({
        renderPage: () => {
          throw new Error("private-page-module-error at /private/project/page.tsx");
        },
      }));

      const result = await new ModuleHandler().handle(
        new Request("http://localhost/_veryfront/pages/PRIVATE_ROUTE_MARKER.js"),
        makeCtx(),
      );
      const responseBody = await result.response!.text();
      const logs = JSON.stringify(entries);

      assertEquals(result.response?.status, 500);
      assertEquals(responseBody.includes("private-page-module-error"), false);
      assertEquals(logs.includes("private-page-module-error"), false);
      assertEquals(logs.includes("PRIVATE_ROUTE_MARKER"), false);
      assertEquals(logs.includes("/private/project/page.tsx"), false);
    });
  });

  describe("handle - data modules", () => {
    it("does not infer not found from an untyped error message", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      setRendererInitializer(createInitializer({
        renderPage: () => {
          throw new Error("404 private-data-error at /private/project/page.tsx");
        },
      }));

      const result = await new ModuleHandler().handle(
        new Request("http://localhost/_veryfront/data/PRIVATE_DATA_MARKER.json"),
        makeCtx(),
      );
      const responseBody = await result.response!.text();
      const logs = JSON.stringify(entries);

      assertEquals(result.response?.status, 500);
      assertEquals(responseBody.includes("private-data-error"), false);
      assertEquals(logs.includes("private-data-error"), false);
      assertEquals(logs.includes("PRIVATE_DATA_MARKER"), false);
      assertEquals(logs.includes("/private/project/page.tsx"), false);
    });

    it("returns not found only for a typed not-found error", async () => {
      setRendererInitializer(createInitializer({
        renderPage: () => {
          throw FILE_NOT_FOUND.create({ detail: "Page is unavailable" });
        },
      }));

      const result = await new ModuleHandler().handle(
        new Request("http://localhost/_veryfront/data/missing.json"),
        makeCtx(),
      );

      assertEquals(result.response?.status, 404);
    });
  });

  describe("deprecated virtual modules", () => {
    it("returns 410 without initializing a renderer", async () => {
      let rendererCalls = 0;
      setRendererInitializer({
        initialize: () => {
          rendererCalls++;
          return Promise.reject(new Error("renderer should not be initialized"));
        },
        isInitialized: () => false,
        get: () => {
          throw new Error("renderer should not be read");
        },
        destroy: () => Promise.resolve(),
      });

      const handler = new ModuleHandler();
      const result = await handler.handle(
        new Request("http://localhost/_veryfront/modules/legacy.js"),
        makeCtx(),
      );

      assertEquals(result.response?.status, 410);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(rendererCalls, 0);
    });
  });
});
