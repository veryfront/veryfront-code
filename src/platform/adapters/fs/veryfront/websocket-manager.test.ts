import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { InvalidationCallbacks } from "./types.ts";
import { WebSocketManager } from "./websocket-manager.ts";

interface TimerEntry {
  delay: number;
  callback: () => void;
}

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  send(_data: string): void {
    // no-op
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent("close"));
  }
}

function createWebSocketManager(): WebSocketManager {
  const cache = {
    deleteByPrefixAsync: async () => 0,
    deleteByPrefixAndSuffixAsync: async () => 0,
  } as unknown as FileCache;

  const client = {
    getProjectId: () => "project-1",
    listAllFiles: async () => [],
  } as unknown as VeryfrontApiClient;

  const invalidationCallbacks: InvalidationCallbacks = {};

  return new WebSocketManager({
    apiBaseUrl: "https://api.example.com/api",
    apiToken: "test-token",
    projectSlug: "test-project",
    cache,
    client,
    invalidationCallbacks,
    getContentContext: () => ({
      sourceType: "branch",
      projectSlug: "test-project",
      branch: "main",
    }),
    getContentSource: () => ({ type: "branch", branch: "main" }),
    getProjectDir: () => undefined,
    clearMemoryCaches: () => {},
    clearFileListIndex: () => {},
    setFileListCache: async () => {},
  });
}

describe("WebSocketManager", () => {
  let originalWebSocket: typeof WebSocket;
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;
  let nextTimerId = 1;
  let scheduledTimers = new Map<ReturnType<typeof setTimeout>, TimerEntry>();

  const runOnlyScheduledTimer = (): number => {
    assertEquals(scheduledTimers.size, 1);
    const [timerId, timer] = Array.from(scheduledTimers.entries())[0]!;
    scheduledTimers.delete(timerId);
    timer.callback();
    return timer.delay;
  };

  beforeEach(() => {
    MockWebSocket.instances = [];
    nextTimerId = 1;
    scheduledTimers = new Map<ReturnType<typeof setTimeout>, TimerEntry>();

    originalWebSocket = globalThis.WebSocket;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;

    (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;

    globalThis.setTimeout =
      ((handler: TimerHandler, timeout?: number): ReturnType<typeof setTimeout> => {
        const id = nextTimerId as ReturnType<typeof setTimeout>;
        nextTimerId++;

        const callback = typeof handler === "function"
          ? () => {
            (handler as (...args: unknown[]) => unknown)();
          }
          : () => {};

        scheduledTimers.set(id, { delay: timeout ?? 0, callback });
        return id;
      }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>): void => {
      if (id !== undefined) scheduledTimers.delete(id);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
      originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it("should not add an extra retry delay after reaching reconnect failure cap", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    assertEquals(MockWebSocket.instances.length, 1);

    const observedDelays: number[] = [];

    for (let attempt = 0; attempt < 10; attempt++) {
      const socket = MockWebSocket.instances.at(-1);
      assertExists(socket);
      socket.emitClose();
      observedDelays.push(runOnlyScheduledTimer());
    }

    assertEquals(observedDelays, [
      5000,
      10000,
      20000,
      40000,
      80000,
      120000,
      120000,
      120000,
      120000,
      120000,
    ]);
    assertEquals(MockWebSocket.instances.length, 11);
    assertEquals(scheduledTimers.size, 0);

    manager.dispose();
  });

  it("should return initial poke metrics", () => {
    const manager = createWebSocketManager();
    const metrics = manager.getPokeMetrics();
    assertEquals(metrics.received, 0);
    assertEquals(metrics.invalidationsTriggered, 0);
    assertEquals(metrics.lastPokeTime, 0);
    assertEquals(metrics.connectionId, null);
    manager.dispose();
  });

  it("should not connect when disposed", () => {
    const manager = createWebSocketManager();
    manager.dispose();
    manager.connect("project-1");
    assertEquals(MockWebSocket.instances.length, 0);
  });

  it("should handle dispose when no WebSocket is connected", () => {
    const manager = createWebSocketManager();
    manager.dispose();
    // Should not throw
  });

  it("should handle dispose when WebSocket is connected", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    assertEquals(MockWebSocket.instances.length, 1);
    manager.dispose();
    assertEquals(MockWebSocket.instances[0].readyState, MockWebSocket.CLOSED);
  });

  it("should set connection ID after connect", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    // Simulate onopen
    socket.onopen?.call(socket as unknown as WebSocket, new Event("open"));

    const metrics = manager.getPokeMetrics();
    assertExists(metrics.connectionId);

    manager.dispose();
  });

  it("should reset consecutive failures on open", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    // First close to create a failure
    const socket1 = MockWebSocket.instances[0];
    assertExists(socket1);
    socket1.emitClose();

    // Run timer to reconnect
    runOnlyScheduledTimer();

    // Second socket opens successfully
    const socket2 = MockWebSocket.instances[1];
    assertExists(socket2);
    socket2.onopen?.call(socket2 as unknown as WebSocket, new Event("open"));

    // Close again - delay should reset to 5000 (first failure)
    socket2.emitClose();

    // Find the reconnect timer among scheduled timers (may have heartbeat too)
    const timers = Array.from(scheduledTimers.values());
    const reconnectTimer = timers.find((t) => t.delay === 5000);
    assertExists(reconnectTimer);

    manager.dispose();
  });

  it("should handle error event without crashing", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    // Simulate error
    socket.onerror?.call(socket as unknown as WebSocket, new Event("error"));

    // Should not crash
    manager.dispose();
  });

  it("should reset failure counter after reaching max failures", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    // Simulate 10 failures
    for (let i = 0; i < 10; i++) {
      const socket = MockWebSocket.instances.at(-1);
      assertExists(socket);
      socket.emitClose();
      runOnlyScheduledTimer();
    }

    // On the next connect, the counter should have been reset
    // The 11th socket close should use the base delay (5000)
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    socket.emitClose();
    const delay = runOnlyScheduledTimer();
    assertEquals(delay, 5000);

    manager.dispose();
  });

  it("should handle WebSocket constructor throwing", () => {
    const OriginalMockWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = function () {
      throw new Error("Connection failed");
    };

    try {
      const manager = createWebSocketManager();
      manager.connect("project-1");

      // Should have scheduled a reconnect timer
      assertEquals(scheduledTimers.size, 1);
      const [, timer] = Array.from(scheduledTimers.entries())[0]!;
      assertEquals(timer.delay, 5000);

      manager.dispose();
    } finally {
      (globalThis as any).WebSocket = OriginalMockWebSocket;
    }
  });
});
