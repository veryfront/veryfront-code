import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ModuleHandler } from "./module.handler.ts";
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

describe("server/handlers/request/module/module.handler", () => {
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
});
