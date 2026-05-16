import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
} from "#veryfront/utils";
import { getHmrWebSocketMessageSize, handleHmrClientMessage } from "./hmr-client-message.ts";

class MockSocket {
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }
}

describe("server/handlers/preview/hmr-client-message", () => {
  it("reports inbound WebSocket message size across supported payloads", () => {
    assertEquals(getHmrWebSocketMessageSize("ping"), 4);
    assertEquals(getHmrWebSocketMessageSize(new Uint8Array([1, 2, 3])), 3);
    assertEquals(getHmrWebSocketMessageSize(new ArrayBuffer(5)), 5);
    assertEquals(getHmrWebSocketMessageSize(new Blob(["hello"])), 5);
    assertEquals(getHmrWebSocketMessageSize({ type: "ping" }), 0);
  });

  it("responds to ping messages and records activity", () => {
    const socket = new MockSocket();
    let activityCount = 0;

    handleHmrClientMessage({
      socket,
      data: JSON.stringify({ type: "ping" }),
      rateLimiter: { check: () => true },
      onActivity: () => {
        activityCount += 1;
      },
    });

    assertEquals(socket.sent, [JSON.stringify({ type: "pong" })]);
    assertEquals(socket.closed, []);
    assertEquals(activityCount, 1);
  });

  it("closes oversized messages before rate limiting or activity updates", () => {
    const socket = new MockSocket();
    let checkedRateLimit = false;
    let activityCount = 0;

    handleHmrClientMessage({
      socket,
      data: "x".repeat(HMR_MAX_MESSAGE_SIZE_BYTES + 1),
      rateLimiter: {
        check: () => {
          checkedRateLimit = true;
          return true;
        },
      },
      onActivity: () => {
        activityCount += 1;
      },
    });

    assertEquals(socket.sent, []);
    assertEquals(socket.closed, [
      { code: HMR_CLOSE_MESSAGE_TOO_LARGE, reason: "Message too large" },
    ]);
    assertEquals(checkedRateLimit, false);
    assertEquals(activityCount, 0);
  });

  it("closes rate-limited messages before activity updates", () => {
    const socket = new MockSocket();
    let activityCount = 0;

    handleHmrClientMessage({
      socket,
      data: JSON.stringify({ type: "ping" }),
      rateLimiter: { check: () => false },
      onActivity: () => {
        activityCount += 1;
      },
    });

    assertEquals(socket.sent, []);
    assertEquals(socket.closed, [
      { code: HMR_CLOSE_RATE_LIMIT, reason: "Rate limit exceeded" },
    ]);
    assertEquals(activityCount, 0);
  });

  it("ignores malformed JSON after rate limiting and activity updates", () => {
    const socket = new MockSocket();
    let activityCount = 0;

    handleHmrClientMessage({
      socket,
      data: "{",
      rateLimiter: { check: () => true },
      onActivity: () => {
        activityCount += 1;
      },
    });

    assertEquals(socket.sent, []);
    assertEquals(socket.closed, []);
    assertEquals(activityCount, 1);
  });
});
