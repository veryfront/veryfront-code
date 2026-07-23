import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeRequestHandler,
  type RuntimeResponse,
} from "#veryfront/platform/adapters/base.ts";
import {
  __getActivePerfRequestCountForTests,
  __resetPerfTimerForTests,
} from "#veryfront/utils/perf-timer.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { __injectDepsForTests as injectApiHandlerDepsForTests } from "../../routing/api/handler.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { createNoHandlerResponse, createVeryfrontHandler } from "./index.ts";
import { __injectDepsForTests as injectIsolationDepsForTests } from "./isolation.ts";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {
      exists: () => Promise.resolve(false),
    } as unknown as RuntimeAdapter["fs"],
    env: {
      get: (_key: string) => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

function createProxyModeHandler() {
  injectIsolationDepsForTests({
    checkRequest: () => ({ allowed: true }),
    startRequest: () => {},
    completeRequest: () => {},
  });

  return createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
    projectDir: "/tmp/test-project",
    config: {
      fs: { veryfront: { proxyMode: true } },
    } as any,
  });
}

function expectResponse(response: RuntimeResponse): Response {
  if (!(response instanceof Response)) throw new Error("Expected an HTTP response");
  return response;
}

describe("server/runtime-handler/index", () => {
  afterEach(() => {
    injectIsolationDepsForTests(null);
    HMRHandler.shutdown();
    Deno.env.delete("VERYFRONT_PERF");
    __resetPerfTimerForTests();
    __resetLogRecordEmitterForTests();
    injectApiHandlerDepsForTests(null);
    defaultDiscoveryCache.clear();
  });

  it("returns 502 when x-project-slug is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: { "x-token": "proxy-token" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await expectResponse(response).json(), {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
  });

  it("omits request identity and route data from structured logs", async () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const handler = createProxyModeHandler();

    await handler(
      new Request(
        "http://private-domain-canary.example/private-route-canary?customer_note=private-query-canary",
        {
          headers: {
            host: "private-domain-canary.example",
            "x-project-slug": "private-project-canary",
            "x-project-id": "private-project-id-canary",
            "x-release-id": "private-release-canary",
            "x-branch-id": "private-branch-id-canary",
            "x-branch-name": "private-branch-name-canary",
          },
        },
      ),
    );

    const serializedEntries = JSON.stringify(entries);
    for (
      const privateValue of [
        "private-domain-canary",
        "private-route-canary",
        "private-query-canary",
        "private-project-canary",
        "private-project-id-canary",
        "private-release-canary",
        "private-branch-id-canary",
        "private-branch-name-canary",
      ]
    ) {
      assertEquals(serializedEntries.includes(privateValue), false);
    }
    assertEquals(entries.some((entry) => entry.request_url !== undefined), false);
    assertEquals(entries.some((entry) => entry.requestId !== undefined), false);
    assertEquals(entries.some((entry) => entry.request_id !== undefined), false);
    assertEquals(entries.some((entry) => entry.domain !== undefined), false);
    assertEquals(entries.some((entry) => entry.project_slug !== undefined), false);
    assertEquals(entries.some((entry) => entry.project_id !== undefined), false);
    assertEquals(entries.some((entry) => entry.release_id !== undefined), false);
  });

  it("does not expose local project mappings in debug logs", () => {
    const entries: LogEntry[] = [];
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
    try {
      __registerLogRecordEmitter((entry) => entries.push(entry));

      createVeryfrontHandler("fixtures/runtime-root-canary", createMockAdapter(), {
        projectDir: "fixtures/runtime-root-canary",
        debug: true,
        config: { fs: { veryfront: { proxyMode: true } } } as never,
        localProjects: {
          "private-local-project-canary": "fixtures/local-project-path-canary",
        },
      });

      const serializedEntries = JSON.stringify(entries);
      for (
        const privateValue of [
          "fixtures/runtime-root-canary",
          "private-local-project-canary",
          "fixtures/local-project-path-canary",
        ]
      ) {
        assertEquals(serializedEntries.includes(privateValue), false);
      }
    } finally {
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      __resetLoggerConfigForTests();
    }
  });

  it("logs only the error type when API initialization fails", async () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    injectApiHandlerDepsForTests({
      getConfig: () => Promise.resolve({}),
    });

    const adapter = createMockAdapter();
    adapter.fs = {
      exists: () => Promise.reject(new Error("private-init-error-canary")),
    } as unknown as RuntimeAdapter["fs"];
    const handler = createVeryfrontHandler(
      "fixtures/init-project-path-canary",
      adapter,
      {
        projectDir: "fixtures/init-project-path-canary",
        config: {},
      },
    );

    await assertRejects(
      () => handler.ready ?? Promise.resolve(),
      Error,
      "private-init-error-canary",
    );

    const initializationEntry = entries.find((entry) =>
      entry.message === "API handler initialization failed"
    );
    assertExists(initializationEntry);
    const serializedEntry = JSON.stringify(initializationEntry);
    assertEquals(serializedEntry.includes("private-init-error-canary"), false);
    assertEquals(serializedEntry.includes("fixtures/init-project-path-canary"), false);
    assertEquals(initializationEntry.context?.errorName, "Error");
  });

  it("omits request-specific data from the no-handler problem response", async () => {
    const response = createNoHandlerResponse();
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(body.instance, undefined);
  });

  it("keeps explicit local-project mappings scoped to the handler instance", () => {
    createVeryfrontHandler("/tmp/test-project", createMockAdapter(), {
      projectDir: "/tmp/test-project",
      localProjects: { "private-project": "/tmp/private-project" },
    });

    assertEquals(defaultDiscoveryCache.projects.size, 0);
    assertEquals(defaultDiscoveryCache.adapters.size, 0);
  });

  it("ends the request lifecycle when isolation rejects the request", async () => {
    Deno.env.set("VERYFRONT_PERF", "1");
    __resetPerfTimerForTests();
    injectIsolationDepsForTests({
      checkRequest: () => ({ allowed: false, reason: "max_concurrent" }),
    });
    const handler = createVeryfrontHandler("/tmp/test-project", createMockAdapter());

    const response = await handler(new Request("http://localhost/page"));

    assertEquals(response.status, 503);
    assertEquals(__getActivePerfRequestCountForTests(), 0);
  });

  it("returns 502 when x-token is missing in proxy mode", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: { "x-project-slug": "my-project" },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await expectResponse(response).json(), {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("allows standard first-party proxy context headers without an extra trust proof", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "proxy-token",
          "x-forwarded-host": "my-project.production.veryfront.com",
          "x-release-id": "rel_123",
        },
      }),
    );

    assertEquals(response.status === 502, false);
    const body = await expectResponse(response).text();
    assertEquals(body.includes("proxy context headers require a trusted upstream proxy"), false);
  });

  it("returns 502 when trust-sensitive proxy context headers are present but untrusted", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "my-project",
          "x-token": "spoofed-token",
          "x-project-path": "/attacker/chosen/path",
        },
      }),
    );

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(await expectResponse(response).json(), {
      error: "Untrusted proxy context",
      detail: "proxy context headers require a trusted upstream proxy",
    });
  });

  it("skips the proxy header guard for a trusted preview websocket request", async () => {
    const previousTrust = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    try {
      const handler = createProxyModeHandler();
      const response = await handler(
        new Request("http://internal.proxy/_ws", {
          headers: {
            origin: "https://test-project.preview.veryfront.com",
            "x-forwarded-host": "test-project.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-project-slug": "test-project",
          },
        }),
      );

      assertEquals(response.status, 200);
      assertEquals(await expectResponse(response).json(), { status: "ok", clients: 0 });
    } finally {
      if (previousTrust === undefined) Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      else Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrust);
    }
  });

  it("preserves the WebSocket upgrade response contract", async () => {
    const previousTrust = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    try {
      const adapter = createMockAdapter();
      const upgradeResponse = createWebSocketUpgradeResponse();
      let upgradedRequest: Request | undefined;
      adapter.server = {
        upgradeWebSocket: (request) => {
          upgradedRequest = request;
          return {
            socket: {
              readyState: WebSocket.OPEN,
              send: () => {},
              close: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
            },
            response: upgradeResponse,
          };
        },
      };
      const handler: RuntimeRequestHandler = createVeryfrontHandler(
        "/tmp/test-project",
        adapter,
        {
          projectDir: "/tmp/test-project",
          config: { fs: { veryfront: { proxyMode: true } } } as never,
        },
      );

      const request = new Request("http://internal.proxy/_ws", {
        headers: {
          upgrade: "websocket",
          origin: "https://test-project.preview.veryfront.com",
          "x-forwarded-host": "test-project.preview.veryfront.com",
          "x-forwarded-proto": "https",
          "x-project-slug": "test-project",
        },
      });
      const response = await handler(request);

      assertEquals(Object.is(upgradedRequest, request), true);
      assertEquals(Object.is(response, upgradeResponse), true);
    } finally {
      if (previousTrust === undefined) Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
      else Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrust);
    }
  });

  it("skips the proxy header guard for lightweight module requests", async () => {
    const handler = createProxyModeHandler();

    const response = await handler(
      new Request("http://localhost/_veryfront/hydration-runtime.js", {
        headers: { "x-release-id": "rel_123" },
      }),
    );

    assertEquals(response.status === 502, false);
    const body = await expectResponse(response).text();
    assertEquals(body.includes("x-project-slug header is required in proxy mode"), false);
    assertEquals(body.includes("x-token header is required in proxy mode"), false);
  });
});
