import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  getRSCHandler,
  type HandlerCache,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import type { RSCDevServerHandler } from "#veryfront/server/services/rsc/orchestrators/index.ts";
import { RequestHandler } from "./request-handler.ts";

function createHandlerCache(): HandlerCache<RSCDevServerHandler> {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => entries.set(key, value),
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

function createRequestHandler(
  config?: VeryfrontConfig,
  runtimeHandler?: (request: Request) => Promise<Response>,
): RequestHandler {
  return new RequestHandler(
    "/project/a",
    {
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter,
    () => true,
    () => false,
    config,
    "project-a",
    "project-a-id",
    undefined,
    runtimeHandler ? { runtimeHandlerFactory: () => Promise.resolve(runtimeHandler) } : {},
  );
}

describe("server/dev-server/request-handler", () => {
  afterEach(() => __destroyRSCHandlerForTests());

  it("invalidates the project RSC handler during file-change invalidation", () => {
    __injectCacheForTests(createHandlerCache());
    const handlerOptions = {
      mode: "development" as const,
      config: { react: { version: "19.1.1" } },
    };
    const before = getRSCHandler("/project/a", "project-a", handlerOptions);
    const requestHandler = new RequestHandler(
      "/project/a",
      {} as RuntimeAdapter,
      () => true,
      () => false,
      undefined,
      undefined,
      "project-a",
    );

    requestHandler.invalidateRuntimeHandler();

    const after = getRSCHandler("/project/a", "project-a", handlerOptions);
    assertEquals(after !== before, true);
  });

  it("applies bootstrap CORS once to exact server-owned responses", async () => {
    let validatorCalls = 0;
    const origin = "https://client.example";
    const runtimeConfig = {
      security: {
        cors: {
          origin: async (candidate: string) => {
            validatorCalls++;
            return candidate === origin;
          },
        },
      },
      // Project schemas are synchronous, but this boundary accepts the shared
      // CORS contract and must not duplicate an unvalidated async callback.
    } as unknown as VeryfrontConfig;
    const handler = createRequestHandler(runtimeConfig);

    const response = await handler.handleRequest(
      new Request("http://localhost/healthz", {
        headers: { origin },
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
    assertEquals(validatorCalls, 1);
  });

  it("preserves the allow-any semantics of CORS=true on owned endpoints", async () => {
    const origin = "https://client.example";
    const handler = createRequestHandler({
      security: { cors: true },
    });

    const response = await handler.handleRequest(
      new Request("http://localhost/_veryfront/error-overlay.js", {
        headers: { origin },
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
  });

  it("answers exact owned preflights with read-only endpoint capabilities", async () => {
    const origin = "https://client.example";
    const handler = createRequestHandler({
      security: { cors: { origin } },
    });

    for (
      const pathname of [
        "/readyz",
        "/_veryfront/error-overlay.js",
        "/__veryfront/error-overlay.js",
      ]
    ) {
      const response = await handler.handleRequest(
        new Request(`http://localhost${pathname}`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
          },
        }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("access-control-allow-origin"), origin);
      assertEquals(
        response.headers.get("access-control-allow-methods"),
        "GET, HEAD, OPTIONS",
      );
    }
  });

  it("keeps explicitly disabled CORS disabled on owned preflights", async () => {
    const handler = createRequestHandler({
      security: { cors: false },
    });

    const response = await handler.handleRequest(
      new Request("http://localhost/healthz", {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-headers": "authorization",
        },
      }),
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("access-control-allow-origin"), null);
    assertEquals(response.headers.get("access-control-allow-methods"), null);
  });

  it("passes non-owned and plain OPTIONS requests to the runtime unchanged", async () => {
    const seen: string[] = [];
    const handler = createRequestHandler(
      { security: { cors: true } },
      (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return Promise.resolve(
          new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": "https://tenant.example",
              "access-control-allow-methods": "GET, HEAD, PATCH, OPTIONS",
            },
          }),
        );
      },
    );

    for (
      const request of [
        new Request("http://localhost/healthz-near", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "PATCH",
          },
        }),
        new Request("http://localhost/_veryfront/error-overlay.js.map", {
          method: "OPTIONS",
          headers: {
            origin: "https://client.example",
            "access-control-request-method": "GET",
          },
        }),
        new Request("http://localhost/api/test", { method: "OPTIONS" }),
      ]
    ) {
      const response = await handler.handleRequest(request);
      assertEquals(
        response.headers.get("access-control-allow-origin"),
        "https://tenant.example",
      );
      assertEquals(
        response.headers.get("access-control-allow-methods"),
        "GET, HEAD, PATCH, OPTIONS",
      );
    }

    assertEquals(seen, [
      "OPTIONS /healthz-near",
      "OPTIONS /_veryfront/error-overlay.js.map",
      "OPTIONS /api/test",
    ]);
  });

  it("does not apply bootstrap CORS to application results or overlay errors", async () => {
    const origin = "https://client.example";
    const applicationHandler = createRequestHandler(
      { security: { cors: true } },
      () =>
        Promise.resolve(
          new Response("timed out", {
            status: 504,
            headers: { "access-control-allow-origin": "https://tenant.example" },
          }),
        ),
    );

    const applicationResponse = await applicationHandler.handleRequest(
      new Request("http://localhost/app", { headers: { origin } }),
    );
    assertEquals(applicationResponse.status, 504);
    assertEquals(
      applicationResponse.headers.get("access-control-allow-origin"),
      "https://tenant.example",
    );

    const errorHandler = createRequestHandler(
      { security: { cors: true } },
      () => Promise.reject(new Error("runtime failure")),
    );
    const errorResponse = await errorHandler.handleRequest(
      new Request("http://localhost/app", { headers: { origin } }),
    );
    assertEquals(errorResponse.status, 500);
    assertEquals(errorResponse.headers.get("access-control-allow-origin"), null);
  });
});
