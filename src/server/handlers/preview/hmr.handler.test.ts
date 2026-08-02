import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../types.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeAdapter,
  type WebSocketConnection,
} from "#veryfront/platform/adapters/base.ts";
import { HMRHandler } from "./hmr.handler.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

const encoder = new TextEncoder();

let signingKeyPair: CryptoKeyPair | undefined;

async function ensureKeyMaterial(): Promise<void> {
  if (signingKeyPair) return;
  signingKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function mintTrustedDispatchJws(): Promise<string> {
  await ensureKeyMaterial();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: "veryfront-api",
    aud: "demo-project",
    sub: "dispatch-hmr-test",
    project_id: "proj_123",
    platform: "slack",
    body_sha256: "n/a",
    iat: now,
    exp: now + 60,
  };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", signingKeyPair!.privateKey, signingInput);
  return `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

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

function createLocalRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", new URL(url).host);
  const request = new Request(url, { ...init, headers });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
    protocol: "http:",
  });
  return request;
}

function createMockSocket(): {
  socket: WebSocketConnection;
  sentMessages: string[];
  emit(type: string, event: unknown): void;
} {
  const listeners = new Map<string, Set<EventListener>>();
  const sentMessages: string[] = [];

  const socket: WebSocketConnection = {
    readyState: WebSocket.OPEN,
    send: (message) => {
      sentMessages.push(String(message));
    },
    close: () => {},
    addEventListener: (type, listener) => {
      let typeListeners = listeners.get(type);
      if (!typeListeners) {
        typeListeners = new Set();
        listeners.set(type, typeListeners);
      }
      typeListeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };

  return {
    socket,
    sentMessages,
    emit: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event);
      }
    },
  };
}

describe("server/handlers/preview/hmr.handler", () => {
  let previousProxyTrustEnv: string | undefined;

  beforeEach(() => {
    previousProxyTrustEnv = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
  });

  afterEach(() => {
    HMRHandler.shutdown();
    if (previousProxyTrustEnv === undefined) {
      Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    } else {
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousProxyTrustEnv);
    }
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
    it("rejects when not preview and not a local control request", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://production.example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("proceeds for a local control request", async () => {
      const handler = new HMRHandler();
      const req = createLocalRequest("http://localhost/_ws");
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      // Should NOT continue (it enters the handler path)
      assertEquals(result.continue, false);
    });

    it("proceeds for preview behind the trusted proxy topology", async () => {
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 200);
    });

    it("rejects an unsigned preview query parameter", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws?x-environment=preview");
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("rejects a localhost Host header without native peer provenance", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("ignores a local preview forwarded host when only a signed dispatch JWS is present", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("rejects production HMR when the trusted forwarded host is external", async () => {
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "evil.example.com",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("ignores a forwarded localhost host outside trusted proxy topology", async () => {
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
      assertEquals(result.response?.status, 403);
    });

    it("ignores a forwarded loopback address outside trusted proxy topology", async () => {
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
      assertEquals(result.response?.status, 403);
    });

    it("does not treat a trusted forwarded localhost host as preview", async () => {
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
      const handler = new HMRHandler();
      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "localhost",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it(
      "does not treat an unverifiable dispatch JWS as proxy topology proof",
      async () => {
        // Dispatch authorization and proxy topology are separate trust
        // boundaries. No dispatch token may authorize forwarded routing data.
        const handler = new HMRHandler();
        const req = new Request("http://evil.example.com/_ws", {
          headers: {
            host: "evil.example.com",
            "x-forwarded-host": "localhost",
            "x-veryfront-dispatch-jws": "eyJhbGciOi.fake.value",
          },
        });
        const ctx = makeCtx({
          isLocalProject: false,
          requestContext: { mode: "production" } as any,
        });
        const result = await handler.handle(req, ctx);
        assertEquals(result.response?.status, 403);
      },
    );

    it("honours a loopback transport and matching localhost authority", async () => {
      const handler = new HMRHandler();
      const req = createLocalRequest("http://localhost:3000/_ws", {
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
      // Local control requires exact authority matching as well as loopback
      // transport provenance; a hostname prefix is never sufficient.
      const handler = new HMRHandler();
      const req = new Request("http://localhost.evil.com/_ws", {
        headers: { host: "localhost.evil.com" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });
  });

  describe("handle - non-websocket request", () => {
    it("returns JSON status when not a websocket upgrade", async () => {
      const handler = new HMRHandler();
      const req = createLocalRequest("http://localhost/_ws");
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
    it("returns an explicit WebSocket upgrade signal from adapter upgrades", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      const req = createLocalRequest("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const upgradeResponse = createWebSocketUpgradeResponse();
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({
          upgradeWebSocket: () => ({
            socket: mock.socket,
            response: upgradeResponse,
          }),
        }),
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(Object.is(result.response, upgradeResponse), true);
      assertEquals(result.response instanceof Response, false);
      assertEquals(result.response!.status, 101);
    });

    it("disables runtime idle timeout for upstream HMR WebSocket upgrades", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      let upgradeOptions: unknown;
      const req = createLocalRequest("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({
          upgradeWebSocket: (_request: Request, options?: unknown) => {
            upgradeOptions = options;
            return {
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            };
          },
        }),
      });

      await handler.handle(req, ctx);

      assertEquals(upgradeOptions, { idleTimeout: 0 });
    });

    it("preserves data from structurally compatible message events", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      const req = createLocalRequest("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({
          upgradeWebSocket: () => ({
            socket: mock.socket,
            response: createWebSocketUpgradeResponse(),
          }),
        }),
      });

      await handler.handle(req, ctx);
      mock.emit("message", { data: JSON.stringify({ type: "ping" }) });

      assertEquals(mock.sentMessages, [
        JSON.stringify({ type: "connected" }),
        JSON.stringify({ type: "pong" }),
      ]);
    });

    it("returns 501 when adapter.server is missing", async () => {
      const handler = new HMRHandler();
      const req = createLocalRequest("http://localhost/_ws", {
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
      const req = createLocalRequest("http://localhost/_ws", {
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

    it("returns 501 when upgradeWebSocket is unsupported by the runtime", async () => {
      const handler = new HMRHandler();
      const req = createLocalRequest("http://localhost/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter({
          upgradeWebSocket: () => {
            throw NOT_SUPPORTED.create({
              detail: "Deno.upgradeWebSocket() is not available in this runtime.",
            });
          },
        }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response!.status, 501);
    });
  });
});
