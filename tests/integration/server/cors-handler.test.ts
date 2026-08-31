import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { clearConfigCache } from "#veryfront/config";
import { APIRouteHandler } from "#veryfront/routing/api/index.ts";

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
    await withTempDir(async (projectDir) => {
      const apiDir = `${projectDir}/pages/api`;
      const routeFile = `${apiDir}/only-get.ts`;
      await mkdir(apiDir, { recursive: true });
      await writeTextFile(
        routeFile,
        "export function GET() { return new Response('ok'); }\n",
      );
      await writeTextFile(
        `${projectDir}/veryfront.config.js`,
        'export default { security: { cors: { origin: ["http://localhost:3000"] } } };\n',
      );
      const handler = new APIRouteHandler(projectDir);
      await handler.initialize();
      try {
        const response = await handler.handle(
          new Request("http://localhost/api/only-get", {
            method: "OPTIONS",
            headers: {
              origin: "http://localhost:3000",
              "access-control-request-method": "GET",
            },
          }),
          makeCtx({ projectDir, isLocalProject: true }),
        );
        assertEquals(
          response?.headers.get("access-control-allow-methods"),
          "GET, HEAD, OPTIONS",
          "preflight must advertise exactly the exported methods plus HEAD and OPTIONS",
        );
      } finally {
        handler.destroy();
      }
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
        const handler = new APIRouteHandler(projectDir);
        await handler.initialize();
        try {
          const allowed = await handler.handle(
            preflight("https://allowed.example"),
            ctx,
          );
          assertEquals(
            allowed?.headers.get("access-control-allow-origin"),
            "https://allowed.example",
            "the project config CORS policy must win on preflight",
          );

          const denied = await handler.handle(
            preflight("https://ctx-only.example"),
            ctx,
          );
          assertEquals(
            denied?.headers.get("access-control-allow-origin"),
            null,
            "an origin only the request context allows must be denied once the config file speaks",
          );
        } finally {
          handler.destroy();
        }
      } finally {
        clearConfigCache();
      }
    }, { prefix: "vf-cors-config-" });
  });
});
