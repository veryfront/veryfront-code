import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HMR_CLOSE_MESSAGE_TOO_LARGE, HMR_CLOSE_NORMAL } from "#veryfront/utils";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";
import { closeAllConnections, setupWebSocketHandlers } from "./websocket-handler.ts";

class MockWebSocket {
  readyState: number = WebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  emitCloseOnClose = false;
  private readonly listeners = new Map<string, Set<EventListener>>();

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    if (this.emitCloseOnClose) this.emitClose();
  }

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitClose(): void {
    this.readyState = WebSocket.CLOSED;
    const event = new Event("close");
    for (const listener of this.listeners.get("close") ?? []) {
      listener.call(this as unknown as EventTarget, event);
    }
    this.onclose?.(event as CloseEvent);
  }
}

function asWebSocket(socket: MockWebSocket): WebSocket {
  return socket as unknown as WebSocket;
}

function createContext(maxMessageSize: number): {
  context: WebSocketContext;
  checks: { value: number };
  cleanups: WebSocket[];
} {
  const checks = { value: 0 };
  const cleanups: WebSocket[] = [];
  return {
    context: {
      clients: new Set<WebSocket>(),
      maxMessageSize,
      rateLimiter: {
        check() {
          checks.value++;
          return true;
        },
        cleanup(socket) {
          cleanups.push(socket);
        },
      },
    },
    checks,
    cleanups,
  };
}

describe("modules/server/websocket-handler", () => {
  it("enforces the UTF-8 byte boundary before rate limiting", () => {
    const socket = new MockWebSocket();
    const { context, checks } = createContext(4);
    setupWebSocketHandlers(asWebSocket(socket), context);

    socket.emitMessage("ééé");

    assertEquals(socket.closed, [
      { code: HMR_CLOSE_MESSAGE_TOO_LARGE, reason: "Message too large" },
    ]);
    assertEquals(checks.value, 0);
  });

  it("enforces the byte boundary for Blob payloads", () => {
    const socket = new MockWebSocket();
    const { context, checks } = createContext(2);
    setupWebSocketHandlers(asWebSocket(socket), context);

    socket.emitMessage(new Blob(["abc"]));

    assertEquals(socket.closed, [
      { code: HMR_CLOSE_MESSAGE_TOO_LARGE, reason: "Message too large" },
    ]);
    assertEquals(checks.value, 0);
  });

  it("rejects invalid message-size configuration before retaining the socket", () => {
    const socket = new MockWebSocket();
    const { context } = createContext(Number.NaN);

    assertThrows(
      () => setupWebSocketHandlers(asWebSocket(socket), context),
      RangeError,
      "maxMessageSize",
    );
    assertEquals(context.clients.size, 0);
  });

  it("waits for close events and cleans every captured client", async () => {
    const first = new MockWebSocket();
    const second = new MockWebSocket();
    first.emitCloseOnClose = true;
    second.emitCloseOnClose = true;
    const firstSocket = asWebSocket(first);
    const secondSocket = asWebSocket(second);
    const clients = new Set([firstSocket, secondSocket]);
    const cleaned: WebSocket[] = [];

    await closeAllConnections(
      clients,
      { cleanup: (socket) => cleaned.push(socket) },
      { timeoutMs: 1_000 },
    );

    assertEquals(first.closed, [
      { code: HMR_CLOSE_NORMAL, reason: "Server shutting down" },
    ]);
    assertEquals(second.closed, [
      { code: HMR_CLOSE_NORMAL, reason: "Server shutting down" },
    ]);
    assertEquals(cleaned, [firstSocket, secondSocket]);
    assertEquals(clients.size, 0);
  });

  it("bounds shutdown when a peer never completes its close handshake", async () => {
    const socket = new MockWebSocket();
    const webSocket = asWebSocket(socket);
    const clients = new Set([webSocket]);
    const cleaned: WebSocket[] = [];

    await closeAllConnections(
      clients,
      { cleanup: (client) => cleaned.push(client) },
      { timeoutMs: 1 },
    );

    assertEquals(cleaned, [webSocket]);
    assertEquals(clients.size, 0);
  });

  it("validates the close timeout before mutating client state", async () => {
    const socket = new MockWebSocket();
    const clients = new Set([asWebSocket(socket)]);

    await assertRejects(
      () => closeAllConnections(clients, { cleanup() {} }, { timeoutMs: -1 }),
      RangeError,
      "timeoutMs",
    );
    assertEquals(socket.closed, []);
    assertEquals(clients.size, 1);
  });
});
