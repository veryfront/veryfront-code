import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { CorsHandler } from "./cors.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearConfigCache } from "#veryfront/config";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

const ROUTE_IMPORT_CANARY = "__VERYFRONT_CORS_ROUTE_IMPORT_CANARY__";

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

function createLocalFsAdapter(onAccess: () => void): RuntimeAdapter {
  const adapter = createMockAdapter();
  adapter.fs.exists = async (path) => {
    onAccess();
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  };
  adapter.fs.stat = async (path) => {
    onAccess();
    return await Deno.stat(path);
  };
  adapter.fs.readDir = async function* (path) {
    onAccess();
    for await (const entry of Deno.readDir(path)) yield entry;
  };
  return adapter;
}

afterEach(() => {
  clearConfigCache();
  __resetLogRecordEmitterForTests();
  delete (globalThis as Record<string, unknown>)[ROUTE_IMPORT_CANARY];
});

describe("server/handlers/response/cors", () => {
  describe("CorsHandler", () => {
    it("has correct metadata", () => {
      const handler = new CorsHandler();
      assertEquals(handler.metadata.name, "CorsHandler");
      assertEquals(handler.metadata.patterns?.length, 1);
      assertEquals(handler.metadata.patterns?.[0]?.method, "OPTIONS");
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
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "http://localhost:3000",
            methods: ["POST"],
            allowedHeaders: ["Authorization", "Content-Type"],
          },
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
      // Should have allow-methods header
      const methods = result.response?.headers.get("access-control-allow-methods") ?? "";
      assertEquals(methods.length > 0, true);
    });

    it("does not inspect or import remote project code for OPTIONS", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "veryfront-cors-remote-" });
      let fsAccesses = 0;
      let configReads = 0;

      try {
        const routeDir = `${projectDir}/app/api/canary`;
        await Deno.mkdir(routeDir, { recursive: true });
        await Deno.writeTextFile(
          `${routeDir}/route.ts`,
          `globalThis.${ROUTE_IMPORT_CANARY} = true;\n` +
            `export function POST() { return new Response("unsafe"); }\n`,
        );

        const config = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(config, "security", {
          enumerable: true,
          get() {
            configReads++;
            throw new Error("PRIVATE_REMOTE_CONFIG_CANARY");
          },
        });
        const ctx = makeCtx({
          projectDir,
          adapter: createLocalFsAdapter(() => fsAccesses++),
          config: config as HandlerContext["config"],
          isLocalProject: false,
          securityConfig: {
            cors: {
              origin: "https://app.example.com",
              methods: ["POST"],
              allowedHeaders: ["Content-Type"],
            },
          },
        });

        const result = await new CorsHandler().handle(
          new Request("https://runtime.example.com/api/canary", {
            method: "OPTIONS",
            headers: {
              origin: "https://app.example.com",
              "access-control-request-method": "POST",
              "access-control-request-headers": "Content-Type",
            },
          }),
          ctx,
        );

        assertEquals(result.response?.status, 204);
        assertEquals(result.response?.headers.get("access-control-allow-methods"), "POST, OPTIONS");
        assertEquals(fsAccesses, 0);
        assertEquals(configReads, 0);
        assertEquals((globalThis as Record<string, unknown>)[ROUTE_IMPORT_CANARY], undefined);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
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

    it("rejects request headers outside the configured allowlist", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type, X-Admin-Override",
        },
      });
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["POST"],
            allowedHeaders: ["Content-Type"],
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 403);
      assertEquals(result.response?.headers.get("access-control-allow-headers"), null);
    });

    it("rejects request methods outside the configured allowlist", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "DELETE",
        },
      });
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["GET", "POST"],
            allowedHeaders: ["Content-Type"],
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 403);
      assertEquals(result.response?.headers.get("access-control-allow-methods"), null);
    });

    it("rejects a configured preflight without a requested method", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" },
      });
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["GET"],
            allowedHeaders: ["Content-Type"],
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 403);
      assertEquals(result.response?.headers.get("x-cors-error"), "Request method is required");
    });

    it("returns only configured request headers for an accepted preflight", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["POST"],
            allowedHeaders: ["Content-Type"],
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 204);
      assertEquals(result.response?.headers.get("access-control-allow-headers"), "Content-Type");
    });

    it("logs only bounded error names when local route and config inspection fail", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const adapter = createMockAdapter();
      adapter.fs.stat = () => Promise.reject(new Error("PRIVATE_ROUTE_RESOLUTION_CANARY"));
      adapter.fs.exists = () => Promise.reject(new Error("PRIVATE_CONFIG_LOAD_CANARY"));
      const ctx = makeCtx({
        projectDir: "/PRIVATE_PROJECT_PATH_CANARY",
        projectSlug: "PRIVATE_PROJECT_SLUG_CANARY",
        adapter,
        isLocalProject: true,
      });

      const result = await new CorsHandler().handle(
        new Request("http://localhost/PRIVATE_REQUEST_PATH_CANARY", { method: "OPTIONS" }),
        ctx,
      );

      assertEquals(result.response?.status, 204);
      const serialized = JSON.stringify(entries);
      for (
        const canary of [
          "PRIVATE_ROUTE_RESOLUTION_CANARY",
          "PRIVATE_CONFIG_LOAD_CANARY",
          "PRIVATE_PROJECT_PATH_CANARY",
          "PRIVATE_PROJECT_SLUG_CANARY",
          "PRIVATE_REQUEST_PATH_CANARY",
        ]
      ) {
        assertEquals(serialized.includes(canary), false);
      }
      const corsFailures = entries.filter((entry) => entry.message.includes("CorsHandler"));
      assertEquals(corsFailures.length, 2);
      assertEquals(corsFailures[0]?.context, { errorName: "Error" });
      assertEquals(corsFailures[1]?.context, { errorName: "VeryfrontError" });
    });
  });
});
