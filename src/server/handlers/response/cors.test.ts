import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import { CorsHandler } from "./cors.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter as createFileBackedMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { clearConfigCache } from "#veryfront/config";

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
    ...overrides,
  };
}

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
      // Preflight is policy-driven: allow-* headers are only emitted for an
      // origin the CORS policy admits.
      const ctx = makeCtx({
        securityConfig: { cors: { origin: ["http://localhost:3000"] } } as never,
      });
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

    it("does not resolve or import project routes in a shared runtime", async () => {
      let routeResolutionCalls = 0;
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          routeResolutionCalls++;
          throw new Error("shared preflight reached project route discovery");
        },
      });
      const result = await handler.handle(
        new Request("https://tenant.example/api/private", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
          },
        }),
        makeCtx({
          prepareHostedConfigContext: (() => {
            throw new Error("shared preflight prepared project config");
          }) as HandlerContext["prepareHostedConfigContext"],
        }),
      );

      assertEquals(result.response instanceof Response, true);
      assertEquals(routeResolutionCalls, 0);
    });

    it("does not advertise infrastructure-only request headers", async () => {
      const result = await new CorsHandler().handle(
        new Request("http://localhost/api/test", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
            "access-control-request-headers":
              "Authorization, X-Token, X-Project-Id, X-Veryfront-Dispatch-JWS, X-App-Trace",
          },
        }),
        makeCtx({
          securityConfig: { cors: { origin: ["https://app.example"] } } as never,
        }),
      );

      assertEquals(
        result.response?.headers.get("access-control-allow-headers"),
        "Authorization, X-App-Trace",
      );
    });

    it("advertises only the methods the matched route module exports", async () => {
      await withTempDir(async (routeDir) => {
        const routeFile = `${routeDir}/route.ts`;
        await writeTextFile(
          routeFile,
          "export function GET() { return new Response('ok'); }\n",
        );
        const handler = new CorsHandler({
          resolveAppRouteFile: () => Promise.resolve({ file: routeFile, params: {} }),
        });
        const result = await handler.handle(
          new Request("http://localhost/api/only-get", {
            method: "OPTIONS",
            headers: {
              origin: "http://localhost:3000",
              "access-control-request-method": "GET",
            },
          }),
          makeCtx({
            securityConfig: { cors: { origin: ["http://localhost:3000"] } } as never,
          }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "HEAD, GET, OPTIONS",
          "preflight must advertise exactly the exported methods plus HEAD and OPTIONS",
        );
      }, { prefix: "vf-cors-route-" });
    });

    it("lets the project config file override the request-context CORS policy", async () => {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.js`;
        const source = [
          "export default {",
          '  security: { cors: { origin: ["https://allowed.example"] } },',
          "};",
        ].join("\n");
        const adapter = createFileBackedMockAdapter();
        try {
          clearConfigCache();
          await writeTextFile(configPath, source);
          adapter.fs.files.set(configPath, source);
          const ctx = makeCtx({
            projectDir,
            adapter,
            securityConfig: { cors: { origin: ["https://ctx-only.example"] } } as never,
          });
          const preflight = (origin: string) =>
            new Request("http://localhost/api/test", {
              method: "OPTIONS",
              headers: { origin, "access-control-request-method": "POST" },
            });

          const allowed = await new CorsHandler().handle(
            preflight("https://allowed.example"),
            ctx,
          );
          assertEquals(
            allowed.response?.headers.get("access-control-allow-origin"),
            "https://allowed.example",
            "the project config CORS policy must win on preflight",
          );

          const denied = await new CorsHandler().handle(
            preflight("https://ctx-only.example"),
            ctx,
          );
          assertEquals(
            denied.response?.headers.get("access-control-allow-origin"),
            null,
            "an origin only the request context allows must be denied once the config file speaks",
          );
        } finally {
          clearConfigCache();
        }
      }, { prefix: "vf-cors-config-" });
    });
  });
});
