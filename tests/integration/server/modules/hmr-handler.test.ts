import "../../../_helpers/contract-init.ts";
// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd";
import { HMRHandler } from "../../../../src/server/handlers/preview/hmr.handler.ts";
import { ReloadNotifier } from "../../../../src/server/reload-notifier.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { createWebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
} from "#veryfront/utils";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";

const encoder = new TextEncoder();

let trustedSigningKeyPair: CryptoKeyPair;
let trustedPublicKeyPem: string;

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function ensureKeyMaterial(): Promise<void> {
  if (trustedPublicKeyPem) return;
  trustedSigningKeyPair = (await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey("spki", trustedSigningKeyPair.publicKey);
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
    project_id: "proj-1",
    platform: "slack",
    body_sha256: "a".repeat(43),
    iat: now,
    exp: now + 60,
  };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    trustedSigningKeyPair.privateKey,
    signingInput,
  );
  return `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

function adapterEnv() {
  return {
    fs: {},
    server: null,
    env: {
      get(key: string) {
        if (key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") return trustedPublicKeyPem;
        return undefined;
      },
    },
  };
}

function createMockSocket() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const sentMessages: string[] = [];
  const closeCalls: Array<{ code?: number; reason?: string }> = [];

  const emit = (type: string, event?: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };

  const socket = {
    readyState: WebSocket.OPEN,
    send(data: string) {
      sentMessages.push(data);
    },
    close(code?: number, reason?: string) {
      closeCalls.push({ code, reason });
      emit("close");
    },
    addEventListener(type: string, listener: (event?: unknown) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: (event?: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as WebSocket;

  return { socket, sentMessages, closeCalls, emit };
}

describe("HMR Handler Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  afterEach(() => {
    HMRHandler.shutdown();
  });

  describe("HMR Handler - Metadata", () => {
    it("has correct metadata", () => {
      const handler = new HMRHandler();

      assertEquals(handler.metadata.name, "HMRHandler");
      assertEquals(handler.metadata.priority, 25);
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns.length, 1);

      const firstPattern = handler.metadata.patterns[0];
      assertExists(firstPattern);
      assertEquals(firstPattern.pattern, "/_ws");
      assertEquals(firstPattern.exact, true);
    });

    it("is enabled in preview mode (regardless of isLocalProject)", () => {
      const handler = new HMRHandler();

      const previewCtx = {
        requestContext: { mode: "preview" },
      } as Parameters<NonNullable<typeof handler.metadata.enabled>>[0];

      assertEquals(handler.metadata.enabled?.(previewCtx), true);
    });

    it("is enabled in local dev (regardless of mode)", () => {
      const handler = new HMRHandler();

      const productionModeCtx = {
        isLocalProject: true,
        requestContext: { mode: "production" },
      } as Parameters<NonNullable<typeof handler.metadata.enabled>>[0];

      assertEquals(handler.metadata.enabled?.(productionModeCtx), true);
    });

    it("enabled function always returns true (check happens in handle)", () => {
      const handler = new HMRHandler();

      const productionCtx = {
        requestContext: { mode: "production" },
      } as Parameters<NonNullable<typeof handler.metadata.enabled>>[0];
      assertEquals(handler.metadata.enabled?.(productionCtx), true);

      const noCtx = {} as Parameters<NonNullable<typeof handler.metadata.enabled>>[0];
      assertEquals(handler.metadata.enabled?.(noCtx), true);
    });

    it("handle returns continue for non-preview/non-localdev requests", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://production.example.com/_ws");
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not treat *.production.veryfront.me as localhost", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "myproject.production.veryfront.me:3000" },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not treat *.staging.veryfront.me as localhost", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "myproject.staging.veryfront.me:3000" },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not treat unknown *.veryfront.me namespace as localhost", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "myproject.foobar.veryfront.me:3000" },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not treat a local-looking Host as explicit local-project context", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { host: "preview.veryfront.me:3000" },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("IGNORES x-forwarded-host when the request is NOT proxy-trusted (VULN-SRV-4)", async () => {
      // Without a trusted-proxy signal the handler MUST NOT honour x-forwarded-host
      // — otherwise any remote client could claim `x-forwarded-host: preview.veryfront.me`
      // and unlock HMR on a production deployment. The raw Host header ("internal.proxy")
      // is non-local, so the handler should decline.
      const handler = new HMRHandler();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
        },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("accepts a proxy-trusted preview with a matching Origin", async () => {
      const handler = new HMRHandler();
      const jws = await mintTrustedDispatchJws();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          origin: "https://demo.preview.veryfront.com",
          "x-forwarded-host": "demo.preview.veryfront.com",
          "x-forwarded-proto": "https",
          "x-veryfront-dispatch-jws": jws,
        },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        projectId: "proj-1",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: adapterEnv(),
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assert(result.response instanceof Response);
      assertEquals(result.response.status, 200);
    });

    it("IGNORES x-forwarded-host when dispatch JWS is present but unverifiable (Codex P1 regression)", async () => {
      // Regression for Codex P1 on PR #1116: mere presence of `x-veryfront-dispatch-jws`
      // must NOT be treated as proof of proxy trust. Since the proxy does not strip
      // this header on ingress, an attacker reaching the runtime directly could
      // attach any value and unlock x-forwarded-host handling. Only a crypto-verified
      // JWS counts as a trust signal.
      await ensureKeyMaterial();
      const handler = new HMRHandler();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-veryfront-dispatch-jws": "attacker-supplied.bogus.value",
        },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: adapterEnv(),
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("rejects x-forwarded-host spoof that tries to unlock localhost without proxy trust", async () => {
      // Regression for VULN-SRV-4: a remote client setting x-forwarded-host: localhost
      // against a public runtime must NOT enable HMR. The handler falls back to the raw
      // Host ("evil.example.com"), which is non-local, so the request is declined.
      const handler = new HMRHandler();

      const req = new Request("http://evil.example.com/_ws", {
        headers: {
          host: "evil.example.com",
          "x-forwarded-host": "localhost",
        },
      });
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not let a preview query parameter authorize proxy HMR", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws?x-environment=preview");
      const ctx = {
        requestContext: { mode: "production" },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });
  });

  describe("HMR Handler - Client Management", () => {
    it("starts with zero clients", () => {
      assertEquals(HMRHandler.getClientCount(), 0);
    });

    it("shutdown clears all state", () => {
      HMRHandler.shutdown();
      assertEquals(HMRHandler.getClientCount(), 0);
    });
  });

  describe("HMR Handler - Non-WebSocket Requests", () => {
    it("returns info response for non-WebSocket requests", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws");
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);

      assert(result.response instanceof Response);
      const body = await result.response.json();
      assertEquals(body, { status: "ok", clients: 0 });
    });

    it("returns 501 for WebSocket upgrade without adapter server", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 501);
    });
  });

  describe("HMR Handler - WebSocket Guardrails", () => {
    it("responds to ping messages with pong", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);
      assertExists(result.response);
      assertEquals(result.response.status, 101);

      mock.emit("message", { data: JSON.stringify({ type: "ping" }) });

      assertEquals(mock.sentMessages.includes(JSON.stringify({ type: "pong" })), true);
    });

    it("closes connection when message exceeds max size", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);
      mock.emit("message", {
        data: "x".repeat(HMR_MAX_MESSAGE_SIZE_BYTES + 1),
      });

      assertExists(mock.closeCalls[0]);
      assertEquals(mock.closeCalls[0].code, HMR_CLOSE_MESSAGE_TOO_LARGE);
      assertEquals(HMRHandler.getClientCount(), 0);
    });

    it("closes connection when message rate limit is exceeded", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      for (let i = 0; i <= HMR_MAX_MESSAGES_PER_MINUTE; i++) {
        mock.emit("message", { data: JSON.stringify({ type: "ping" }) });
      }

      const rateLimitClose = mock.closeCalls.find((call) => call.code === HMR_CLOSE_RATE_LIMIT);
      assertExists(rateLimitClose);
      assertEquals(HMRHandler.getClientCount(), 0);
    });

    it("broadcasts each reload exactly once through the shared HMR runtime", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        mode: "development",
        isLocalProject: true,
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      // Ignore initial "connected" message; only validate reload/update emission.
      mock.sentMessages.length = 0;

      await ReloadNotifier.triggerReload(["app.tsx"], { projectDir: "/tmp/test" });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const hmrMessages = mock.sentMessages
        .map((message) => {
          try {
            return JSON.parse(message) as { type?: string; path?: string };
          } catch {
            return null;
          }
        })
        .filter((msg): msg is { type?: string; path?: string } =>
          !!msg && (msg.type === "update" || msg.type === "reload")
        );

      assertEquals(hmrMessages.length, 1);
      assertEquals(hmrMessages[0]?.type, "update");
      assertEquals(hmrMessages[0]?.path, "app.tsx");
    });
  });

  describe("HMR Handler - Adapter Initialization for Poke Reception", () => {
    it("triggers adapter initialization in proxy mode for preview requests", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      const jws = await mintTrustedDispatchJws();

      let runWithContextCalled = false;
      let runWithContextArgs: unknown[] = [];

      const mockFs = {
        exists: async () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async (
          projectSlug: string,
          token: string,
          fn: () => Promise<void>,
          projectId?: string,
          options?: Record<string, unknown>,
        ) => {
          runWithContextCalled = true;
          runWithContextArgs = [projectSlug, token, projectId, options];
          await fn();
        },
      };

      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          upgrade: "websocket",
          origin: "https://demo.preview.veryfront.com",
          "x-forwarded-host": "demo.preview.veryfront.com",
          "x-forwarded-proto": "https",
          "x-veryfront-dispatch-jws": jws,
        },
      });
      const ctx = {
        requestContext: { mode: "preview", branch: "main" },
        resolvedEnvironment: "preview",
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          ...adapterEnv(),
          fs: mockFs,
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 101);

      // Wait for the async adapter initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify runWithContext was called with correct arguments
      assertEquals(runWithContextCalled, true);
      assertEquals(runWithContextArgs[0], "test-project");
      assertEquals(runWithContextArgs[1], "test-token");
      assertEquals(runWithContextArgs[2], "proj-123");
      assertEquals((runWithContextArgs[3] as Record<string, unknown>).productionMode, false);
      assertEquals((runWithContextArgs[3] as Record<string, unknown>).branch, "main");
    });

    it("does not trigger adapter initialization for production requests", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      let runWithContextCalled = false;

      const mockFs = {
        exists: async () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async () => {
          runWithContextCalled = true;
        },
      };

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "production" },
        resolvedEnvironment: "production",
        isLocalProject: true,
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: mockFs,
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      // Wait for any async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // runWithContext should NOT be called for production mode
      assertEquals(runWithContextCalled, false);
    });

    it("does not trigger adapter initialization without proxyToken", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      let runWithContextCalled = false;

      const mockFs = {
        exists: async () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async () => {
          runWithContextCalled = true;
        },
      };

      const req = new Request("http://localhost:3000/_ws", {
        headers: { upgrade: "websocket" },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        isLocalProject: true,
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: undefined,
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: mockFs,
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      // Wait for any async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // runWithContext should NOT be called without proxyToken
      assertEquals(runWithContextCalled, false);
    });

    it("handles adapter initialization errors gracefully", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();
      const jws = await mintTrustedDispatchJws();

      const mockFs = {
        exists: async () => {
          throw new Error("Adapter initialization failed");
        },
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async (
          _projectSlug: string,
          _token: string,
          fn: () => Promise<void>,
        ) => {
          await fn(); // This will throw
        },
      };

      const req = new Request("http://internal.proxy/_ws", {
        headers: {
          upgrade: "websocket",
          origin: "https://demo.preview.veryfront.com",
          "x-forwarded-host": "demo.preview.veryfront.com",
          "x-forwarded-proto": "https",
          "x-veryfront-dispatch-jws": jws,
        },
      });
      const ctx = {
        requestContext: { mode: "preview", branch: "main" },
        resolvedEnvironment: "preview",
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          ...adapterEnv(),
          fs: mockFs,
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: createWebSocketUpgradeResponse(),
            }),
          },
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      // Should not throw - error is caught and logged
      const result = await handler.handle(req, ctx);

      // Wait for the async adapter initialization to complete/fail
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Handler should still return a valid response
      assertExists(result.response);
      assertEquals(result.response.status, 101);
    });
  });
});
