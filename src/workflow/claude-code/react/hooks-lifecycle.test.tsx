import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useClaudeCodeStream, type UseClaudeCodeStreamState } from "./use-claude-code-stream.ts";
import {
  useClaudeCodeWebSocket,
  type UseClaudeCodeWebSocketActions,
  type UseClaudeCodeWebSocketState,
} from "./use-claude-code-websocket.ts";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static readonly instances: MockEventSource[] = [];

  readyState = MockEventSource.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

interface InstalledDom {
  root: Root;
  restore(): void;
}

function installDom(): InstalledDom {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "Event",
    "MessageEvent",
    "CloseEvent",
    "WebSocket",
    "EventSource",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const replacements: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    self: dom.window,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MessageEvent: dom.window.MessageEvent,
    CloseEvent: dom.window.CloseEvent,
    WebSocket: MockWebSocket,
    EventSource: MockEventSource,
  };
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: replacements[key],
    });
  }
  MockWebSocket.instances.length = 0;
  MockEventSource.instances.length = 0;

  const rootElement = document.getElementById("root");
  assert(rootElement, "root element exists");
  const root = createRoot(rootElement);
  return {
    root,
    restore(): void {
      for (const key of keys) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

async function settle(delay = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  flushSync(() => {});
}

type WebSocketHookResult = UseClaudeCodeWebSocketState & UseClaudeCodeWebSocketActions;
let webSocketResult: WebSocketHookResult | null = null;
let webSocketDisconnectVersions: number[] = [];
let webSocketEventVersions: number[] = [];
let throwOnWebSocketDisconnect = false;
let connectOnWebSocketDisconnect = false;

function WebSocketProbe({
  callbackVersion,
  runId = "run-1",
  maxReconnectAttempts = 5,
  pingInterval = 0,
}: {
  callbackVersion: number;
  runId?: string;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}): React.ReactElement {
  webSocketResult = useClaudeCodeWebSocket({
    url: "wss://example.com/workflows",
    runId,
    autoReconnect: true,
    maxReconnectAttempts,
    reconnectDelay: 1,
    pingInterval,
    onEvent: () => {
      webSocketEventVersions.push(callbackVersion);
    },
    onDisconnect: () => {
      webSocketDisconnectVersions.push(callbackVersion);
      if (throwOnWebSocketDisconnect) throw new Error("consumer callback failed");
      if (connectOnWebSocketDisconnect) webSocketResult?.connect();
    },
  });
  return <div />;
}

type StreamHookResult = UseClaudeCodeStreamState & {
  connect(): void;
  disconnect(): void;
};
let streamResult: StreamHookResult | null = null;
let streamDisconnectVersions: number[] = [];
let streamEventVersions: number[] = [];

function StreamProbe({
  callbackVersion,
  runId = "run-1",
  maxReconnectAttempts = 5,
}: {
  callbackVersion: number;
  runId?: string;
  maxReconnectAttempts?: number;
}): React.ReactElement {
  streamResult = useClaudeCodeStream({
    url: "https://example.com/workflows/stream",
    runId,
    autoReconnect: true,
    maxReconnectAttempts,
    reconnectDelay: 1,
    onEvent: () => {
      streamEventVersions.push(callbackVersion);
    },
    onDisconnect: () => streamDisconnectVersions.push(callbackVersion),
  });
  return <div />;
}

describe("workflow/claude-code/react connection lifecycle", () => {
  it("does not reconnect WebSockets for callback rerenders or explicit disconnect", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} />));
      await settle();
      assertEquals(MockWebSocket.instances.length, 1);

      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={2} />));
      await settle();
      assertEquals(MockWebSocket.instances.length, 1);
      MockWebSocket.instances[0]!.emitMessage(
        JSON.stringify({ type: "text_complete", timestamp: 1, content: "latest" }),
      );
      await settle();
      assertEquals(webSocketEventVersions, [2]);

      const result = webSocketResult;
      assert(result, "hook result is available");
      flushSync(() => result.disconnect());
      await settle(10);
      assertEquals(MockWebSocket.instances.length, 1);
      assertEquals(webSocketDisconnectVersions, [2]);

      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("ignores stale SSE errors after disconnect and callback-only rerenders", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<StreamProbe callbackVersion={1} />));
      await settle();
      assertEquals(MockEventSource.instances.length, 1);
      const firstSource = MockEventSource.instances[0]!;

      flushSync(() => installed.root.render(<StreamProbe callbackVersion={2} />));
      await settle();
      assertEquals(MockEventSource.instances.length, 1);

      const result = streamResult;
      assert(result, "hook result is available");
      flushSync(() => result.disconnect());
      firstSource.onerror?.(new Event("error"));
      await settle(10);
      assertEquals(MockEventSource.instances.length, 1);
      assertEquals(streamDisconnectVersions, [2]);

      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      streamResult = null;
      streamDisconnectVersions = [];
      streamEventVersions = [];
    }
  });

  it("reconnects once after the current WebSocket closes remotely", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} />));
      await settle();
      const firstSocket = MockWebSocket.instances[0]!;

      firstSocket.close();
      await settle(10);

      assertEquals(MockWebSocket.instances.length, 2);
      assertEquals(webSocketDisconnectVersions, [1]);
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("closes native SSE recovery and reconnects once through the owned lifecycle", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<StreamProbe callbackVersion={1} />));
      await settle();
      const firstSource = MockEventSource.instances[0]!;

      firstSource.onerror?.(new Event("error"));
      await settle(10);

      assertEquals(firstSource.readyState, MockEventSource.CLOSED);
      assertEquals(MockEventSource.instances.length, 2);
      assertEquals(streamDisconnectVersions, [1]);
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      streamResult = null;
      streamDisconnectVersions = [];
      streamEventVersions = [];
    }
  });

  it("contains disconnect callback failures and still reconnects once", async () => {
    const installed = installDom();
    try {
      throwOnWebSocketDisconnect = true;
      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} />));
      await settle();

      try {
        MockWebSocket.instances[0]!.close();
      } catch {
        // The lifecycle must contain consumer callback failures.
      }
      await settle(10);

      assertEquals(MockWebSocket.instances.length, 2);
      assertEquals(webSocketDisconnectVersions, [1]);
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("resets SSE event state when the connection identity changes", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<StreamProbe callbackVersion={1} runId="run-1" />));
      await settle();
      flushSync(() =>
        MockEventSource.instances[0]!.emitMessage(
          JSON.stringify({ type: "text_complete", timestamp: 1, content: "old run" }),
        )
      );
      await settle();
      assertEquals(streamResult?.text, "old run");

      flushSync(() => installed.root.render(<StreamProbe callbackVersion={1} runId="run-2" />));
      await settle();

      assertEquals(MockEventSource.instances.length, 2);
      assertEquals(streamResult?.text, "");
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      streamResult = null;
      streamDisconnectVersions = [];
      streamEventVersions = [];
    }
  });

  it("resets WebSocket interactive state when the connection identity changes", async () => {
    const installed = installDom();
    try {
      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} runId="run-1" />));
      await settle();
      flushSync(() =>
        MockWebSocket.instances[0]!.emitMessage(
          JSON.stringify({
            type: "approval_request",
            timestamp: 1,
            toolCallId: "tool-1",
            toolName: "write_file",
            input: {},
            reason: "Changes a file",
          }),
        )
      );
      await settle();
      assertEquals(webSocketResult?.pendingApprovals.length, 1);

      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} runId="run-2" />));
      await settle();

      assertEquals(MockWebSocket.instances.length, 2);
      assertEquals(webSocketResult?.pendingApprovals, []);
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("refreshes the WebSocket retry budget for an explicit connect", async () => {
    const installed = installDom();
    try {
      flushSync(() =>
        installed.root.render(
          <WebSocketProbe callbackVersion={1} maxReconnectAttempts={1} />,
        )
      );
      await settle();

      MockWebSocket.instances[0]!.close();
      await settle(10);
      assertEquals(MockWebSocket.instances.length, 2);

      MockWebSocket.instances[1]!.close();
      await settle(10);
      assertEquals(MockWebSocket.instances.length, 2);

      const result = webSocketResult;
      assert(result, "hook result is available");
      flushSync(() => result.connect());
      assertEquals(MockWebSocket.instances.length, 3);

      MockWebSocket.instances[2]!.close();
      await settle(10);
      assertEquals(MockWebSocket.instances.length, 4);

      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("refreshes the SSE retry budget for an explicit connect", async () => {
    const installed = installDom();
    try {
      flushSync(() =>
        installed.root.render(
          <StreamProbe callbackVersion={1} maxReconnectAttempts={1} />,
        )
      );
      await settle();

      MockEventSource.instances[0]!.onerror?.(new Event("error"));
      await settle(10);
      assertEquals(MockEventSource.instances.length, 2);

      MockEventSource.instances[1]!.onerror?.(new Event("error"));
      await settle(10);
      assertEquals(MockEventSource.instances.length, 2);

      const result = streamResult;
      assert(result, "hook result is available");
      flushSync(() => result.connect());
      assertEquals(MockEventSource.instances.length, 3);

      MockEventSource.instances[2]!.onerror?.(new Event("error"));
      await settle(10);
      assertEquals(MockEventSource.instances.length, 4);

      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      streamResult = null;
      streamDisconnectVersions = [];
      streamEventVersions = [];
    }
  });

  it("lets a disconnect callback replace an owned reconnect timer", async () => {
    const installed = installDom();
    try {
      connectOnWebSocketDisconnect = true;
      flushSync(() => installed.root.render(<WebSocketProbe callbackVersion={1} />));
      await settle();

      MockWebSocket.instances[0]!.close();
      await settle(10);

      assertEquals(MockWebSocket.instances.length, 2);
      assertEquals(webSocketDisconnectVersions, [1]);

      connectOnWebSocketDisconnect = false;
      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });

  it("stops the previous generation ping timer after a manual reconnect", async () => {
    const installed = installDom();
    try {
      flushSync(() =>
        installed.root.render(<WebSocketProbe callbackVersion={1} pingInterval={1} />)
      );
      await settle();
      const firstSocket = MockWebSocket.instances[0]!;
      firstSocket.emitOpen();
      await settle(5);
      assert(firstSocket.sent.length > 0, "first socket receives pings");

      const result = webSocketResult;
      assert(result, "hook result is available");
      flushSync(() => result.connect());
      const firstSocketMessageCount = firstSocket.sent.length;
      const secondSocket = MockWebSocket.instances[1]!;
      secondSocket.emitOpen();
      await settle(5);

      assertEquals(firstSocket.sent.length, firstSocketMessageCount);
      assert(secondSocket.sent.length > 0, "replacement socket receives pings");

      flushSync(() => installed.root.unmount());
    } finally {
      installed.restore();
      webSocketResult = null;
      webSocketDisconnectVersions = [];
      webSocketEventVersions = [];
      throwOnWebSocketDisconnect = false;
      connectOnWebSocketDisconnect = false;
    }
  });
});
