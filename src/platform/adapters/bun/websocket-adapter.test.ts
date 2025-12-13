import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertThrows } from "std/assert/mod.ts";
import { BunServerAdapter, BunWebSocket } from "./websocket-adapter.ts";

describe("platform/adapters/bun/websocket-adapter", () => {
  describe("BunServerAdapter", () => {
    it("should have upgradeWebSocket method", () => {
      const adapter = new BunServerAdapter();
      assert(typeof adapter.upgradeWebSocket === "function", "upgradeWebSocket should be a function");
    });

    it("should implement ServerAdapter interface", () => {
      const adapter = new BunServerAdapter();
      assert(typeof adapter.upgradeWebSocket === "function");
    });
  });

  describe("BunWebSocket", () => {
    it("should have correct initial readyState", () => {
      const socket = new BunWebSocket();
      assertEquals(socket.readyState, 1, "readyState should be 1 (OPEN)");
    });

    it("should have WebSocket constants", () => {
      assertEquals(BunWebSocket.CONNECTING, 0);
      assertEquals(BunWebSocket.OPEN, 1);
      assertEquals(BunWebSocket.CLOSING, 2);
      assertEquals(BunWebSocket.CLOSED, 3);
    });

    it("should have event handlers properties", () => {
      const socket = new BunWebSocket();
      assertEquals(socket.onopen, null);
      assertEquals(socket.onclose, null);
      assertEquals(socket.onerror, null);
      assertEquals(socket.onmessage, null);
    });

    it("should allow setting event handlers", () => {
      const socket = new BunWebSocket();
      const handler = () => {};

      socket.onopen = handler;
      socket.onclose = handler;
      socket.onerror = handler;
      socket.onmessage = handler as any;

      assertEquals(socket.onopen, handler);
      assertEquals(socket.onclose, handler);
      assertEquals(socket.onerror, handler);
      assertEquals(socket.onmessage, handler);
    });

    it("should have send method", () => {
      const socket = new BunWebSocket();
      assert(typeof socket.send === "function", "send should be a function");
    });

    it("should throw error when send is called", () => {
      const socket = new BunWebSocket();
      assertThrows(
        () => socket.send("test"),
        Error,
        "WebSocket send called on placeholder",
      );
    });

    it("should have close method", () => {
      const socket = new BunWebSocket();
      assert(typeof socket.close === "function", "close should be a function");
    });

    it("should update readyState when closed", () => {
      const socket = new BunWebSocket();
      assertEquals(socket.readyState, 1);

      socket.close();
      assertEquals(socket.readyState, 3, "readyState should be 3 (CLOSED)");
    });

    it("close should accept optional code and reason", () => {
      const socket = new BunWebSocket();
      socket.close(1000, "Normal closure");
      assertEquals(socket.readyState, 3);
    });
  });
});
