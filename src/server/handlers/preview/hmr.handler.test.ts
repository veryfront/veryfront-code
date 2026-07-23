import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../types.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeAdapter,
  type WebSocketConnection,
} from "#veryfront/platform/adapters/base.ts";
import { cacheRegistry } from "#veryfront/cache";
import type { RedisCacheProjectIdentity } from "#veryfront/cache/backends/redis-keyspace.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { addClient } from "./hmr-client-manager.ts";
import { HMRHandler } from "./hmr.handler.ts";

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

let signingKeyPair: CryptoKeyPair | undefined;
let trustedPublicKeyPem: string | undefined;

async function ensureKeyMaterial(): Promise<void> {
  if (signingKeyPair && trustedPublicKeyPem) return;
  signingKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("spki", signingKeyPair.publicKey);
  trustedPublicKeyPem = encodePem("PUBLIC KEY", der);
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
      get: (key: string) =>
        key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? trustedPublicKeyPem : undefined,
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
  afterEach(async () => {
    await HMRHandler.shutdown();
    ReloadNotifier.reset();
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

    it("registerExternalBroadcastSource returns unsubscribe", async () => {
      const unsub = HMRHandler.registerExternalBroadcastSource();
      assertEquals(typeof unsub, "function");
      await unsub();
    });

    it("external registrations eagerly install exactly one reload listener", async () => {
      const initialListeners = ReloadNotifier.getListenerCount();
      const releaseFirst = HMRHandler.registerExternalBroadcastSource();
      const releaseSecond = HMRHandler.registerExternalBroadcastSource();

      assertEquals(ReloadNotifier.getListenerCount(), initialListeners + 1);
      await releaseFirst();
      assertEquals(ReloadNotifier.getListenerCount(), initialListeners + 1);
      await releaseSecond();
      assertEquals(ReloadNotifier.getListenerCount(), initialListeners);
    });

    it("retains initialized globals until the last server lifecycle owner exits", async () => {
      const initialListeners = ReloadNotifier.getListenerCount();
      const releaseFirst = HMRHandler.registerLifecycleOwner();
      const releaseSecond = HMRHandler.registerLifecycleOwner();
      const handler = new HMRHandler();
      await handler.handle(
        new Request("http://localhost/_ws"),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(ReloadNotifier.getListenerCount(), initialListeners + 1);
      await releaseFirst();
      assertEquals(ReloadNotifier.getListenerCount(), initialListeners + 1);
      await releaseSecond();
      assertEquals(ReloadNotifier.getListenerCount(), initialListeners);
    });

    it("releases subscription, timer state, and clients when the last owner exits", async () => {
      const initialListeners = ReloadNotifier.getListenerCount();
      const release = HMRHandler.registerExternalBroadcastSource();
      const handler = new HMRHandler();
      await handler.handle(
        new Request("http://localhost/_ws"),
        makeCtx({ isLocalProject: true }),
      );

      let closeCalls = 0;
      const { socket } = createMockSocket();
      socket.close = () => {
        closeCalls++;
      };
      addClient({
        id: "owned-client",
        socket,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
      });

      assertEquals(ReloadNotifier.getListenerCount(), initialListeners + 1);
      assertEquals(HMRHandler.getClientCount(), 1);
      await release();

      assertEquals(ReloadNotifier.getListenerCount(), initialListeners);
      assertEquals(HMRHandler.getClientCount(), 0);
      assertEquals(closeCalls, 1);
    });

    it("shutdown does not throw", async () => {
      await HMRHandler.shutdown();
    });

    it("multiple shutdowns are safe", async () => {
      await Promise.all([HMRHandler.shutdown(), HMRHandler.shutdown()]);
    });
  });

  describe("reload invalidation ordering", () => {
    it("waits for Redis invalidation before an external unfiltered broadcast", async () => {
      const originalDeleteRedisKeysForProject = cacheRegistry.deleteRedisKeysForProject;
      let capturedIdentity: RedisCacheProjectIdentity | undefined;
      let deleteCalls = 0;
      let markDeleteStarted!: () => void;
      const deleteStarted = new Promise<void>((resolve) => {
        markDeleteStarted = resolve;
      });
      let releaseDelete!: () => void;
      const deleteReleased = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });

      cacheRegistry.deleteRedisKeysForProject = async (identity) => {
        deleteCalls++;
        capturedIdentity = typeof identity === "string" ? { projectId: identity } : identity;
        markDeleteStarted();
        await deleteReleased;
        return 1;
      };

      const { socket, sentMessages } = createMockSocket();
      let markBroadcast!: () => void;
      const broadcast = new Promise<void>((resolve) => {
        markBroadcast = resolve;
      });
      const originalSend = socket.send.bind(socket);
      socket.send = (message) => {
        originalSend(message);
        markBroadcast();
      };
      const now = Date.now();
      addClient({
        id: "unscoped-external-client",
        socket,
        connectedAt: now,
        lastActivity: now,
      });
      const releaseExternalSource = HMRHandler.registerExternalBroadcastSource();

      try {
        ReloadNotifier.triggerReload(["src/page.tsx"], {
          projectId: "target-id",
          projectSlug: "target-slug",
        });

        await deleteStarted;
        await Promise.resolve();
        assertEquals(sentMessages, []);
        assertEquals(deleteCalls, 1);
        assertEquals(capturedIdentity, {
          projectId: "target-id",
          projectSlug: "target-slug",
        });

        releaseDelete();
        await broadcast;
        assertEquals(sentMessages.length, 1);
        assertEquals(JSON.parse(sentMessages[0]!), {
          type: "update",
          path: "src/page.tsx",
          timestamp: JSON.parse(sentMessages[0]!).timestamp,
        });
      } finally {
        releaseDelete();
        await releaseExternalSource();
        cacheRegistry.deleteRedisKeysForProject = originalDeleteRedisKeysForProject;
      }
    });

    it("suppresses a failed invalidation and broadcasts only a later successful reload", async () => {
      const originalDeleteRedisKeysForProject = cacheRegistry.deleteRedisKeysForProject;
      let deleteCalls = 0;
      let markFirstDeleteStarted!: () => void;
      const firstDeleteStarted = new Promise<void>((resolve) => {
        markFirstDeleteStarted = resolve;
      });

      cacheRegistry.deleteRedisKeysForProject = () => {
        deleteCalls++;
        if (deleteCalls === 1) {
          markFirstDeleteStarted();
          return Promise.reject(new Error("Redis unavailable"));
        }
        return Promise.resolve(1);
      };

      const { socket, sentMessages } = createMockSocket();
      let markBroadcast!: () => void;
      const broadcast = new Promise<void>((resolve) => {
        markBroadcast = resolve;
      });
      const originalSend = socket.send.bind(socket);
      socket.send = (message) => {
        originalSend(message);
        markBroadcast();
      };
      const now = Date.now();
      addClient({
        id: "failed-invalidation-client",
        socket,
        connectedAt: now,
        lastActivity: now,
      });
      const releaseExternalSource = HMRHandler.registerExternalBroadcastSource();

      try {
        ReloadNotifier.triggerReload(["src/failed.tsx"], {
          projectId: "target-id",
          projectSlug: "target-slug",
        });
        await firstDeleteStarted;

        ReloadNotifier.triggerReload(["src/recovered.tsx"], {
          projectId: "target-id",
          projectSlug: "target-slug",
        });
        await broadcast;

        assertEquals(deleteCalls, 2);
        assertEquals(sentMessages.length, 1);
        assertEquals(JSON.parse(sentMessages[0]!), {
          type: "update",
          path: "src/recovered.tsx",
          timestamp: JSON.parse(sentMessages[0]!).timestamp,
        });
      } finally {
        await releaseExternalSource();
        cacheRegistry.deleteRedisKeysForProject = originalDeleteRedisKeysForProject;
      }
    });

    it("drains in-flight invalidation and suppresses its broadcast during shutdown", async () => {
      const originalDeleteRedisKeysForProject = cacheRegistry.deleteRedisKeysForProject;
      let markDeleteStarted!: () => void;
      const deleteStarted = new Promise<void>((resolve) => {
        markDeleteStarted = resolve;
      });
      let releaseDelete!: () => void;
      const deleteReleased = new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      cacheRegistry.deleteRedisKeysForProject = async () => {
        markDeleteStarted();
        await deleteReleased;
        return 1;
      };

      const { socket, sentMessages } = createMockSocket();
      const now = Date.now();
      addClient({
        id: "shutdown-tail-client",
        socket,
        projectSlug: "target-slug",
        connectedAt: now,
        lastActivity: now,
      });
      HMRHandler.registerExternalBroadcastSource();

      try {
        ReloadNotifier.triggerReload(["src/in-flight.tsx"], {
          projectId: "target-id",
          projectSlug: "target-slug",
        });
        await deleteStarted;

        let shutdownSettled = false;
        const shutdown = HMRHandler.shutdown().then(() => {
          shutdownSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        assertEquals(shutdownSettled, false);

        releaseDelete();
        await shutdown;
        assertEquals(sentMessages, []);
        assertEquals(HMRHandler.getClientCount(), 0);
      } finally {
        releaseDelete();
        await HMRHandler.shutdown();
        cacheRegistry.deleteRedisKeysForProject = originalDeleteRedisKeysForProject;
      }
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

    it("proceeds only from a server-resolved preview context", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        projectSlug: "demo-project",
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("does not let x-environment=preview promote a production request", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws?x-environment=preview");
      const ctx = makeCtx({
        isLocalProject: false,
        projectSlug: "demo-project",
        requestContext: { mode: "production" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("does not let a caller-supplied Host header authorize preview HMR", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        projectSlug: "demo-project",
        requestContext: { mode: "production" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("accepts a cryptographically trusted proxy request in resolved preview scope", async () => {
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
        projectSlug: "demo-project",
        resolvedEnvironment: "preview",
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
          "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
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

    it("accepts trusted forwarded scope only when the server context is preview", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "localhost",
          "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        projectSlug: "demo-project",
        resolvedEnvironment: "preview",
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      // Handler path entered — not short-circuited.
      assertEquals(result.continue, false);
    });

    it(
      "IGNORES x-forwarded-host: localhost when dispatch-JWS is present but unverifiable (Codex P1 regression)",
      async () => {
        // A direct-access attacker can attach any value to x-veryfront-dispatch-jws
        // because the proxy does not strip that header on ingress. Prior to the
        // fix, mere presence unlocked forwarded-header trust and re-opened the
        // localhost short-circuit. The handler must now cryptographically verify
        // the JWS before promoting the request to proxy-trusted.
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
        // The bogus JWS must NOT unlock the localhost short-circuit.
        assertEquals(result.continue, true);
      },
    );

    it("does not infer local-project authority from a raw localhost Host header", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        projectSlug: "demo-project",
        requestContext: { mode: "production" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("rejects an untrusted query-string project selector in preview mode", async () => {
      const handler = new HMRHandler();
      const req = new Request(
        "http://preview.example.com/_ws?x-project-slug=attacker-selected",
      );
      const result = await handler.handle(
        req,
        makeCtx({
          isLocalProject: false,
          projectSlug: "attacker-selected",
          resolvedEnvironment: "preview",
        }),
      );
      assertEquals(result.continue, true);
    });

    it("never spends a host-level API token while accepting an unauthenticated preview socket", async () => {
      let fsCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.exists = () => {
        fsCalls++;
        return Promise.resolve(false);
      };

      const result = await new HMRHandler().handle(
        new Request("http://demo.preview.example.com/_ws"),
        makeCtx({
          isLocalProject: false,
          projectSlug: "demo-project",
          proxyToken: "broad-host-token",
          resolvedEnvironment: "preview",
          adapter,
        }),
      );

      assertEquals(result.response?.status, 426);
      assertEquals(fsCalls, 0);
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
    it("returns an explicit WebSocket upgrade signal from adapter upgrades", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      const req = new Request("http://localhost/_ws", {
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
      const req = new Request("http://localhost/_ws", {
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
      const req = new Request("http://localhost/_ws", {
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

    it("returns 501 when upgradeWebSocket is unsupported by the runtime", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws", {
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
