// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd";
import { HMRHandler } from "../../../../src/server/handlers/preview/hmr.handler.ts";
import { ReloadNotifier } from "../../../../src/server/reload-notifier.ts";
import { broadcastUpdate } from "../../../../src/server/handlers/preview/hmr-message-router.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
} from "#veryfront/utils";

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

      const req = new Request("http://localhost:3000/_ws");
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

    it("treats preview.veryfront.me as local preview host", async () => {
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

      assertExists(result.response);
      assertEquals(result.response.status, 200);
    });

    it("handle accepts preview via query param (for proxy WebSocket)", async () => {
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

      assertExists(result.response);
      assertEquals(result.response.status, 200);
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

    it("avoids duplicate reload broadcasts when external source is registered", async () => {
      const handler = new HMRHandler();
      const mock = createMockSocket();

      const unregisterExternalSource = HMRHandler.registerExternalBroadcastSource();
      const unsubscribeExternalReload = ReloadNotifier.subscribe((changedPaths, project) => {
        broadcastUpdate(changedPaths, project?.projectSlug);
      });

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
        unsubscribeExternalReload();
        unregisterExternalSource();
      }
    });
  });

  describe("HMR Handler - Adapter Initialization for Poke Reception", () => {
    it("triggers adapter initialization in proxy mode for preview requests", async () => {
      const handler = new HMRHandler();

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

      // Should return info response (not WebSocket upgrade)
      assertExists(result.response);
      assertEquals(result.response.status, 200);

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

      // Wait for any async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // runWithContext should NOT be called for production mode
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

      // Wait for any async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // runWithContext should NOT be called without proxyToken
      assertEquals(runWithContextCalled, false);
    });

    it("handles adapter initialization errors gracefully", async () => {
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

      // Should not throw - error is caught and logged
      const result = await handler.handle(req, ctx);

      // Wait for the async adapter initialization to complete/fail
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Handler should still return a valid response
      assertExists(result.response);
      assertEquals(result.response.status, 200);
    });
  });
});
