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

import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { afterAll, afterEach, beforeEach, describe, it } from "std/testing/bdd.ts";
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
      assertEquals(handler.metadata.patterns[0].pattern, "/_ws");
      assertEquals(handler.metadata.patterns[0].exact, true);
    });

    it("is enabled only in preview mode", () => {
      const handler = new HMRHandler();

      // Should be enabled in preview mode
      const previewCtx = { proxyEnvironment: "preview" } as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(previewCtx), true);

      // Should be disabled in production mode
      const productionCtx = { proxyEnvironment: "production" } as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(productionCtx), false);

      // Should be disabled when no proxyEnvironment
      const noEnvCtx = {} as Parameters<
        NonNullable<typeof handler.metadata.enabled>
      >[0];
      assertEquals(handler.metadata.enabled?.(noEnvCtx), false);
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
        proxyEnvironment: "preview",
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
        proxyEnvironment: "preview",
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
