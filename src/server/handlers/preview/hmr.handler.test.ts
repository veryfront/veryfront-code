import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { HMRHandler } from "./hmr.handler.ts";

function createMockAdapter(
  serverOverrides: Record<string, unknown> = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {},
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
    server: serverOverrides,
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
  } as unknown as HandlerContext;
}

describe("server/handlers/preview/hmr.handler", () => {
  afterEach(() => {
    HMRHandler.shutdown();
  });

  describe("metadata", () => {
    it("has correct name", () => {
      const handler = new HMRHandler();
      assertEquals(handler.metadata.name, "HMRHandler");
    });

    it("has pattern for /_ws", () => {
      const handler = new HMRHandler();
      assertEquals(handler.metadata.patterns?.[0]?.pattern, "/_ws");
    });

    it("enabled returns true", () => {
      const handler = new HMRHandler();
      assertEquals(
        typeof handler.metadata.enabled === "function"
          ? handler.metadata.enabled(makeCtx())
          : handler.metadata.enabled,
        true,
      );
    });
  });

  describe("static methods", () => {
    it("getClientCount returns number", () => {
      assertEquals(typeof HMRHandler.getClientCount(), "number");
    });

    it("getMetrics returns expected shape", () => {
      const metrics = HMRHandler.getMetrics();
      assertEquals("clients" in metrics, true);
      assertEquals("broadcastsSent" in metrics, true);
      assertEquals("messagesForwarded" in metrics, true);
      assertEquals("lastBroadcastTime" in metrics, true);
    });

    it("registerExternalBroadcastSource returns unsubscribe", () => {
      const unsub = HMRHandler.registerExternalBroadcastSource();
      assertEquals(typeof unsub, "function");
      unsub();
    });

    it("shutdown does not throw", () => {
      HMRHandler.shutdown();
    });

    it("multiple shutdowns are safe", () => {
      HMRHandler.shutdown();
      HMRHandler.shutdown();
    });
  });

  describe("handle - path filtering", () => {
    it("continues for non-/_ws paths", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/other-path");
      const result = await handler.handle(req, makeCtx());
      assertEquals(result.continue, true);
    });

    it("continues for /_ws prefix without exact match", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws/sub");
      const result = await handler.handle(req, makeCtx());
      assertEquals(result.continue, true);
    });
  });

  describe("handle - mode check", () => {
    it("continues when not preview, not local, and not localhost", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://production.example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("proceeds when isLocalProject is true", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://production.example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      // Should NOT continue (it enters the handler path)
      assertEquals(result.continue, false);
    });

    it("proceeds when mode is preview", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("proceeds when x-environment=preview query param is set", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws?x-environment=preview");
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("proceeds when host header is localhost", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("proceeds when x-forwarded-host is a local preview host AND request is proxy-trusted", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-veryfront-dispatch-jws": "test-jws",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("continues when x-forwarded-host is external even if host header is localhost", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "evil.example.com",
          "x-veryfront-dispatch-jws": "test-jws",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("IGNORES x-forwarded-host: localhost when request is NOT proxy-trusted (VULN-SRV-4)", async () => {
      // Without proxy trust, the forwarded host must not be allowed to unlock the
      // localhost short-circuit that enables HMR. Otherwise any remote client could
      // claim to be localhost and open a WebSocket against the dev runtime.
      const handler = new HMRHandler();
      const req = new Request("http://evil.example.com/_ws", {
        headers: {
          host: "evil.example.com",
          "x-forwarded-host": "localhost",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("IGNORES x-forwarded-host: 127.0.0.1 when request is NOT proxy-trusted", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://evil.example.com/_ws", {
        headers: {
          host: "evil.example.com",
          "x-forwarded-host": "127.0.0.1",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("HONOURS x-forwarded-host: localhost when request IS proxy-trusted", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "localhost",
          "x-veryfront-dispatch-jws": "test-jws",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      // Handler path entered — not short-circuited.
      assertEquals(result.continue, false);
    });

    it("HONOURS raw Host: localhost even without proxy trust (bare-metal local dev)", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it('treats "localhost.evil.com" as non-local (must not match by prefix)', async () => {
      // Regression: any substring-match on "localhost" would be dangerous; isLocalDevHost
      // uses precise matching, and this test locks that behaviour in.
      const handler = new HMRHandler();
      const req = new Request("http://localhost.evil.com/_ws", {
        headers: { host: "localhost.evil.com" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("handle - non-websocket request", () => {
    it("returns JSON status when not a websocket upgrade", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws");
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter(),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 200);
      const body = await result.response!.json();
      assertEquals(body.status, "ok");
      assertEquals("clients" in body, true);
      assertEquals("metrics" in body, true);
    });
  });

  describe("handle - websocket upgrade", () => {
    it("returns 501 when adapter.server is missing", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: {
          ...createMockAdapter(),
          server: undefined,
        } as unknown as RuntimeAdapter,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response!.status, 501);
    });

    it("returns 500 when upgradeWebSocket throws", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({
          upgradeWebSocket: () => {
            throw new Error("upgrade failed");
          },
        }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response!.status, 500);
    });
  });
});
