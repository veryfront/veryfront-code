import "../../../_helpers/contract-init.ts";
// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd";
import { HMRHandler } from "../../../../src/server/handlers/preview/hmr.handler.ts";
import { ReloadNotifier } from "../../../../src/server/reload-notifier.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
} from "#veryfront/utils";

const PROXY_TOPOLOGY_ENV = "VERYFRONT_TRUST_FORWARDED_HEADERS";

async function withProxyTopologySetting<T>(
  value: string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const previousValue = Deno.env.get(PROXY_TOPOLOGY_ENV);

  try {
    if (value === undefined) {
      Deno.env.delete(PROXY_TOPOLOGY_ENV);
    } else {
      Deno.env.set(PROXY_TOPOLOGY_ENV, value);
    }
    return await action();
  } finally {
    if (previousValue === undefined) {
      Deno.env.delete(PROXY_TOPOLOGY_ENV);
    } else {
      Deno.env.set(PROXY_TOPOLOGY_ENV, previousValue);
    }
  }
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
  } as unknown as WebSocket;

  return { socket, sentMessages, closeCalls, emit };
}

describe("HMR Handler Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  afterEach(async () => {
    await HMRHandler.shutdown();
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

    it("does not infer preview authority from a raw preview Host header", async () => {
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

    it("rejects proxy-supplied project scope when topology is not explicitly trusted", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-project-slug": "edge-selected",
        },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        isLocalProject: false,
        projectSlug: "edge-selected",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await withProxyTopologySetting(
        undefined,
        () => handler.handle(req, ctx),
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("accepts proxy-supplied project scope only when topology is explicitly trusted", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-project-slug": "edge-selected",
        },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        isLocalProject: false,
        projectSlug: "edge-selected",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await withProxyTopologySetting(
        "1",
        () => handler.handle(req, ctx),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 426);
    });

    it("does not let an unverifiable dispatch JWS grant topology trust", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://internal.proxy:3000/_ws", {
        headers: {
          host: "internal.proxy:3000",
          "x-forwarded-host": "preview.veryfront.me:3000",
          "x-project-slug": "attacker-selected",
          "x-veryfront-dispatch-jws": "attacker-supplied.bogus.value",
        },
      });
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        isLocalProject: false,
        projectSlug: "attacker-selected",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: {}, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await withProxyTopologySetting(
        undefined,
        () => handler.handle(req, ctx),
      );

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

    it("does not let a query parameter promote production into preview", async () => {
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

    it("shutdown clears all state", async () => {
      await HMRHandler.shutdown();
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

      const body = await result.response.json();
      assertEquals(body.status, "ok");
      assertEquals(body.clients, 0);
      assert(body.message.includes("WebSocket"));
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
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: new Response(null, { status: 101 }),
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
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: new Response(null, { status: 101 }),
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
        projectDir: "/tmp/test",
        projectSlug: "test-project",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: {
            upgradeWebSocket: () => ({
              socket: mock.socket,
              response: new Response(null, { status: 101 }),
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

    it("broadcasts once when external mode is registered", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const unregisterExternalSource = HMRHandler.registerExternalBroadcastSource();

      try {
        const req = new Request("http://localhost:3000/_ws", {
          headers: { upgrade: "websocket" },
        });
        const ctx = {
          requestContext: { mode: "preview" },
          mode: "development",
          projectDir: "/tmp/test",
          projectSlug: "test-project",
          securityConfig: null,
          cspUserHeader: null,
          adapter: {
            fs: {},
            server: {
              upgradeWebSocket: () => ({
                socket: mock.socket,
                response: new Response(null, { status: 101 }),
              }),
            },
          },
        } as unknown as Parameters<typeof handler.handle>[1];

        await handler.handle(req, ctx);

        // Ignore initial "connected" message; only validate reload/update emission.
        mock.sentMessages.length = 0;

        ReloadNotifier.triggerReload(["app.tsx"], { projectSlug: "test-project" });
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
      } finally {
        await unregisterExternalSource();
      }
    });
  });

  describe("HMR Handler - Adapter Isolation", () => {
    it("does not initialize hosted adapters from a preview endpoint request", async () => {
      const handler = new HMRHandler();

      let runWithContextCalled = false;

      const mockFs = {
        exists: async () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        runWithContext: async (
          _projectSlug: string,
          _token: string,
          fn: () => Promise<void>,
        ) => {
          runWithContextCalled = true;
          await fn();
        },
      };

      const req = new Request("http://localhost:3000/_ws");
      const ctx = {
        requestContext: { mode: "preview", branch: "main" },
        resolvedEnvironment: "preview",
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: mockFs, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 426);
      assertEquals(runWithContextCalled, false);
    });

    it("does not trigger adapter initialization for production requests", async () => {
      const handler = new HMRHandler();

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

      const req = new Request("http://localhost:3000/_ws?x-environment=preview");
      const ctx = {
        requestContext: { mode: "production" },
        resolvedEnvironment: "production", // Production mode
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: mockFs, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      assertEquals(runWithContextCalled, false);
    });

    it("does not trigger adapter initialization without proxyToken", async () => {
      const handler = new HMRHandler();

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

      const req = new Request("http://localhost:3000/_ws");
      const ctx = {
        requestContext: { mode: "preview" },
        resolvedEnvironment: "preview",
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: undefined, // No proxy token
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: mockFs, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      await handler.handle(req, ctx);

      assertEquals(runWithContextCalled, false);
    });

    it("does not touch hosted adapter initialization hooks", async () => {
      const handler = new HMRHandler();

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

      const req = new Request("http://localhost:3000/_ws");
      const ctx = {
        requestContext: { mode: "preview", branch: "main" },
        resolvedEnvironment: "preview",
        projectSlug: "test-project",
        projectId: "proj-123",
        proxyToken: "test-token",
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: { fs: mockFs, server: null },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 426);
    });
  });
});
