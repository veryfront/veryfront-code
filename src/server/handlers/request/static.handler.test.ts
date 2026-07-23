import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { StaticHandler } from "./static.handler.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.8.0";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: {
      name: "test",
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: {},
    cspUserHeader: null,
    isLocalProject: false,
    requestContext: {
      mode: "production",
    } as HandlerContext["requestContext"],
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/static.handler", () => {
  it("serves generated production build assets under /_veryfront", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_veryfront/chunks/index.js",
          data: new TextEncoder().encode("export const page = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/chunks/index.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_veryfront/chunks/index.js");
    assertEquals(result.response.status, 200);
    assertEquals(
      result.response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(await result.response.text(), "export const page = true;");
  });

  it("serves generated hydration runtime under /_veryfront", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_veryfront/hydration-runtime.js",
          data: new TextEncoder().encode("export const hydrate = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/hydration-runtime.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_veryfront/hydration-runtime.js");
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.text(), "export const hydrate = true;");
  });

  it("serves local release assets under /_vf/assets", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return {
          path: "/tmp/test-project/dist/_vf/assets/hash.js",
          data: new TextEncoder().encode("export const react = true;"),
          etag: '"asset-etag"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        };
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_vf/assets/hash.js"),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(resolvedPath, "/_vf/assets/hash.js");
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.text(), "export const react = true;");
  });

  it("preserves the static cache policy on not-modified responses", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/app.js",
        data: new TextEncoder().encode("export const app = true;"),
        etag: 'W/"asset-etag"',
        contentType: "application/javascript; charset=utf-8",
        cacheStrategy: "immutable",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/app.js", {
        headers: { "If-None-Match": '"asset-etag"' },
      }),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 304);
    assertEquals(result.response.headers.get("etag"), 'W/"asset-etag"');
    assertEquals(
      result.response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(await result.response.text(), "");
  });

  it("lets missing generated page modules fall through to ModuleHandler", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return null;
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/pages/index.js"),
      makeCtx(),
    );

    assertEquals(resolvedPath, "/_veryfront/pages/index.js");
    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("lets missing generated data endpoints fall through to ModuleHandler", async () => {
    const handler = new StaticHandler();
    let resolvedPath = "";
    (handler as any).staticService = {
      resolveFile: async (pathname: string) => {
        resolvedPath = pathname;
        return null;
      },
      isAssetRequest: () => true,
    };

    const result = await handler.handle(
      new Request("http://localhost/_veryfront/data/index.json"),
      makeCtx(),
    );

    assertEquals(resolvedPath, "/_veryfront/data/index.json");
    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("adds matching nonces to static HTML responses before applying CSP", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/index.html",
        data: new TextEncoder().encode(
          [
            "<!doctype html>",
            "<html><head>",
            '<script type="importmap" nonce="build-nonce">{"imports":{"react":"https://esm.sh/react"}}</script>',
            '<style nonce="build-nonce">.chat{color:red}</style>',
            "</head><body>",
            '<script id="veryfront-hydration-data" type="application/json">{"page":"index"}</script>',
            `<script type="module">window.tpl="<script>alert(1)";</script>`,
            "</body></html>",
          ].join(""),
        ),
        etag: '"stale-etag"',
        contentType: "text/html; charset=utf-8",
        cacheStrategy: "medium",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(new Request("http://localhost/"), makeCtx());
    assertExists(result.response);

    const response = result.response;
    const body = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonceMatch = csp.match(/nonce-([^' ;]+)/);

    assertEquals(Boolean(nonceMatch), true);
    const nonce = nonceMatch![1]!;

    assertEquals(body.includes(`<script type="importmap" nonce="${nonce}">`), true);
    assertEquals(body.includes(`<style nonce="${nonce}">.chat{color:red}</style>`), true);
    assertEquals(body.includes('nonce="build-nonce"'), false);
    assertEquals(
      body.includes(
        `<script id="veryfront-hydration-data" type="application/json" nonce="${nonce}">{"page":"index"}</script>`,
      ),
      true,
    );
    assertEquals(
      body.includes(`window.tpl="<script>alert(1)";</script>`),
      true,
    );
    assertEquals(body.includes(`<script nonce="${nonce}">alert(1)`), false);
    assertEquals(response.headers.get("etag") === '"stale-etag"', false);
  });

  it("keeps request, project, and filesystem paths out of logs and traces", async () => {
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    refreshLoggerConfig();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    setGlobalTracerProvider(
      provider as unknown as Parameters<typeof setGlobalTracerProvider>[0],
    );
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/private/customer/project/dist/PRIVATE_FILE_CANARY.js",
        data: new TextEncoder().encode("export default true;"),
        etag: '"asset-etag"',
        contentType: "application/javascript; charset=utf-8",
        cacheStrategy: "immutable",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    try {
      const result = await handler.handle(
        new Request("http://localhost/private/PRIVATE_REQUEST_PATH.js"),
        makeCtx({ projectSlug: "PRIVATE_PROJECT_SLUG", debug: true }),
      );
      assertEquals(result.response?.status, 200);
      await provider.forceFlush();

      const diagnosticPayload = JSON.stringify({
        entries,
        spans: exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
        })),
      });
      for (
        const privateValue of [
          "PRIVATE_FILE_CANARY",
          "PRIVATE_REQUEST_PATH",
          "PRIVATE_PROJECT_SLUG",
          "/private/customer/project",
        ]
      ) {
        assertEquals(diagnosticPayload.includes(privateValue), false);
      }
    } finally {
      __resetLogRecordEmitterForTests();
      _resetShimForTests();
      await provider.shutdown();
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      refreshLoggerConfig();
    }
  });
});
