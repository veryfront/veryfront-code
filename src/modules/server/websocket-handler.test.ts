import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HMR_CLOSE_MESSAGE_TOO_LARGE, HMR_CLOSE_RATE_LIMIT } from "#veryfront/utils";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";
import { setupWebSocketHandlers } from "./websocket-handler.ts";

/**
 * Stands in for a peer that never completes the close handshake, so the
 * server cannot rely on `onclose` to release the connection's state.
 */
class StallingWebSocket {
  readyState: number = WebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitClose(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }
}

function createContext(maxMessageSize: number, rateLimitOk = true): {
  context: WebSocketContext;
  cleanups: WebSocket[];
  checks: WebSocket[];
} {
  const cleanups: WebSocket[] = [];
  const checks: WebSocket[] = [];
  return {
    context: {
      clients: new Set<WebSocket>(),
      maxMessageSize,
      rateLimiter: {
        check: (socket) => {
          checks.push(socket);
          return rateLimitOk;
        },
        cleanup: (socket) => {
          cleanups.push(socket);
        },
      },
    },
    cleanups,
    checks,
  };
}

describe("modules/server/websocket-handler", () => {
  it("deregisters a client closed for an oversized message without awaiting the handshake", () => {
    const { context, cleanups } = createContext(8);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);
    assertEquals(context.clients.size, 1);

    socket.emitMessage("x".repeat(64));

    assertEquals(socket.closed, [{
      code: HMR_CLOSE_MESSAGE_TOO_LARGE,
      reason: "Message too large",
    }]);
    assertEquals(context.clients.size, 0);
    assertEquals(cleanups.length, 1);
  });

  it("counts a Blob message at its real byte size when enforcing the limit", () => {
    const { context, cleanups } = createContext(8);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.emitMessage(new Blob([new Uint8Array(64)]));

    assertEquals(socket.closed, [{
      code: HMR_CLOSE_MESSAGE_TOO_LARGE,
      reason: "Message too large",
    }]);
    assertEquals(context.clients.size, 0);
    assertEquals(cleanups.length, 1);
  });

  it("accepts a string whose UTF-8 wire size is exactly the limit", () => {
    const { context, checks } = createContext(8);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.emitMessage("éééé");

    assertEquals(socket.closed, []);
    assertEquals(checks, [socket as unknown as WebSocket]);
    assertEquals(context.clients.size, 1);
  });

  it("deregisters a rate-limited client without awaiting the handshake", () => {
    const { context, cleanups } = createContext(1024, false);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);
    assertEquals(context.clients.size, 1);

    socket.emitMessage("ping");

    assertEquals(socket.closed, [{
      code: HMR_CLOSE_RATE_LIMIT,
      reason: "Rate limit exceeded",
    }]);
    assertEquals(context.clients.size, 0);
    assertEquals(cleanups.length, 1);
  });

  it("deregisters a client whose socket errors without a close event", () => {
    const { context, cleanups, checks } = createContext(1024);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);
    assertEquals(context.clients.size, 1);

    socket.emitError();

    assertEquals(context.clients.size, 0, "an errored socket must be deregistered eagerly");
    assertEquals(
      cleanups,
      [socket as unknown as WebSocket],
      "an errored socket must release its rate-limit entry",
    );

    socket.emitMessage(JSON.stringify({ type: "ping" }));
    assertEquals(checks, [], "messages after an error must be ignored");
  });

  it("stays consistent when a late close event arrives after eager cleanup", () => {
    const { context, cleanups } = createContext(8);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.emitMessage("x".repeat(64));
    socket.emitClose();

    assertEquals(context.clients.size, 0);
    assertEquals(cleanups, [socket as unknown as WebSocket]);
  });

  it("ignores messages that arrive after eager cleanup", () => {
    const { context, cleanups, checks } = createContext(8);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.emitMessage("x".repeat(64));
    socket.emitMessage(JSON.stringify({ type: "ping" }));

    assertEquals(context.clients.size, 0);
    assertEquals(cleanups, [socket as unknown as WebSocket]);
    assertEquals(checks, []);
    assertEquals(socket.closed.length, 1);
    assertEquals(socket.sent.includes(JSON.stringify({ type: "pong" })), false);
  });

  it("keeps a well-behaved client registered until it disconnects", () => {
    const { context } = createContext(1024);
    const socket = new StallingWebSocket();
    setupWebSocketHandlers(socket as unknown as WebSocket, context);

    socket.emitMessage(JSON.stringify({ type: "ping" }));

    assertEquals(socket.closed.length, 0);
    assertEquals(context.clients.size, 1);
    assertEquals(socket.sent.includes(JSON.stringify({ type: "pong" })), true);

    socket.emitClose();
    assertEquals(context.clients.size, 0);
  });
});
