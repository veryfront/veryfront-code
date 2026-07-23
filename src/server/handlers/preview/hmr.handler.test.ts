import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../types.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeAdapter,
  type WebSocketConnection,
} from "#veryfront/platform/adapters/base.ts";
import { HMRHandler } from "./hmr.handler.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { addClient, HMR_MAX_CLIENTS_PER_SCOPE } from "./hmr-client-manager.ts";

const encoder = new TextEncoder();
const DISPATCH_PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const originalDispatchPublicKey = Deno.env.get(DISPATCH_PUBLIC_KEY_ENV);

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

async function mintTrustedDispatchJws(options: { installHostKey?: boolean } = {}): Promise<string> {
  await ensureKeyMaterial();
  if (options.installHostKey !== false) {
    Deno.env.set(DISPATCH_PUBLIC_KEY_ENV, trustedPublicKeyPem!);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: "veryfront-api",
    aud: "demo-project",
    sub: "dispatch-hmr-test",
    project_id: "proj_123",
    platform: "slack",
    body_sha256: "a".repeat(43),
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
  closed: Array<{ code?: number; reason?: string }>;
  emit(type: string, event: unknown): void;
  listenerCount(type: string): number;
} {
  const listeners = new Map<string, Set<EventListener>>();
  const sentMessages: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];

  const socket: WebSocketConnection = {
    readyState: WebSocket.OPEN,
    send: (message) => {
      sentMessages.push(String(message));
    },
    close: (code, reason) => {
      closed.push({ code, reason });
    },
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
    closed,
    emit: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event);
      }
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}

describe("server/handlers/preview/hmr.handler", () => {
  afterEach(() => {
    HMRHandler.shutdown();
    if (originalDispatchPublicKey === undefined) Deno.env.delete(DISPATCH_PUBLIC_KEY_ENV);
    else Deno.env.set(DISPATCH_PUBLIC_KEY_ENV, originalDispatchPublicKey);
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

    it("keeps shared HMR infrastructure alive until every server releases it", () => {
      const listenerCountBefore = ReloadNotifier.getListenerCount();
      const releaseFirst = HMRHandler.acquireRuntime();
      const releaseSecond = HMRHandler.acquireRuntime();
      assertEquals(ReloadNotifier.getListenerCount(), listenerCountBefore + 1);

      releaseFirst();
      releaseFirst();
      assertEquals(ReloadNotifier.getListenerCount(), listenerCountBefore + 1);

      releaseSecond();
      assertEquals(ReloadNotifier.getListenerCount(), listenerCountBefore);
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

    it("does not let an untrusted preview-mode context enable remote HMR", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws");
      const ctx = makeCtx({
        isLocalProject: false,
        projectId: "proj_123",
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("does not let an unsigned environment query enable remote HMR", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws?x-environment=preview");
      const ctx = makeCtx({
        isLocalProject: false,
        requestContext: { mode: "production" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("does not let a forged raw localhost Host header enable remote HMR", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://example.com/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        projectId: "proj_123",
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("proceeds for a proxy-trusted remote preview with a matching Origin", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "demo.preview.veryfront.com",
          "x-forwarded-proto": "https",
          "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          origin: "https://demo.preview.veryfront.com",
        },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        projectId: "proj_123",
        requestContext: { mode: "preview" } as any,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
    });

    it("does not trust a dispatch key supplied by the project adapter", async () => {
      const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
      const originalHostKey = Deno.env.get(envKey);
      Deno.env.delete(envKey);

      try {
        const result = await new HMRHandler().handle(
          new Request("http://internal.proxy/_ws", {
            headers: {
              origin: "https://demo.preview.veryfront.com",
              "x-forwarded-host": "demo.preview.veryfront.com",
              "x-forwarded-proto": "https",
              "x-veryfront-dispatch-jws": await mintTrustedDispatchJws({
                installHostKey: false,
              }),
            },
          }),
          makeCtx({
            isLocalProject: false,
            projectId: "proj_123",
            requestContext: { mode: "preview" } as any,
            resolvedEnvironment: "preview",
            adapter: createMockAdapter({ upgradeWebSocket: undefined }),
          }),
        );

        assertEquals(result.continue, true);
      } finally {
        if (originalHostKey === undefined) Deno.env.delete(envKey);
        else Deno.env.set(envKey, originalHostKey);
      }
    });

    it("requires a tenant project identity for a trusted remote preview", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://internal.proxy/_ws", {
          headers: {
            origin: "https://demo.preview.veryfront.com",
            "x-forwarded-host": "demo.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          },
        }),
        makeCtx({
          isLocalProject: false,
          projectId: undefined,
          projectSlug: undefined,
          requestContext: { mode: "preview" } as any,
        }),
      );

      assertEquals(result.continue, true);
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

    it("does not let a trusted forwarded localhost Host replace preview authorization", async () => {
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
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
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

    it("requires explicit local-project context even for a raw localhost Host", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "localhost:3000" },
      });
      const ctx = makeCtx({
        isLocalProject: false,
        adapter: createMockAdapter({ upgradeWebSocket: undefined }),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
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
    it("returns a private, non-cacheable status without identifiers or metrics", async () => {
      const handler = new HMRHandler();
      const req = new Request("http://localhost/_ws");
      const ctx = makeCtx({
        isLocalProject: true,
        adapter: createMockAdapter(),
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assert(result.response instanceof Response);
      assertEquals(result.response!.status, 200);
      const body = await result.response!.json();
      assertEquals(body, { status: "ok", clients: 0 });
      assertEquals(result.response!.headers.get("cache-control"), "no-store");
      assertEquals(result.response!.headers.get("x-content-type-options"), "nosniff");
      assertEquals(
        result.response!.headers.get("cross-origin-resource-policy"),
        "same-origin",
      );
    });

    it("allows an origin-less local CLI status request", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws"),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(result.response?.status, 200);
    });

    it("rejects unsupported methods with an explicit Allow header", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", { method: "POST" }),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(result.response?.status, 405);
      assertEquals(result.response?.headers.get("allow"), "GET");
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
    });

    it("does not treat a malformed Upgrade request as a status request", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", { headers: { upgrade: "h2c" } }),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(result.response?.status, 400);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
    });
  });

  describe("handle - websocket upgrade", () => {
    it("preserves a trusted same-origin remote preview upgrade", async () => {
      const mock = createMockSocket();
      const upgradeResponse = createWebSocketUpgradeResponse();
      const result = await new HMRHandler().handle(
        new Request("http://internal.proxy/_ws", {
          headers: {
            upgrade: "websocket",
            origin: "https://demo.preview.veryfront.com",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "demo.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          },
        }),
        makeCtx({
          isLocalProject: false,
          projectId: "proj_123",
          requestContext: { mode: "preview" } as any,
          resolvedEnvironment: "preview",
          adapter: createMockAdapter({
            upgradeWebSocket: () => ({ socket: mock.socket, response: upgradeResponse }),
          }),
        }),
      );

      assertEquals(Object.is(result.response, upgradeResponse), true);
      assertEquals(mock.sentMessages, [JSON.stringify({ type: "connected" })]);
    });

    it("initializes remote preview HMR with the exact source selector", async () => {
      const mock = createMockSocket();
      let sourceOptions: unknown;
      const adapter = createMockAdapter({
        upgradeWebSocket: () => ({
          socket: mock.socket,
          response: createWebSocketUpgradeResponse(),
        }),
      });
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => ({}),
        isVeryfrontAdapter: () => true,
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async (
          _projectSlug: string,
          _token: string,
          fn: () => Promise<unknown>,
          _projectId?: string,
          options?: unknown,
        ) => {
          sourceOptions = options;
          return await fn();
        },
      });

      await new HMRHandler().handle(
        new Request("http://internal.proxy/_ws", {
          headers: {
            upgrade: "websocket",
            origin: "https://demo.preview.veryfront.com",
            "x-forwarded-host": "demo.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          },
        }),
        makeCtx({
          isLocalProject: false,
          projectSlug: "demo-project",
          projectId: "proj_123",
          proxyToken: "proxy-token",
          requestContext: { mode: "preview", branch: null } as any,
          resolvedEnvironment: "preview",
          environmentName: "Preview",
          adapter,
        }),
      );
      await Promise.resolve();

      assertEquals(sourceOptions, {
        productionMode: false,
        branch: null,
        environmentName: "Preview",
      });
    });

    it("rejects cross-origin browser upgrades", async () => {
      let upgradeCalled = false;
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", {
          headers: {
            upgrade: "websocket",
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site",
          },
        }),
        makeCtx({
          isLocalProject: true,
          adapter: createMockAdapter({
            upgradeWebSocket: () => {
              upgradeCalled = true;
              throw new Error("must not upgrade");
            },
          }),
        }),
      );

      assertEquals(result.response?.status, 403);
      assertEquals(upgradeCalled, false);
    });

    it("requires an Origin for a proxy-trusted remote preview upgrade", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://internal.proxy/_ws", {
          headers: {
            upgrade: "websocket",
            "x-forwarded-host": "demo.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          },
        }),
        makeCtx({
          isLocalProject: false,
          projectId: "proj_123",
          requestContext: { mode: "preview" } as any,
        }),
      );

      assertEquals(result.response?.status, 403);
    });

    it("rejects a cross-origin proxy-trusted remote preview upgrade", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://internal.proxy/_ws", {
          headers: {
            upgrade: "websocket",
            origin: "https://attacker.example",
            "sec-fetch-site": "same-site",
            "x-forwarded-host": "demo.preview.veryfront.com",
            "x-forwarded-proto": "https",
            "x-veryfront-dispatch-jws": await mintTrustedDispatchJws(),
          },
        }),
        makeCtx({
          isLocalProject: false,
          projectId: "proj_123",
          requestContext: { mode: "preview" } as any,
        }),
      );

      assertEquals(result.response?.status, 403);
    });

    it("rejects non-GET WebSocket upgrade attempts", async () => {
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", {
          method: "POST",
          headers: { upgrade: "websocket" },
        }),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(result.response?.status, 405);
      assertEquals(result.response?.headers.get("allow"), "GET");
    });

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

    it("removes all socket listeners during idempotent cleanup", async () => {
      const mock = createMockSocket();
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", { headers: { upgrade: "websocket" } }),
        makeCtx({
          isLocalProject: true,
          adapter: createMockAdapter({
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          }),
        }),
      );

      assertEquals(result.response?.status, 101);
      mock.emit("error", new Event("error"));
      mock.emit("close", new Event("close"));

      assertEquals(HMRHandler.getClientCount(), 0);
      assertEquals(mock.listenerCount("message"), 0);
      assertEquals(mock.listenerCount("close"), 0);
      assertEquals(mock.listenerCount("error"), 0);
      assertEquals(mock.listenerCount("open"), 0);
    });

    it("tears down shared lifecycle state when the initial socket send fails", async () => {
      const listenerCountBefore = ReloadNotifier.getListenerCount();
      const mock = createMockSocket();
      mock.socket.send = () => {
        throw new Error("private transport detail");
      };

      await new HMRHandler().handle(
        new Request("http://localhost/_ws", { headers: { upgrade: "websocket" } }),
        makeCtx({
          isLocalProject: true,
          adapter: createMockAdapter({
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          }),
        }),
      );

      assertEquals(HMRHandler.getClientCount(), 0);
      assertEquals(ReloadNotifier.getListenerCount(), listenerCountBefore);
      assertEquals(mock.closed, [{ code: 1011, reason: "Connection failed" }]);
      assertEquals(mock.listenerCount("message"), 0);
    });

    it("rejects a saturated project scope before upgrading", async () => {
      for (let index = 0; index < HMR_MAX_CLIENTS_PER_SCOPE; index++) {
        addClient({
          id: `existing-${index}`,
          socket: createMockSocket().socket,
          connectedAt: Date.now(),
          lastActivity: Date.now(),
          projectDir: "/tmp/test-project",
        });
      }

      let upgradeCalled = false;
      const result = await new HMRHandler().handle(
        new Request("http://localhost/_ws", { headers: { upgrade: "websocket" } }),
        makeCtx({
          isLocalProject: true,
          adapter: createMockAdapter({
            upgradeWebSocket: () => {
              upgradeCalled = true;
              throw new Error("must not upgrade");
            },
          }),
        }),
      );

      assertEquals(result.response?.status, 503);
      assertEquals(result.response?.headers.get("retry-after"), "5");
      assertEquals(upgradeCalled, false);
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
