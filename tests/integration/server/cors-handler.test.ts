import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import { CorsHandler } from "#veryfront/server/handlers/response/cors.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { clearConfigCache } from "#veryfront/config";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/<PROJECT_DIR>",
    adapter: createMockAdapter(),
    securityConfig: null,
    ...overrides,
  };
}

describe("integration/server/cors-handler", () => {
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
      const adapter = createMockAdapter();
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
