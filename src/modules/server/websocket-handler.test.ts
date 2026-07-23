import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HMR_CLOSE_MESSAGE_TOO_LARGE, HMR_CLOSE_NORMAL } from "#veryfront/utils";
import { closeAllConnections, setupWebSocketHandlers } from "./websocket-handler.ts";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";

class MockSocket {
  readyState = WebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
  }
}

function createContext(maxMessageSize: number): {
  context: WebSocketContext;
  cleaned: MockSocket[];
} {
  const cleaned: MockSocket[] = [];
  return {
    context: {
      clients: new Set<WebSocket>(),
      maxMessageSize,
      reactRefresh: true,
      rateLimiter: {
        check: () => true,
        cleanup: (socket) => cleaned.push(socket as unknown as MockSocket),
      },
    },
    cleaned,
  };
}

describe("modules/server/websocket-handler", () => {
  it("counts string messages by UTF-8 bytes", () => {
    const socket = new MockSocket();
    const { context, cleaned } = createContext(3);
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.onmessage?.(new MessageEvent("message", { data: "😀" }));

    assertEquals(socket.closed, [
      { code: HMR_CLOSE_MESSAGE_TOO_LARGE, reason: "Message too large" },
    ]);
    assertEquals(context.clients.has(socket as unknown as WebSocket), false);
    assertEquals(cleaned, [socket]);
  });

  it("counts Blob payload bytes and responds to valid pings", () => {
    const socket = new MockSocket();
    const { context } = createContext(4);
    setupWebSocketHandlers(socket as unknown as WebSocket, context);
    socket.sent.length = 0;

    socket.onmessage?.(new MessageEvent("message", { data: new Blob(["hello"]) }));
    assertEquals(socket.closed[0]?.code, HMR_CLOSE_MESSAGE_TOO_LARGE);

    const pingSocket = new MockSocket();
    const pingContext = createContext(100).context;
    setupWebSocketHandlers(pingSocket as unknown as WebSocket, pingContext);
    pingSocket.sent.length = 0;
    pingSocket.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify({ type: "ping" }) }),
    );
    assertEquals(pingSocket.sent, [JSON.stringify({ type: "pong" })]);
  });

  it("ignores messages after the connection is closed", () => {
    const socket = new MockSocket();
    const { context } = createContext(30);
    setupWebSocketHandlers(socket as unknown as WebSocket, context);
    socket.sent.length = 0;

    socket.onmessage?.(new MessageEvent("message", { data: new Blob(["x".repeat(31)]) }));
    socket.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify({ type: "ping" }) }),
    );

    assertEquals(socket.sent, []);
  });

  it("closes the socket after an error", () => {
    const socket = new MockSocket();
    const { context, cleaned } = createContext(100);
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.onerror?.(new Event("error"));

    assertEquals(socket.closed, [{ code: 1011, reason: "WebSocket error" }]);
    assertEquals(cleaned, [socket]);
    assertEquals(context.clients.size, 0);
  });

  it("rejects invalid message limits", () => {
    const socket = new MockSocket();
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      const { context } = createContext(limit);
      assertThrows(
        () => setupWebSocketHandlers(socket as unknown as WebSocket, context),
        RangeError,
      );
    }
  });

  it("closes and cleans all connections without a fixed delay", async () => {
    const first = new MockSocket();
    const second = new MockSocket();
    const clients = new Set<WebSocket>([
      first as unknown as WebSocket,
      second as unknown as WebSocket,
    ]);
    const cleaned: WebSocket[] = [];
    const startedAt = performance.now();

    await closeAllConnections(clients, { cleanup: (socket) => cleaned.push(socket) });

    assertEquals(performance.now() - startedAt < 100, true);
    assertEquals(first.closed[0]?.code, HMR_CLOSE_NORMAL);
    assertEquals(second.closed[0]?.code, HMR_CLOSE_NORMAL);
    assertEquals(cleaned.length, 2);
    assertEquals(clients.size, 0);
  });
});
