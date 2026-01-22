// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

/**
 * HMR Handler Tests
 *
 * Tests for the Preview HMR WebSocket handler:
 * - Message broadcasting
 * - Update types (update vs reload)
 * - Client management
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterAll, afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { HMRHandler } from "../../../../src/server/handlers/preview/hmr-handler.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

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

    it("is enabled in preview mode (regardless of isLocalDev)", () => {
      const handler = new HMRHandler();

      // Even when not local dev, preview mode should enable HMR
      const previewCtx = { requestContext: { mode: "preview", isLocalDev: false } } as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(previewCtx), true);
    });

    it("is enabled in local dev (regardless of mode)", () => {
      const handler = new HMRHandler();

      // In local dev, HMR should be enabled even without preview mode
      const productionModeCtx = { requestContext: { mode: "production", isLocalDev: true } } as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(productionModeCtx), true);
    });

    it("enabled function always returns true (check happens in handle)", () => {
      const handler = new HMRHandler();

      // The enabled function now always returns true because:
      // 1. WebSocket API doesn't support custom headers
      // 2. Proxy forwards environment via query params
      // 3. Environment check happens in handle() method
      const productionCtx = { requestContext: { mode: "production", isLocalDev: false } } as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(productionCtx), true);

      const noCtx = {} as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(noCtx), true);
    });

    it("handle returns continue for non-preview/non-localdev requests", async () => {
      const handler = new HMRHandler();

      const req = new Request("http://localhost:3000/_ws");
      const ctx = {
        requestContext: { mode: "production", isLocalDev: false },
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: null,
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      // Should return continue (not handle this request)
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("handle accepts preview via query param (for proxy WebSocket)", async () => {
      const handler = new HMRHandler();

      // Proxy forwards environment via query param since WebSocket API doesn't support headers
      const req = new Request("http://localhost:3000/_ws?x-environment=preview");
      const ctx = {
        requestContext: { mode: "production", isLocalDev: false }, // Not preview in context
        projectDir: "/tmp/test",
        securityConfig: null,
        cspUserHeader: null,
        adapter: {
          fs: {},
          server: null, // No server adapter - will return info response
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      // Should respond (not continue) because query param has x-environment=preview
      assertExists(result.response);
      assertEquals(result.response.status, 200); // Info response (not WebSocket, no upgrade header)
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
        adapter: {
          fs: {},
          server: null, // No server adapter - simulates no WebSocket support
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      // Should respond (not continue) - check for response property
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
        adapter: {
          fs: {},
          server: null, // No server adapter - simulates no WebSocket support
        },
      } as unknown as Parameters<typeof handler.handle>[1];

      const result = await handler.handle(req, ctx);

      assertExists(result.response);
      assertEquals(result.response.status, 501);
    });
  });
});
