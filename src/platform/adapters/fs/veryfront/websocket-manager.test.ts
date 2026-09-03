import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { InvalidationCallbacks } from "./types.ts";
import { WebSocketManager } from "./websocket-manager.ts";
import {
  buildReloadProjectContext,
  getReconnectDelay,
  parsePokeWebSocketMessage,
} from "./websocket-manager-helpers.ts";
import { __resetLoggerConfigForTests } from "#veryfront/utils/logger/logger.ts";

interface TimerEntry {
  delay: number;
  callback: () => void;
}

function makeProjectFile(path: string, content: string): ProjectFile {
  return {
    path,
    content,
    type: "page",
    size: content.length,
    updated_at: "2026-08-17T00:00:00.000Z",
  };
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

function deliverPoke(socket: MockWebSocket, data: Record<string, unknown>): void {
  socket.onmessage?.call(
    socket as unknown as WebSocket,
    new MessageEvent("message", { data: JSON.stringify({ type: "poke", data }) }),
  );
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
  /** Branch this preview is pinned to; `null` previews the default branch. */
  branch?: string | null;
  client?: Partial<VeryfrontApiClient>;
  invalidationCallbacks?: InvalidationCallbacks;
  pregenerateStyles?: (
    files: Array<{ path: string; content?: string }>,
  ) => Promise<{ hash: string; assetPath: string } | undefined>;
  clearMemoryCaches?: () => void;
  getSourceSnapshotVersion?: () => number;
  replaceSourceSnapshot?: (
    cacheKey: string,
    files: Array<{ path: string; content?: string }>,
    expectedSnapshotVersion?: number,
  ) => Promise<number | undefined>;
} = {}): WebSocketManager {
  const cache = {
    deleteByPrefixAsync: async () => 0,
    deleteByPrefixAndSuffixAsync: async () => 0,
  } as unknown as FileCache;

  const client = {
    getProjectId: () => "project-1",
    listAllFiles: async () => [],
    ...options.client,
  } as unknown as VeryfrontApiClient;

  const invalidationCallbacks: InvalidationCallbacks = options.invalidationCallbacks ?? {};
  const branch = options.branch === null ? undefined : options.branch ?? "main";

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
      branch,
    }),
    getContentSource: () => ({ type: "branch", branch }),
    getProjectDir: () => undefined,
    clearMemoryCaches: options.clearMemoryCaches ?? (() => {}),
    getSourceSnapshotVersion: options.getSourceSnapshotVersion,
    replaceSourceSnapshot: options.replaceSourceSnapshot ?? (async () => 0),
    pregenerateStyles: options.pregenerateStyles,
    createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
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

    it("does not log malformed WebSocket payload content", () => {
      const sentinel = "VF_MALFORMED_WS_PAYLOAD_MUST_NOT_REACH_LOGS_4b8e";
      const warnCapture = captureConsoleMethod("warn");

      try {
        withJsonLogFormat(() => {
          assertEquals(parsePokeWebSocketMessage(`{${sentinel}`), null);
        });
        assertEquals(warnCapture.getOutput().includes(sentinel), false);
      } finally {
        warnCapture.restore();
      }
    });
  });
  let originalWebSocket: typeof WebSocket;
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;
  let originalSetInterval: typeof setInterval;
  let heartbeatCallback: (() => void) | undefined;
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
    MockWebSocket.instances = [];
    nextTimerId = 1;
    scheduledTimers = new Map<ReturnType<typeof setTimeout>, TimerEntry>();

    originalWebSocket = globalThis.WebSocket;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    originalSetInterval = globalThis.setInterval;
    heartbeatCallback = undefined;

    globalThis.setInterval = ((handler: TimerHandler): ReturnType<typeof setInterval> => {
      heartbeatCallback = typeof handler === "function" ? handler as () => void : () => {};
      return 999 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;

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
    globalThis.setInterval = originalSetInterval;
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

  it("closes and replaces a socket whose pong is older than the heartbeat timeout", () => {
    const manager = createWebSocketManager();
    manager.connect("project-1");

    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    socket.onopen?.call(socket as unknown as WebSocket, new Event("open"));

    const runHeartbeat = heartbeatCallback;
    assertExists(runHeartbeat, "connecting must arm the heartbeat interval");

    (manager as unknown as { wsLastPong: number }).wsLastPong = Date.now() - (300_000 + 1);
    runHeartbeat();

    assertEquals(
      socket.onclose,
      null,
      "onclose is detached before closing so it cannot double-reconnect",
    );
    assertEquals(socket.readyState, MockWebSocket.CLOSED, "the dead socket is closed");
    assertEquals(
      MockWebSocket.instances.length,
      2,
      "exactly one replacement socket is opened",
    );

    manager.dispose();
  });

  it("does not log fields from valid WebSocket poke payloads", () => {
    const sentinel = "VF_WS_PAYLOAD_MUST_NOT_REACH_LOGS_38c1";
    const originalMethods = {
      debug: console.debug,
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
    };
    console.debug = capture;
    console.log = capture;
    console.warn = capture;
    console.error = capture;

    try {
      withJsonLogFormat(() => {
        const manager = createWebSocketManager();
        manager.connect("project-1");
        const socket = MockWebSocket.instances[0];
        assertExists(socket);

        socket.onmessage?.call(
          socket as unknown as WebSocket,
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "poke",
              data: {
                changedPaths: [`pages/${sentinel}.tsx`],
                entityId: sentinel,
                entityType: sentinel,
                action: sentinel,
                branchId: sentinel,
                branchName: "main",
                releaseId: sentinel,
                environmentName: sentinel,
              },
            }),
          }),
        );
        manager.dispose();
      });

      assertEquals(output.join("\n").includes(sentinel), false);
    } finally {
      console.debug = originalMethods.debug;
      console.log = originalMethods.log;
      console.warn = originalMethods.warn;
      console.error = originalMethods.error;
    }
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
          project_id?: string;
          context?: {
            delayMs?: number;
            consecutiveFailures?: number;
            projectId?: string;
            url?: string;
          };
        };
        assertEquals(closeEntry.message, "WebSocket reconnect scheduled after close");
        assertEquals(closeEntry.projectSlug, "test-project");
        assertEquals(closeEntry.project_id, "project-1");
        assertEquals(closeEntry.context?.projectId, "project-1");
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
          project_id?: string;
          context?: {
            consecutiveFailures?: number;
            projectId?: string;
          };
        };
        assertEquals(recoveryEntry.message, "WebSocket reconnect recovered");
        assertEquals(recoveryEntry.projectSlug, "test-project");
        assertEquals(recoveryEntry.project_id, "project-1");
        assertEquals(recoveryEntry.context?.projectId, "project-1");
        assertEquals(recoveryEntry.context?.consecutiveFailures, 1);

        warnCapture.reset();
        socket.onerror?.call(socket as unknown as WebSocket, new Event("error"));

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
      replaceSourceSnapshot: async () => 0,
      createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
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

  it("uses the latest API token when opening a WebSocket", () => {
    const manager = createWebSocketManager();

    manager.connect("project-1");
    let socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    assertEquals(socket.protocols, ["bearer-test-token"]);

    manager.setApiToken("fresh-request-token");
    socket.emitClose();

    runOnlyScheduledTimer();

    socket = MockWebSocket.instances.at(-1);
    assertExists(socket);
    assertEquals(socket.protocols, ["bearer-fresh-request-token"]);

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
      replaceSourceSnapshot: async () => 0,
      createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
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
      replaceSourceSnapshot: async () => 0,
      createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
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
      replaceSourceSnapshot: async () => 0,
      createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
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
      replaceSourceSnapshot: async () => 0,
      createWebSocket: (url, protocols) => new globalThis.WebSocket(url, protocols),
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances.at(-1);
    assertExists(socket);

    // IPv6 loopback should stay as ws://
    assertEquals(socket.url.startsWith("ws://"), true);

    manager.dispose();
  });

  it("ignores pokes scoped to a different branch", () => {
    let clearCalls = 0;
    let reloadCalls = 0;
    const manager = createWebSocketManager({
      branch: "feature-x",
      clearMemoryCaches: () => {
        clearCalls++;
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

    deliverPoke(socket, { changedPaths: ["app/page.tsx"], branchName: "main" });

    assertEquals(clearCalls, 0, "a poke for another branch must not flush the preview caches");
    assertEquals(reloadCalls, 0, "a poke for another branch must not republish a reload");

    manager.dispose();
  });

  it("ignores branchId-only pokes on the default-branch preview", () => {
    let clearCalls = 0;
    let reloadCalls = 0;
    const manager = createWebSocketManager({
      branch: null,
      clearMemoryCaches: () => {
        clearCalls++;
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

    deliverPoke(socket, { changedPaths: ["app/page.tsx"], branchId: "br-1" });

    assertEquals(
      clearCalls,
      0,
      "a branchId-only poke must not flush the default-branch preview caches",
    );
    assertEquals(reloadCalls, 0, "a branchId-only poke must not republish a reload");

    manager.dispose();
  });

  it("ignores unscoped pokes while previewing a named branch", () => {
    let clearCalls = 0;
    let reloadCalls = 0;
    const manager = createWebSocketManager({
      branch: "feature-x",
      clearMemoryCaches: () => {
        clearCalls++;
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

    deliverPoke(socket, { changedPaths: ["app/page.tsx"] });

    assertEquals(
      clearCalls,
      0,
      "an unscoped poke targets the default branch, not a named branch preview",
    );
    assertEquals(reloadCalls, 0, "an unscoped poke must not republish a reload on a named branch");

    manager.dispose();
  });

  it("accepts a poke scoped to the previewed branch", () => {
    let clearCalls = 0;
    const manager = createWebSocketManager({
      branch: "feature-x",
      clearMemoryCaches: () => {
        clearCalls++;
      },
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);

    deliverPoke(socket, { changedPaths: ["app/page.tsx"], branchName: "feature-x" });

    assertEquals(clearCalls, 1, "a poke for the previewed branch must flush the preview caches");

    manager.dispose();
  });

  it("includes pregenerated preview stylesheet metadata in reload callbacks", async () => {
    let capturedProject: InvalidationCallbacks extends {
      triggerReload?: (changedPaths?: string[], project?: infer T) => void;
    } ? T | undefined
      : never;
    let capturedChangedPaths: string[] | undefined;
    const styleEvents: string[] = [];

    const manager = createWebSocketManager({
      client: {
        listAllFiles: async () => [{
          path: "app/page.tsx",
          type: "page",
          size: 32,
          updated_at: "2026-03-22T00:00:00.000Z",
          content: "<div class='text-red-500'/>",
        }],
      },
      invalidationCallbacks: {
        clearProjectCSSCache: () => {
          styleEvents.push("invalidate");
        },
        triggerReload: (changedPaths, project) => {
          capturedChangedPaths = changedPaths;
          capturedProject = project;
        },
      },
      replaceSourceSnapshot: () => {
        styleEvents.push("replace-snapshot");
        return Promise.resolve(1);
      },
      pregenerateStyles: async () => {
        styleEvents.push("pregenerate");
        return {
          hash: "hash-1",
          assetPath: "/_vf/css/hash-1.css",
        };
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
    // The CSS caches are dropped once, after the new source snapshot is
    // installed: clearing before that would only drop entries a concurrent
    // request can refill from the snapshot the poke is replacing.
    assertEquals(styleEvents, [
      "replace-snapshot",
      "invalidate",
      "pregenerate",
    ]);

    manager.dispose();
  });

  it("passes the pre-fetch source generation to selective snapshot replacement", async () => {
    const fetchStarted = Promise.withResolvers<void>();
    const releaseFetch = Promise.withResolvers<ProjectFile[]>();
    let sourceSnapshotVersion = 1;
    let replacementVersion: number | undefined;
    const manager = createWebSocketManager({
      client: {
        listAllFiles: () => {
          fetchStarted.resolve();
          return releaseFetch.promise;
        },
      },
      clearMemoryCaches: () => {
        sourceSnapshotVersion++;
      },
      getSourceSnapshotVersion: () => sourceSnapshotVersion,
      replaceSourceSnapshot: (_cacheKey, _files, expectedSnapshotVersion) => {
        replacementVersion = expectedSnapshotVersion;
        return Promise.resolve(
          expectedSnapshotVersion === sourceSnapshotVersion ? sourceSnapshotVersion : undefined,
        );
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
    await fetchStarted.promise;
    sourceSnapshotVersion++;
    releaseFetch.resolve([makeProjectFile("app/page.tsx", "v1")]);
    await flushMicrotasks();

    assertEquals(
      replacementVersion,
      2,
      "replacement must receive the generation captured before the file-list fetch",
    );
    manager.dispose();
  });

  it("does not pregenerate styles for a superseded selective snapshot", async () => {
    const fetchStarted = Promise.withResolvers<void>();
    const releaseFetch = Promise.withResolvers<ProjectFile[]>();
    let sourceSnapshotVersion = 1;
    let pregenerateCalls = 0;
    let publishedStyleHash: string | undefined;
    let reloadCalls = 0;
    const manager = createWebSocketManager({
      client: {
        listAllFiles: () => {
          fetchStarted.resolve();
          return releaseFetch.promise;
        },
      },
      clearMemoryCaches: () => {
        sourceSnapshotVersion++;
      },
      getSourceSnapshotVersion: () => sourceSnapshotVersion,
      replaceSourceSnapshot: (_cacheKey, _files, expectedSnapshotVersion) =>
        Promise.resolve(
          expectedSnapshotVersion === sourceSnapshotVersion ? sourceSnapshotVersion : undefined,
        ),
      pregenerateStyles: () => {
        pregenerateCalls++;
        return Promise.resolve({
          hash: "stale-hash",
          assetPath: "/_vf/css/stale-hash.css",
        });
      },
      invalidationCallbacks: {
        triggerReload: (_changedPaths, project) => {
          reloadCalls++;
          publishedStyleHash = project?.styleArtifactHash;
        },
      },
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    const poke = () =>
      socket.onmessage?.call(
        socket as unknown as WebSocket,
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "poke",
            data: { changedPaths: ["app/page.tsx"], branchName: "main" },
          }),
        }),
      );

    poke();
    assertEquals(runOnlyScheduledTimer(), 100);
    await fetchStarted.promise;
    poke();
    releaseFetch.resolve([makeProjectFile("app/page.tsx", "v1")]);
    await flushMicrotasks();

    assertEquals(pregenerateCalls, 0);
    assertEquals(publishedStyleHash, undefined);
    assertEquals(reloadCalls, 0, "a rejected selective snapshot must not publish a reload");
    manager.dispose();
  });

  it("does not publish styles superseded during selective pregeneration", async () => {
    const pregenerationStarted = Promise.withResolvers<void>();
    const releasePregeneration = Promise.withResolvers<{
      hash: string;
      assetPath: string;
    }>();
    let sourceSnapshotVersion = 1;
    let publishedStyleHash: string | undefined;
    let reloadCalls = 0;
    let evictCalls = 0;
    const manager = createWebSocketManager({
      client: {
        listAllFiles: () => Promise.resolve([makeProjectFile("app/page.tsx", "v1")]),
      },
      clearMemoryCaches: () => {
        sourceSnapshotVersion++;
      },
      getSourceSnapshotVersion: () => sourceSnapshotVersion,
      replaceSourceSnapshot: () => {
        sourceSnapshotVersion++;
        return Promise.resolve(sourceSnapshotVersion);
      },
      pregenerateStyles: () => {
        pregenerationStarted.resolve();
        return releasePregeneration.promise;
      },
      invalidationCallbacks: {
        triggerReload: (_changedPaths, project) => {
          reloadCalls++;
          publishedStyleHash = project?.styleArtifactHash;
        },
        evictCurrentAdapter: () => {
          evictCalls++;
          manager.dispose();
        },
      },
    });

    manager.connect("project-1");
    const socket = MockWebSocket.instances[0];
    assertExists(socket);
    const poke = () =>
      socket.onmessage?.call(
        socket as unknown as WebSocket,
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "poke",
            data: { changedPaths: ["app/page.tsx"], branchName: "main" },
          }),
        }),
      );

    poke();
    assertEquals(runOnlyScheduledTimer(), 100);
    await pregenerationStarted.promise;
    poke();
    releasePregeneration.resolve({
      hash: "stale-hash",
      assetPath: "/_vf/css/stale-hash.css",
    });
    await flushMicrotasks();

    assertEquals(publishedStyleHash, undefined);
    assertEquals(reloadCalls, 0, "a superseded selective invalidation must not publish a reload");
    assertEquals(evictCalls, 0, "a superseded invalidation must not cancel the newer poke");

    assertEquals(
      runOnlyScheduledTimer(),
      100,
      "the newer selective invalidation must remain queued",
    );
    await flushMicrotasks();
    assertEquals(reloadCalls, 1, "the newer selective invalidation must publish its reload");
    assertEquals(evictCalls, 1, "the adapter may be evicted after the newer invalidation succeeds");
  });

  it("discards full styles superseded during pregeneration", async () => {
    const fetchStarted = Promise.withResolvers<void>();
    const releaseFetch = Promise.withResolvers<ProjectFile[]>();
    const pregenerationStarted = Promise.withResolvers<void>();
    const releasePregeneration = Promise.withResolvers<{
      hash: string;
      assetPath: string;
    }>();
    let sourceSnapshotVersion = 1;
    let replacementVersion: number | undefined;
    let pregenerateCalls = 0;
    let publishedStyleHash: string | undefined;
    let reloadCalls = 0;
    let evictCalls = 0;
    const manager = createWebSocketManager({
      client: {
        listAllFiles: () => {
          fetchStarted.resolve();
          return releaseFetch.promise;
        },
      },
      clearMemoryCaches: () => {
        sourceSnapshotVersion++;
      },
      getSourceSnapshotVersion: () => sourceSnapshotVersion,
      replaceSourceSnapshot: (_cacheKey, _files, expectedSnapshotVersion) => {
        replacementVersion = expectedSnapshotVersion;
        if (expectedSnapshotVersion !== sourceSnapshotVersion) {
          return Promise.resolve(undefined);
        }
        sourceSnapshotVersion++;
        return Promise.resolve(sourceSnapshotVersion);
      },
      pregenerateStyles: () => {
        pregenerateCalls++;
        pregenerationStarted.resolve();
        return releasePregeneration.promise;
      },
      invalidationCallbacks: {
        triggerReload: (_changedPaths, project) => {
          reloadCalls++;
          publishedStyleHash = project?.styleArtifactHash;
        },
        evictCurrentAdapter: () => {
          evictCalls++;
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
    await fetchStarted.promise;
    releaseFetch.resolve([makeProjectFile("app/page.tsx", "v1")]);
    await pregenerationStarted.promise;
    socket.onmessage?.call(
      socket as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "poke",
          data: { branchName: "main" },
        }),
      }),
    );
    releasePregeneration.resolve({
      hash: "stale-hash",
      assetPath: "/_vf/css/stale-hash.css",
    });
    await flushMicrotasks();

    assertEquals(
      replacementVersion,
      3,
      "replacement must receive the generation captured after the full invalidation clear",
    );
    assertEquals(pregenerateCalls, 1);
    assertEquals(publishedStyleHash, undefined);
    assertEquals(reloadCalls, 0, "a superseded full invalidation must not publish a reload");
    assertEquals(evictCalls, 0, "a superseded full invalidation must preserve the newer poke");
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
});
