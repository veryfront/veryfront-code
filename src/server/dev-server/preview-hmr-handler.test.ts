/**
 * Tests for PreviewHmrHandler
 *
 * @module server/dev-server/preview-hmr-handler.test
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { createPreviewHmrHandler, PreviewHmrHandler } from "./preview-hmr-handler.ts";
import { resetPreviewBundler } from "#veryfront/bundler/preview-bundler.ts";
import type {
  EnvAdapter,
  FileSystem,
  RuntimeAdapter,
  Server,
} from "#veryfront/platform/adapters/base.ts";

// Mock adapter for testing
function createMockAdapter(): RuntimeAdapter {
  const mockFs: FileSystem = {
    readFile: async () => "export default function App() { return 'test'; }",
    writeFile: async () => {},
    exists: async () => true,
    stat: async () => ({ isFile: true, isDirectory: false, size: 100, mtime: new Date() }),
    mkdir: async () => {},
    readDir: async function* () {
      yield { name: "test.tsx", isFile: true, isDirectory: false };
    },
    remove: async () => {},
    makeTempDir: async () => "/tmp/test",
    watch: function* () {
      yield { kind: "modify", paths: ["/test.tsx"] };
    },
    cwd: async () => "/project",
    isSubPath: () => true,
  };

  const mockEnv: EnvAdapter = {
    get: () => undefined,
    set: () => {},
    toObject: () => ({}),
  };

  const mockServer: Server = {
    upgradeWebSocket: (_req: Request) => {
      // Create a mock WebSocket-like object for testing
      const socket = {
        readyState: 1, // WebSocket.OPEN
        send: () => {},
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as WebSocket;
      return {
        socket,
        response: new Response(null, { status: 101 }),
      };
    },
    stop: async () => {},
  };

  return {
    name: "mock",
    fs: mockFs,
    env: mockEnv,
    server: mockServer,
    serve: async () => mockServer,
    createBlobUrl: () => "blob:test",
    createBlobStore: () => ({
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      has: async () => false,
    }),
  };
}

describe("PreviewHmrHandler", () => {
  // Reset singleton between tests
  beforeEach(async () => {
    await resetPreviewBundler();
  });

  afterEach(async () => {
    await resetPreviewBundler();
  });

  describe("createPreviewHmrHandler", () => {
    it("should create a handler instance", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
        hmrPort: 3001,
      });

      assertExists(handler);
      assertEquals(handler instanceof PreviewHmrHandler, true);
    });
  });

  describe("getHmrRuntime", () => {
    it("should return HMR runtime code", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
        hmrPort: 3001,
      });

      const runtime = handler.getHmrRuntime();

      assertExists(runtime);
      assertEquals(runtime.includes("WebSocket"), true);
      assertEquals(runtime.includes("test-project"), true);
    });
  });

  describe("getStats", () => {
    it("should return bundler statistics", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
      });

      const stats = handler.getStats();

      assertExists(stats);
      assertEquals(typeof stats.activeContexts, "number");
      assertEquals(typeof stats.maxContexts, "number");
      assertEquals(typeof stats.hmrClientCount, "number");
    });
  });

  describe("handleWebSocketUpgrade", () => {
    it("should return null for non-HMR paths", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
      });

      const req = new Request("http://localhost:3000/other-path", {
        headers: { upgrade: "websocket" },
      });

      const result = handler.handleWebSocketUpgrade(req, adapter.server!);

      assertEquals(result, null);
    });

    it("should return null for non-websocket requests to HMR path", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
      });

      const req = new Request("http://localhost:3000/_vf/hmr");

      const result = handler.handleWebSocketUpgrade(req, adapter.server!);

      assertEquals(result, null);
    });

    it("should handle WebSocket upgrade for HMR path", () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
      });

      const req = new Request("http://localhost:3000/_vf/hmr?project=test-project", {
        headers: { upgrade: "websocket" },
      });

      const result = handler.handleWebSocketUpgrade(req, adapter.server!);

      assertExists(result);
      assertEquals(result.status, 101);
    });
  });

  describe("shutdown", () => {
    it("should shutdown without throwing", async () => {
      const adapter = createMockAdapter();
      const handler = createPreviewHmrHandler({
        projectId: "test-project",
        projectDir: "/test/project",
        adapter,
      });

      // Should not throw
      await handler.shutdown();
    });
  });
});
