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

  constructor(public readonly url: string) {
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
});
