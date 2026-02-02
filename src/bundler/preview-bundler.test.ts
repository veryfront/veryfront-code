/**
 * Preview Bundler Tests
 *
 * Tests for the preview bundler with esbuild watch mode and HMR support.
 *
 * Note: Full esbuild integration tests are complex and require proper filesystem setup.
 * These unit tests focus on the preview bundler's context management, HMR client
 * handling, and supporting functions.
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getPreviewBundler,
  PreviewBundler,
  type PreviewBundlerConfig,
  resetPreviewBundler,
} from "./preview-bundler.ts";

describe("bundler/preview-bundler", () => {
  // Track bundler instances for cleanup
  let testBundlers: PreviewBundler[] = [];

  afterEach(async () => {
    // Clean up all test bundler instances
    for (const bundler of testBundlers) {
      await bundler.shutdown();
    }
    testBundlers = [];

    // Reset singleton
    await resetPreviewBundler();
  });

  // Helper to create and track bundlers for cleanup
  function createTestBundler(config?: PreviewBundlerConfig): PreviewBundler {
    const bundler = new PreviewBundler(config);
    testBundlers.push(bundler);
    return bundler;
  }

  describe("PreviewBundler constructor", () => {
    it("should create instance with default config", () => {
      const bundler = createTestBundler();
      assertExists(bundler);

      const stats = bundler.getStats();
      assertEquals(stats.activeContexts, 0);
      assertEquals(stats.maxContexts, 50); // Default
      assertEquals(stats.hmrClientCount, 0);
    });

    it("should create instance with custom config", () => {
      const config: PreviewBundlerConfig = {
        maxContexts: 10,
        evictionTimeoutMs: 60_000,
        hmrPort: 4000,
      };

      const bundler = createTestBundler(config);
      assertExists(bundler);

      const stats = bundler.getStats();
      assertEquals(stats.maxContexts, 10);
    });
  });

  describe("getStats", () => {
    it("should return correct initial stats", () => {
      const bundler = createTestBundler();
      const stats = bundler.getStats();

      assertEquals(stats.activeContexts, 0);
      assertEquals(stats.hmrClientCount, 0);
      assertExists(stats.maxContexts);
    });
  });

  describe("HMR client management", () => {
    it("should register HMR client", () => {
      const bundler = createTestBundler();

      // Create a mock WebSocket-like object
      const mockWs = createMockWebSocket();

      bundler.registerHmrClient("test-project", mockWs);

      const stats = bundler.getStats();
      assertEquals(stats.hmrClientCount, 1);
    });

    it("should unregister HMR client", () => {
      const bundler = createTestBundler();
      const mockWs = createMockWebSocket();

      bundler.registerHmrClient("test-project", mockWs);
      assertEquals(bundler.getStats().hmrClientCount, 1);

      bundler.unregisterHmrClient("test-project", mockWs);
      assertEquals(bundler.getStats().hmrClientCount, 0);
    });

    it("should handle multiple clients for same project", () => {
      const bundler = createTestBundler();
      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      bundler.registerHmrClient("test-project", mockWs1);
      bundler.registerHmrClient("test-project", mockWs2);

      assertEquals(bundler.getStats().hmrClientCount, 2);

      bundler.unregisterHmrClient("test-project", mockWs1);
      assertEquals(bundler.getStats().hmrClientCount, 1);

      bundler.unregisterHmrClient("test-project", mockWs2);
      assertEquals(bundler.getStats().hmrClientCount, 0);
    });

    it("should handle clients for multiple projects", () => {
      const bundler = createTestBundler();
      const mockWs1 = createMockWebSocket();
      const mockWs2 = createMockWebSocket();

      bundler.registerHmrClient("project-1", mockWs1);
      bundler.registerHmrClient("project-2", mockWs2);

      assertEquals(bundler.getStats().hmrClientCount, 2);
    });

    it("should send connected message on registration", () => {
      const bundler = createTestBundler();
      const messages: string[] = [];
      const mockWs = createMockWebSocket((msg) => messages.push(msg));

      bundler.registerHmrClient("test-project", mockWs);

      assertEquals(messages.length, 1);
      const message = JSON.parse(messages[0]!);
      assertEquals(message.type, "connected");
      assertEquals(message.projectId, "test-project");
      assertExists(message.timestamp);
    });

    it("should handle unregistering non-existent client gracefully", () => {
      const bundler = createTestBundler();
      const mockWs = createMockWebSocket();

      // Should not throw
      bundler.unregisterHmrClient("non-existent-project", mockWs);
      assertEquals(bundler.getStats().hmrClientCount, 0);
    });
  });

  describe("getHmrRuntime", () => {
    it("should return HMR runtime code", () => {
      const bundler = createTestBundler({ hmrPort: 3001 });
      const runtime = bundler.getHmrRuntime("test-project");

      assertExists(runtime);
      assertEquals(typeof runtime, "string");
      assertEquals(runtime.includes("WebSocket"), true);
      assertEquals(runtime.includes("test-project"), true);
    });
  });

  describe("getCurrentBundle", () => {
    it("should return null for non-existent project", () => {
      const bundler = createTestBundler();
      const bundle = bundler.getCurrentBundle("non-existent");
      assertEquals(bundle, null);
    });
  });

  describe("getErrors", () => {
    it("should return empty array for non-existent project", () => {
      const bundler = createTestBundler();
      const errors = bundler.getErrors("non-existent");
      assertEquals(errors, []);
    });
  });

  describe("rebuild", () => {
    it("should throw for non-existent project", async () => {
      const bundler = createTestBundler();

      await assertRejects(
        async () => await bundler.rebuild("non-existent"),
        Error,
        "No context found for project",
      );
    });
  });

  describe("stopWatching", () => {
    it("should not throw for non-existent project", async () => {
      const bundler = createTestBundler();
      // Should not throw
      await bundler.stopWatching("non-existent");
    });
  });

  describe("shutdown", () => {
    it("should clean up contexts and stop eviction timer", async () => {
      const bundler = createTestBundler();

      // Verify initial state
      assertEquals(bundler.getStats().activeContexts, 0);

      await bundler.shutdown();

      // After shutdown, should have no contexts
      assertEquals(bundler.getStats().activeContexts, 0);
    });

    it("should not throw when called multiple times", async () => {
      const bundler = createTestBundler();

      await bundler.shutdown();
      await bundler.shutdown(); // Should not throw
    });
  });

  describe("singleton functions", () => {
    it("getPreviewBundler should return singleton instance", () => {
      const instance1 = getPreviewBundler();
      const instance2 = getPreviewBundler();

      assertEquals(instance1, instance2);
    });

    it("getPreviewBundler should accept config on first call", () => {
      const config: PreviewBundlerConfig = { maxContexts: 25 };
      const instance = getPreviewBundler(config);

      assertEquals(instance.getStats().maxContexts, 25);
    });

    it("resetPreviewBundler should clear singleton", async () => {
      const instance1 = getPreviewBundler({ maxContexts: 30 });
      assertEquals(instance1.getStats().maxContexts, 30);

      await resetPreviewBundler();

      // After reset, new instance should use default or new config
      const instance2 = getPreviewBundler({ maxContexts: 40 });
      assertEquals(instance2.getStats().maxContexts, 40);
    });
  });
});

// Helper function to create mock WebSocket
function createMockWebSocket(onMessage?: (msg: string) => void): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: (msg: string) => {
      if (onMessage) onMessage(msg);
    },
    close: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as WebSocket;
}
