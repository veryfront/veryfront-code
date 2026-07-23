import "#veryfront/schemas/_test-setup.ts";
/**
 * LibModulesHandler Tests
 *
 * Tests the allowed modules whitelist and module path resolution logic.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "../types.ts";
import { LIB_MODULE_PATHS, LibModulesHandler } from "./lib-modules.handler.ts";

const CHAT_MODULE_PATH = "/project/node_modules/veryfront/esm/src/chat/index.js";

function createMockAdapter(
  readFile: (path: string) => Promise<string>,
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
      exists: () => Promise.resolve(true),
      readFile,
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 1,
          mtime: null,
        }),
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
}

function createContext(readFile: (path: string) => Promise<string>): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(readFile),
    securityConfig: {},
    cspUserHeader: null,
    config: {
      client: { moduleResolution: "self-hosted" },
    } as HandlerContext["config"],
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
  } as HandlerContext;
}

function createHandler(): LibModulesHandler {
  return new LibModulesHandler();
}

function getPattern(handler: LibModulesHandler, method: string): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns?.length) throw new Error("No patterns defined");

  const pattern = patterns.find((p) => p.method === method)?.pattern;
  if (!(pattern instanceof RegExp)) {
    throw new Error(`Pattern for method ${method} not found or not a RegExp`);
  }

  return pattern;
}

describe("LibModulesHandler", () => {
  describe("metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "LibModulesHandler");
    });

    it("should have priority defined", () => {
      const handler = createHandler();
      assertExists(handler.metadata.priority);
      assertEquals(typeof handler.metadata.priority, "number");
    });

    it("should have two patterns (GET and HEAD)", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns?.length, 2);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/components/chat.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "HEAD");
      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
    });

    it("should not match other paths", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/api/users"), false);
      assertEquals(pattern.test("/veryfront/lib/chat/react.js"), false);
      assertEquals(pattern.test("/"), false);
    });
  });

  describe("ALLOWED_MODULES whitelist", () => {
    it("should resolve allowed self-hosted module paths", () => {
      assertEquals(LIB_MODULE_PATHS["chat.js"], "esm/src/chat/index.js");
      assertEquals(LIB_MODULE_PATHS["markdown.js"], "esm/src/markdown/index.js");
      assertEquals(LIB_MODULE_PATHS["mdx.js"], "esm/src/mdx/index.js");
      assertEquals(LIB_MODULE_PATHS["workflow.js"], "esm/src/workflow/react/index.js");
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/veryfront/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_veryfront/agent/react.js"), false);
      assertEquals(pattern.test("/lib/agent/react.js"), false);
    });

    it("should be case sensitive", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_VERYFRONT/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_Veryfront/lib/agent/react.js"), false);
    });
  });

  describe("handler instance", () => {
    it("should be instantiable", () => {
      const handler = createHandler();
      assertExists(handler);
    });

    it("should have handle method", () => {
      const handler = createHandler();
      assertEquals(typeof handler.handle, "function");
    });

    it("should extend BaseHandler", () => {
      const handler = createHandler();
      assertExists(handler.metadata);
      assertExists(handler.handle);
    });
  });

  describe("filesystem failures", () => {
    it("returns a private 500 when an allowed module cannot be read", async () => {
      const ctx = createContext((path) => {
        assertEquals(path, CHAT_MODULE_PATH);
        return Promise.reject(
          new Deno.errors.PermissionDenied("private-canary /private/module/path"),
        );
      });

      const result = await createHandler().handle(
        new Request("http://localhost/_veryfront/lib/chat.js"),
        ctx,
      );

      assertEquals(result.response?.status, 500);
      assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
      const body = await result.response!.text();
      assertEquals(body.includes("private-canary"), false);
      assertEquals(body.includes("/private/module/path"), false);
    });

    it("returns a secured 404 for a genuinely missing allowed module", async () => {
      const ctx = createContext(() => Promise.reject(new Deno.errors.NotFound("missing")));

      const result = await createHandler().handle(
        new Request("http://localhost/_veryfront/lib/chat.js"),
        ctx,
      );

      assertEquals(result.response?.status, 404);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
      assertEquals(await result.response!.text(), "Module not found");
    });

    it("rejects an oversized module before reading it into memory", async () => {
      let readCalls = 0;
      const ctx = createContext(() => {
        readCalls += 1;
        return Promise.resolve("export {};");
      });
      ctx.adapter.fs.stat = () =>
        Promise.resolve({
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 17 * 1024 * 1024,
          mtime: null,
        });

      const result = await createHandler().handle(
        new Request("http://localhost/_veryfront/lib/chat.js"),
        ctx,
      );

      assertEquals(result.response?.status, 500);
      assertEquals(readCalls, 0);
      assertEquals(await result.response!.text(), "Module unavailable");
    });
  });
});
