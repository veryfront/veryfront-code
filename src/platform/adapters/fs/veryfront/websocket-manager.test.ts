import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { InvalidationCallbacks } from "./types.ts";
import { WebSocketManager } from "./websocket-manager.ts";
import {
  buildReloadProjectContext,
  getReconnectDelay,
  parsePokeWebSocketMessage,
  WS_MAX_MESSAGE_CODE_UNITS,
} from "./websocket-manager-helpers.ts";
import { getCurrentRequestContext } from "./request-context.ts";
import { __resetLoggerConfigForTests } from "#veryfront/utils/logger/logger.ts";
import {
  clearAllPendingInvalidations,
  getPendingInvalidationsCount,
} from "./invalidation-state.ts";

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

  protocols: string | string[] | undefined;

  constructor(readonly url: string, protocols?: string | string[]) {
    this.protocols = protocols;
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

function captureConsoleMethod(
  method: "debug" | "log" | "warn",
): { getOutput: () => string; reset: () => void; restore: () => void } {
  const original = console[method];
  let capturedOutput = "";

  console[method] = ((msg: string) => {
    capturedOutput = msg;
  }) as typeof console[typeof method];

  return {
    getOutput: () => capturedOutput,
    reset: () => {
      capturedOutput = "";
    },
    restore: () => {
      console[method] = original;
    },
  };
}

function withJsonLogFormat<T>(fn: () => T): T {
  const previousLogFormat = Deno.env.get("LOG_FORMAT");
  const previousLogLevel = Deno.env.get("LOG_LEVEL");
  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();

  try {
    return fn();
  } finally {
    if (previousLogFormat == null) Deno.env.delete("LOG_FORMAT");
    else Deno.env.set("LOG_FORMAT", previousLogFormat);
    if (previousLogLevel == null) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", previousLogLevel);
    __resetLoggerConfigForTests();
  }
}

function createWebSocketManager(options: {
  apiBaseUrl?: string;
  client?: Partial<VeryfrontApiClient>;
  invalidationCallbacks?: InvalidationCallbacks;
  pregenerateStyles?: (
    files: Array<{ path: string; content?: string }>,
  ) => Promise<{ hash: string; assetPath: string } | undefined>;
  cache?: Partial<FileCache>;
  clearMemoryCaches?: () => void;
} = {}): WebSocketManager {
  const cache = {
    deleteAsync: async () => false,
    deleteByPrefixAsync: async () => 0,
    deleteByPrefixAndSuffixAsync: async () => 0,
    ...options.cache,
  } as unknown as FileCache;

  const client = {
    getProjectId: () => "project-1",
    listAllFiles: async () => [],
    ...options.client,
  } as unknown as VeryfrontApiClient;

  const invalidationCallbacks: InvalidationCallbacks = options.invalidationCallbacks ?? {};

  return new WebSocketManager({
    apiBaseUrl: options.apiBaseUrl ?? "https://api.example.com/api",
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
    clearMemoryCaches: options.clearMemoryCaches ?? (() => {}),
    replaceSourceSnapshot: async () => {},
    pregenerateStyles: options.pregenerateStyles,
  });
}

describe("WebSocketManager", () => {
  it("buildReloadProjectContext maps branch previews to preview environment", () => {
    const context = buildReloadProjectContext(
      { sourceType: "branch", projectSlug: "test-project", branch: "feat-x", releaseId: "rel-1" },
      "test-project",
      "project-1",
      { hash: "hash-1", assetPath: "/_vf/css/hash-1.css" },
    );

    assertEquals(context.environment, "preview");
    assertEquals(context.branch, "feat-x");
    assertEquals(context.releaseId, "rel-1");
    assertEquals(context.styleArtifactHash, "hash-1");
  });

  it("getReconnectDelay caps exponential backoff at the configured maximum", () => {
    assertEquals(getReconnectDelay(1), 5000);
    assertEquals(getReconnectDelay(2), 10000);
    assertEquals(getReconnectDelay(6), 120000);
    assertEquals(getReconnectDelay(10), 120000);
  });

  describe("parsePokeWebSocketMessage", () => {
    it("parses poke messages with object payloads", () => {
      const parsed = parsePokeWebSocketMessage(JSON.stringify({
        type: "poke",
        data: {
          changedPaths: ["app/page.tsx"],
          branchName: "main",
        },
      }));

      assertEquals(parsed, {
        type: "poke",
        payload: {
          changedPaths: ["app/page.tsx"],
          branchName: "main",
        },
      });
    });

    it("parses entity_updated messages and normalizes primitive payloads", () => {
      assertEquals(
        parsePokeWebSocketMessage(JSON.stringify({
          type: "entity_updated",
          data: "ignored",
        })),
        {
          type: "entity_updated",
          payload: {},
        },
      );
    });

    it("ignores non-poke messages and non-object frames", () => {
      assertEquals(parsePokeWebSocketMessage(JSON.stringify({ type: "noop", data: {} })), null);
      assertEquals(parsePokeWebSocketMessage(JSON.stringify(null)), null);
    });

    it("returns null for malformed JSON (parser logs the error at warn)", () => {
      assertEquals(parsePokeWebSocketMessage("{"), null);
    });

    it("rejects non-text and oversized messages without parsing them", () => {
      assertEquals(parsePokeWebSocketMessage(new Uint8Array([1, 2, 3])), null);
      assertEquals(parsePokeWebSocketMessage("x".repeat(WS_MAX_MESSAGE_CODE_UNITS + 1)), null);
    });
  });
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

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  beforeEach(() => {
    clearAllPendingInvalidations();
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
    clearAllPendingInvalidations();
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
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    assertEquals(socket.readyState, MockWebSocket.CLOSED);
  });

  it("ignores callbacks from a superseded connection", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1", "first-token");
    const firstSocket = MockWebSocket.instances[0];
    assertExists(firstSocket);
    const staleOpen = firstSocket.onopen;
    const staleClose = firstSocket.onclose;

    manager.connect("project-1", "second-token");
    const secondSocket = MockWebSocket.instances[1];
    assertExists(secondSocket);
    const currentConnectionId = manager.getPokeMetrics().connectionId;
    assertExists(currentConnectionId);
    assertEquals(firstSocket.readyState, MockWebSocket.CLOSED);

    staleOpen?.call(firstSocket as unknown as WebSocket, new Event("open"));
    staleClose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"));

    assertEquals(manager.getPokeMetrics().connectionId, currentConnectionId);
    assertEquals(scheduledTimers.size, 0);
    assertEquals(secondSocket.readyState, MockWebSocket.OPEN);
    manager.dispose();
  });

  it("reuses a live connection for the same credential and rotates changed credentials", () => {
    const manager = createWebSocketManager();
    manager.ensureConnected("project-1", "first-token");
    const firstSocket = MockWebSocket.instances[0];
    assertExists(firstSocket);

    manager.ensureConnected("project-1", "first-token");
    assertEquals(MockWebSocket.instances.length, 1);

    manager.ensureConnected("project-1", "rotated-token");
    assertEquals(MockWebSocket.instances.length, 2);
    assertEquals(firstSocket.readyState, MockWebSocket.CLOSED);
    assertEquals(MockWebSocket.instances[1]?.protocols, ["bearer-rotated-token"]);
    manager.dispose();
  });

  it("can disconnect intentionally and reconnect later", () => {
    const manager = createWebSocketManager();
    manager.ensureConnected("project-1", "connection-token");
    const firstSocket = MockWebSocket.instances[0];
    assertExists(firstSocket);
    const staleClose = firstSocket.onclose;

    manager.disconnect();
    assertEquals(firstSocket.readyState, MockWebSocket.CLOSED);
    assertEquals(manager.getPokeMetrics().connectionId, null);
    assertEquals(scheduledTimers.size, 0);

    staleClose?.call(firstSocket as unknown as WebSocket, new CloseEvent("close"));
    assertEquals(scheduledTimers.size, 0);

    manager.ensureConnected("project-1", "connection-token");
    assertEquals(MockWebSocket.instances.length, 2);
    assertEquals(MockWebSocket.instances[1]?.protocols, ["bearer-connection-token"]);
    manager.dispose();
  });

  it("ignores a late open after disposal", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    const lateOpen = socket.onopen;

    manager.dispose();
    lateOpen?.call(socket as unknown as WebSocket, new Event("open"));

    const internals = manager as unknown as {
      wsHeartbeatTimer: ReturnType<typeof setInterval> | null;
    };
    assertEquals(internals.wsHeartbeatTimer, null);
    assertEquals(manager.getPokeMetrics().connectionId, null);
  });

  it("releases pending preview invalidation ownership on disposal", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );

    assertEquals(getPendingInvalidationsCount(), 1);
    assertEquals(scheduledTimers.size, 1);
    manager.dispose();
    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(scheduledTimers.size, 0);
  });

  it("cancels debounced invalidation work when the content context changes", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );

    assertEquals(getPendingInvalidationsCount(), 1);
    assertEquals(scheduledTimers.size, 1);

    manager.onContentContextChanged();

    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(scheduledTimers.size, 0);
    assertEquals(manager.getPokeMetrics().invalidationsTriggered, 0);
    manager.dispose();
  });

  it("ignores unsafe changed paths without opening an invalidation window", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["../outside.ts"], branchName: "main" },
        }),
      }),
    );

    assertEquals(manager.getPokeMetrics().received, 0);
    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(scheduledTimers.size, 0);
    manager.dispose();
  });

  it("retries a failed immediate volatile-cache clear during scheduled invalidation", async () => {
    let clearCalls = 0;
    let reloadCalls = 0;
    const manager = createWebSocketManager({
      clearMemoryCaches: () => {
        clearCalls++;
        if (clearCalls === 1) throw new Error("temporary memory-cache failure");
      },
      invalidationCallbacks: {
        triggerReload: () => {
          reloadCalls++;
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );

    assertEquals(clearCalls, 1);
    assertEquals(scheduledTimers.size, 1);
    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(clearCalls, 2);
    assertEquals(reloadCalls, 1);
    assertEquals(getPendingInvalidationsCount(), 0);
    manager.dispose();
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

  it("should remain at maximum backoff until a connection opens", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    // Simulate 10 failures
    for (let i = 0; i < 10; i++) {
      const socket = MockWebSocket.instances.at(-1);
      assertExists(socket);
      socket.emitClose();
      runOnlyScheduledTimer();
    }

    // A failure after the cap must stay capped rather than cycling back to
    // aggressive five-second retries.
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    socket.emitClose();
    const delay = runOnlyScheduledTimer();
    assertEquals(delay, 120000);

    manager.dispose();
  });

  it("retains the connection credential after a constructor failure", () => {
    const OriginalMockWebSocket = (globalThis as any).WebSocket;
    let attempts = 0;
    (globalThis as any).WebSocket = function (
      url: string,
      protocols?: string | string[],
    ) {
      attempts++;
      if (attempts === 1) throw new Error("Connection failed");
      return new MockWebSocket(url, protocols);
    };

    try {
      const manager = createWebSocketManager();
      manager.connect("project-1", "connection-token");

      assertEquals(scheduledTimers.size, 1);
      const [, timer] = Array.from(scheduledTimers.entries())[0]!;
      assertEquals(timer.delay, 5000);

      manager.setApiToken("replacement-token");
      runOnlyScheduledTimer();
      const socket = MockWebSocket.instances.at(-1);
      assertExists(socket);
      assertEquals(socket.protocols, ["bearer-connection-token"]);

      manager.dispose();
    } finally {
      (globalThis as any).WebSocket = OriginalMockWebSocket;
    }
  });

  it("retains the connection credential after a heartbeat timeout", () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let heartbeat: (() => void) | undefined;

    globalThis.setInterval = ((handler: TimerHandler) => {
      heartbeat = typeof handler === "function"
        ? () => (handler as (...args: unknown[]) => unknown)()
        : () => {};
      return 1 as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;

    try {
      const manager = createWebSocketManager();
      manager.connect("project-1", "connection-token");
      const socket = MockWebSocket.instances.at(-1);
      assertExists(socket);
      socket.onopen?.call(socket as unknown as WebSocket, new Event("open"));
      assertExists(heartbeat);

      manager.setApiToken("replacement-token");
      const internals = manager as unknown as { wsLastPong: number };
      internals.wsLastPong = 0;
      heartbeat();

      const reconnected = MockWebSocket.instances.at(-1);
      assertExists(reconnected);
      assertEquals(reconnected.protocols, ["bearer-connection-token"]);
      manager.dispose();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it("should include projectSlug in connection lifecycle logs", () => {
    const debugCapture = captureConsoleMethod("debug");
    const logCapture = captureConsoleMethod("log");
    const warnCapture = captureConsoleMethod("warn");

    try {
      withJsonLogFormat(() => {
        const manager = createWebSocketManager();
        manager.connect("project-1");

        const connectEntry = JSON.parse(debugCapture.getOutput()) as {
          message: string;
          projectSlug?: string;
        };
        assertEquals(connectEntry.message, "Connecting to WebSocket");
        assertEquals(connectEntry.projectSlug, "test-project");

        const socket = MockWebSocket.instances[0];
        assertExists(socket);

        debugCapture.reset();
        socket.emitClose();

        const closeEntry = JSON.parse(warnCapture.getOutput()) as {
          message: string;
          projectSlug?: string;
          projectId?: string;
          project_id?: string;
          context?: {
            delayMs?: number;
            consecutiveFailures?: number;
            url?: string;
          };
        };
        assertEquals(closeEntry.message, "WebSocket reconnect scheduled after close");
        assertEquals(closeEntry.projectSlug, "test-project");
        assertEquals(closeEntry.projectId, "project-1");
        assertEquals(closeEntry.project_id, "project-1");
        assertEquals(closeEntry.context?.url, "wss://api.example.com/ws/project-1/events");
        assertEquals(closeEntry.context?.delayMs, 5000);
        assertEquals(closeEntry.context?.consecutiveFailures, 1);

        logCapture.reset();
        runOnlyScheduledTimer();
        const reconnectedSocket = MockWebSocket.instances[1];
        assertExists(reconnectedSocket);
        reconnectedSocket.onopen?.call(
          reconnectedSocket as unknown as WebSocket,
          new Event("open"),
        );

        const recoveryEntry = JSON.parse(logCapture.getOutput()) as {
          message: string;
          projectSlug?: string;
          projectId?: string;
          project_id?: string;
          context?: {
            consecutiveFailures?: number;
          };
        };
        assertEquals(recoveryEntry.message, "WebSocket reconnect recovered");
        assertEquals(recoveryEntry.projectSlug, "test-project");
        assertEquals(recoveryEntry.projectId, "project-1");
        assertEquals(recoveryEntry.project_id, "project-1");
        assertEquals(recoveryEntry.context?.consecutiveFailures, 1);

        warnCapture.reset();
        reconnectedSocket.onerror?.call(
          reconnectedSocket as unknown as WebSocket,
          new Event("error"),
        );

        const errorEntry = JSON.parse(warnCapture.getOutput()) as {
          message: string;
          projectSlug?: string;
        };
        assertEquals(errorEntry.message, "WebSocket error");
        assertEquals(errorEntry.projectSlug, "test-project");

        manager.dispose();
      });
    } finally {
      debugCapture.restore();
      logCapture.restore();
      warnCapture.restore();
    }
  });

  it("redacts WebSocket URL credentials from reconnect warnings", () => {
    const warnCapture = captureConsoleMethod("warn");

    try {
      withJsonLogFormat(() => {
        const manager = createWebSocketManager({
          apiBaseUrl: "https://user:secret@api.example.com/api",
        });
        manager.connect("project-1");

        const socket = MockWebSocket.instances[0];
        assertExists(socket);
        socket.emitClose();

        const rawLog = warnCapture.getOutput();
        assertEquals(rawLog.includes("user:secret"), false);
        assertEquals(rawLog.includes("secret@"), false);

        const closeEntry = JSON.parse(rawLog) as {
          message: string;
          context?: {
            url?: string;
          };
        };
        assertEquals(closeEntry.message, "WebSocket reconnect scheduled after close");
        assertEquals(closeEntry.context?.url, "wss://api.example.com/ws/project-1/events");

        manager.dispose();
      });
    } finally {
      warnCapture.restore();
    }
  });

  it("should include projectSlug when WebSocket connection setup fails", () => {
    const warnCapture = captureConsoleMethod("warn");
    const OriginalMockWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = function () {
      throw new Error("Connection failed");
    };

    try {
      withJsonLogFormat(() => {
        const manager = createWebSocketManager();
        manager.connect("project-1");

        const entry = JSON.parse(warnCapture.getOutput()) as {
          message: string;
          projectSlug?: string;
        };
        assertEquals(entry.message, "Failed to connect WebSocket");
        assertEquals(entry.projectSlug, "test-project");

        manager.dispose();
      });
    } finally {
      (globalThis as any).WebSocket = OriginalMockWebSocket;
      warnCapture.restore();
    }
  });

  it("should derive ws:// from http:// base URL", () => {
    const cache = {
      deleteByPrefixAsync: async () => 0,
      deleteByPrefixAndSuffixAsync: async () => 0,
    } as unknown as FileCache;

    const client = {
      getProjectId: () => "project-1",
      listAllFiles: async () => [],
    } as unknown as VeryfrontApiClient;

    const manager = new WebSocketManager({
      apiBaseUrl: "http://api.example.com/api",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache,
      client,
      invalidationCallbacks: {},
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      }),
      getContentSource: () => ({ type: "branch", branch: "main" }),
      getProjectDir: () => undefined,
      clearMemoryCaches: () => {},
      replaceSourceSnapshot: async () => {},
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // http:// base URL should produce ws:// WebSocket URL
    assertEquals(socket.url.startsWith("ws://"), true);
    // Token is sent via subprotocol, not query string
    assertEquals(socket.url.includes("token="), false);
    assertEquals(socket.protocols, ["bearer-test-token"]);

    manager.dispose();
  });

  it("retains the connection credential across reconnects", () => {
    const manager = createWebSocketManager();

    manager.connect("project-1", "connection-token");
    let socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    assertEquals(socket.protocols, ["bearer-connection-token"]);

    manager.setApiToken("fresh-request-token");
    socket.emitClose();

    runOnlyScheduledTimer();

    socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    assertEquals(socket.protocols, ["bearer-connection-token"]);

    manager.dispose();
  });

  it("should derive wss:// from https:// base URL", () => {
    const cache = {
      deleteByPrefixAsync: async () => 0,
      deleteByPrefixAndSuffixAsync: async () => 0,
    } as unknown as FileCache;

    const client = {
      getProjectId: () => "project-1",
      listAllFiles: async () => [],
    } as unknown as VeryfrontApiClient;

    const manager = new WebSocketManager({
      apiBaseUrl: "https://api.example.com/api",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache,
      client,
      invalidationCallbacks: {},
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      }),
      getContentSource: () => ({ type: "branch", branch: "main" }),
      getProjectDir: () => undefined,
      clearMemoryCaches: () => {},
      replaceSourceSnapshot: async () => {},
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // https:// base URL should produce wss:// WebSocket URL
    assertEquals(socket.url.startsWith("wss://"), true);

    manager.dispose();
  });

  it("should keep ws:// for K8s internal service hostnames", () => {
    const cache = {
      deleteByPrefixAsync: async () => 0,
      deleteByPrefixAndSuffixAsync: async () => 0,
    } as unknown as FileCache;

    const client = {
      getProjectId: () => "project-1",
      listAllFiles: async () => [],
    } as unknown as VeryfrontApiClient;

    const manager = new WebSocketManager({
      apiBaseUrl: "http://veryfront-api:80",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache,
      client,
      invalidationCallbacks: {},
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      }),
      getContentSource: () => ({ type: "branch", branch: "main" }),
      getProjectDir: () => undefined,
      clearMemoryCaches: () => {},
      replaceSourceSnapshot: async () => {},
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // K8s internal service (http://) should stay as ws://
    assertEquals(socket.url.startsWith("ws://"), true);

    manager.dispose();
  });

  it("should keep ws:// for localhost connections", () => {
    const cache = {
      deleteByPrefixAsync: async () => 0,
      deleteByPrefixAndSuffixAsync: async () => 0,
    } as unknown as FileCache;

    const client = {
      getProjectId: () => "project-1",
      listAllFiles: async () => [],
    } as unknown as VeryfrontApiClient;

    const manager = new WebSocketManager({
      apiBaseUrl: "http://localhost:8080/api",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache,
      client,
      invalidationCallbacks: {},
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      }),
      getContentSource: () => ({ type: "branch", branch: "main" }),
      getProjectDir: () => undefined,
      clearMemoryCaches: () => {},
      replaceSourceSnapshot: async () => {},
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // localhost should stay as ws://
    assertEquals(socket.url.startsWith("ws://"), true);

    manager.dispose();
  });

  it("should keep ws:// for IPv6 loopback connections", () => {
    const cache = {
      deleteByPrefixAsync: async () => 0,
      deleteByPrefixAndSuffixAsync: async () => 0,
    } as unknown as FileCache;

    const client = {
      getProjectId: () => "project-1",
      listAllFiles: async () => [],
    } as unknown as VeryfrontApiClient;

    const manager = new WebSocketManager({
      apiBaseUrl: "http://[::1]:8080/api",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache,
      client,
      invalidationCallbacks: {},
      getContentContext: () => ({
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      }),
      getContentSource: () => ({ type: "branch", branch: "main" }),
      getProjectDir: () => undefined,
      clearMemoryCaches: () => {},
      replaceSourceSnapshot: async () => {},
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // IPv6 loopback should stay as ws://
    assertEquals(socket.url.startsWith("ws://"), true);

    manager.dispose();
  });

  it("includes pregenerated preview stylesheet metadata in reload callbacks", async () => {
    let capturedProject: InvalidationCallbacks extends {
      triggerReload?: (changedPaths?: string[], project?: infer T) => void;
    } ? T | undefined
      : never;
    let capturedChangedPaths: string[] | undefined;
    let apiRequestContext = getCurrentRequestContext();

    const manager = createWebSocketManager({
      client: {
        listAllFiles: async () => {
          apiRequestContext = getCurrentRequestContext();
          return [{
            path: "app/page.tsx",
            type: "page",
            size: 32,
            updated_at: "2026-03-22T00:00:00.000Z",
            content: "<div class='text-red-500'/>",
          }];
        },
      },
      invalidationCallbacks: {
        triggerReload: (changedPaths, project) => {
          capturedChangedPaths = changedPaths;
          capturedProject = project;
        },
      },
      pregenerateStyles: async () => ({
        hash: "hash-1",
        assetPath: "/_vf/css/hash-1.css",
      }),
    });

    manager.connect("project-1", "connection-token");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: {
            changedPaths: ["app/page.tsx"],
            branchName: "main",
          },
        }),
      }),
    );

    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(capturedChangedPaths, ["app/page.tsx"]);
    assertEquals(capturedProject?.styleArtifactHash, "hash-1");
    assertEquals(capturedProject?.styleAssetPath, "/_vf/css/hash-1.css");
    assertEquals(apiRequestContext?.requestApiCredential, {
      projectSlug: "test-project",
      projectId: "project-1",
      token: "connection-token",
    });
    assertEquals(apiRequestContext?.cacheApiCredential, {
      projectSlug: "test-project",
      projectId: "project-1",
      token: "connection-token",
    });

    manager.dispose();
  });

  it("selective invalidation deletes only exact keys for the current project source", async () => {
    const deletedKeys: string[] = [];
    const deletedPrefixes: string[] = [];
    const manager = createWebSocketManager({
      cache: {
        deleteAsync: (key) => {
          deletedKeys.push(key);
          return Promise.resolve(true);
        },
        deleteByPrefixAsync: (prefix) => {
          deletedPrefixes.push(prefix);
          return Promise.resolve(0);
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );

    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(deletedKeys.sort(), [
      "dir:branch:test-project:main:",
      "dir:branch:test-project:main:app",
      "file:branch:test-project:main:app/page.tsx",
      "files:branch:test-project:main",
      "stat:branch:test-project:main:app/page.tsx",
    ]);
    assertEquals(deletedPrefixes, ["stat:branch:test-project:main:resolve:"]);
    manager.dispose();
  });

  it("selective invalidation clears every cached ancestor directory", async () => {
    const deletedKeys: string[] = [];
    const manager = createWebSocketManager({
      cache: {
        deleteAsync: (key) => {
          deletedKeys.push(key);
          return Promise.resolve(true);
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: {
            changedPaths: ["src/components/ui/button.tsx"],
            branchName: "main",
          },
        }),
      }),
    );

    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(
      deletedKeys.filter((key) => key.startsWith("dir:")).sort(),
      [
        "dir:branch:test-project:main:",
        "dir:branch:test-project:main:src",
        "dir:branch:test-project:main:src/components",
        "dir:branch:test-project:main:src/components/ui",
      ],
    );
    manager.dispose();
  });

  it("full invalidation scopes prefix deletion to the current project source", async () => {
    const deletedKeys: string[] = [];
    const deletedPrefixes: string[] = [];
    const manager = createWebSocketManager({
      cache: {
        deleteAsync: (key) => {
          deletedKeys.push(key);
          return Promise.resolve(true);
        },
        deleteByPrefixAsync: (prefix) => {
          deletedPrefixes.push(prefix);
          return Promise.resolve(0);
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { branchName: "main" },
        }),
      }),
    );

    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(deletedKeys, ["files:branch:test-project:main"]);
    assertEquals(deletedPrefixes.sort(), [
      "dir:branch:test-project:main:",
      "file:branch:test-project:main:",
      "stat:branch:test-project:main:",
    ]);
    manager.dispose();
  });

  it("a pending full invalidation supersedes selective debounce work", async () => {
    const reloads: Array<string[] | undefined> = [];
    const manager = createWebSocketManager({
      invalidationCallbacks: {
        triggerReload: (changedPaths) => reloads.push(changedPaths),
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );
    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { branchName: "main" },
        }),
      }),
    );

    assertEquals(scheduledTimers.size, 1);
    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(reloads, [undefined]);
    assertEquals(manager.getPokeMetrics().invalidationsTriggered, 1);
    manager.dispose();
  });

  it("evicts the current adapter after successful selective invalidation", async () => {
    let evicted = 0;

    const manager = createWebSocketManager({
      client: {
        listAllFiles: async () => [{
          path: "pages/index.mdx",
          type: "page",
          size: 10,
          updated_at: "2026-04-03T00:00:00.000Z",
          content: "# Hello",
        }],
      },
      invalidationCallbacks: {
        evictCurrentAdapter: () => {
          evicted++;
        },
      },
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: {
            changedPaths: ["pages/index.mdx"],
            branchName: "main",
          },
        }),
      }),
    );

    assertEquals(runOnlyScheduledTimer(), 100);
    await flushMicrotasks();

    assertEquals(evicted, 1);

    manager.dispose();
  });

  it("awaits distributed CSS invalidation before reload, acknowledgement, and eviction", async () => {
    const events: string[] = [];
    const cssStarted = Promise.withResolvers<void>();
    const releaseCss = Promise.withResolvers<void>();
    const reloadTriggered = Promise.withResolvers<void>();
    const manager = createWebSocketManager({
      invalidationCallbacks: {
        clearProjectCSSCache: async () => {
          events.push("css:start");
          cssStarted.resolve();
          await releaseCss.promise;
          events.push("css:done");
        },
        triggerReload: () => {
          events.push("reload");
          reloadTriggered.resolve();
        },
        evictCurrentAdapter: () => events.push("evict"),
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    socket.send = () => events.push("ack");

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );
    assertEquals(runOnlyScheduledTimer(), 100);
    await cssStarted.promise;
    await flushMicrotasks();
    assertEquals(events, ["css:start"]);

    releaseCss.resolve();
    await reloadTriggered.promise;
    await flushMicrotasks();
    assertEquals(events, ["css:start", "css:done", "reload", "ack", "evict"]);
    manager.dispose();
  });

  it("does not finish an in-flight invalidation after the content context changes", async () => {
    const events: string[] = [];
    const cssStarted = Promise.withResolvers<void>();
    const releaseCss = Promise.withResolvers<void>();
    const manager = createWebSocketManager({
      invalidationCallbacks: {
        clearProjectCSSCache: async () => {
          events.push("css:start");
          cssStarted.resolve();
          await releaseCss.promise;
          events.push("css:done");
        },
        triggerReload: () => events.push("reload"),
        evictCurrentAdapter: () => events.push("evict"),
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    socket.send = () => events.push("ack");

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );
    assertEquals(runOnlyScheduledTimer(), 100);
    await cssStarted.promise;

    manager.onContentContextChanged();
    releaseCss.resolve();
    await flushMicrotasks();

    assertEquals(events, ["css:start", "css:done"]);
    assertEquals(getPendingInvalidationsCount(), 0);
    assertEquals(manager.getPokeMetrics().invalidationsTriggered, 0);
    manager.dispose();
  });

  it("does not evict for older invalidation work while a newer poke is pending", async () => {
    const firstCssGate = Promise.withResolvers<void>();
    const secondCssGate = Promise.withResolvers<void>();
    const cssGates = [firstCssGate, secondCssGate] as const;
    const firstCssStart = Promise.withResolvers<void>();
    const secondCssStart = Promise.withResolvers<void>();
    const cssStarts = [firstCssStart, secondCssStart] as const;
    let cssCalls = 0;
    let evictions = 0;
    const manager = createWebSocketManager({
      invalidationCallbacks: {
        clearProjectCSSCache: async () => {
          const call = cssCalls++;
          cssStarts[call]?.resolve();
          await cssGates[call]?.promise;
        },
        evictCurrentAdapter: () => {
          evictions++;
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    const poke = (path: string): void => {
      socket.onmessage?.call(
        socket as unknown as WebSocket,
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "poke",
            data: { changedPaths: [path], branchName: "main" },
          }),
        }),
      );
    };

    poke("app/first.tsx");
    assertEquals(runOnlyScheduledTimer(), 100);
    await firstCssStart.promise;

    poke("app/second.tsx");
    assertEquals(runOnlyScheduledTimer(), 100);
    await secondCssStart.promise;

    firstCssGate.resolve();
    await flushMicrotasks();
    assertEquals(evictions, 0);
    assertEquals(getPendingInvalidationsCount(), 1);

    secondCssGate.resolve();
    await flushMicrotasks();
    assertEquals(evictions, 1);
    assertEquals(getPendingInvalidationsCount(), 0);
    manager.dispose();
  });

  it("fails closed when distributed CSS invalidation rejects", async () => {
    let reloadCalls = 0;
    let evictionCalls = 0;
    const cssCalled = Promise.withResolvers<void>();
    const manager = createWebSocketManager({
      invalidationCallbacks: {
        clearProjectCSSCache: () => {
          cssCalled.resolve();
          return Promise.reject(new Error("distributed CSS unavailable"));
        },
        triggerReload: () => {
          reloadCalls++;
        },
        evictCurrentAdapter: () => {
          evictionCalls++;
        },
      },
    });
    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { changedPaths: ["app/page.tsx"], branchName: "main" },
        }),
      }),
    );
    assertEquals(runOnlyScheduledTimer(), 100);
    await cssCalled.promise;
    await flushMicrotasks();

    assertEquals(reloadCalls, 0);
    assertEquals(evictionCalls, 0);
    assertEquals(manager.getPokeMetrics().invalidationsTriggered, 0);
    manager.dispose();
  });
});
