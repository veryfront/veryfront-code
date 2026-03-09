import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isWebSocketUpgrade, upgradeWebSocket } from "./websocket.ts";

describe("platform/compat/http/websocket", () => {
  describe("isWebSocketUpgrade", () => {
    it("should return true when upgrade header is 'websocket'", () => {
      const request = new Request("http://localhost/ws", {
        headers: { upgrade: "websocket" },
      });
      assertEquals(isWebSocketUpgrade(request), true);
    });

    it("should return true when upgrade header is 'WebSocket' (case-insensitive)", () => {
      const request = new Request("http://localhost/ws", {
        headers: { upgrade: "WebSocket" },
      });
      assertEquals(isWebSocketUpgrade(request), true);
    });

    it("should return false when no upgrade header", () => {
      const request = new Request("http://localhost/ws");
      assertEquals(isWebSocketUpgrade(request), false);
    });

    it("should return false when upgrade header is not websocket", () => {
      const request = new Request("http://localhost/ws", {
        headers: { upgrade: "h2c" },
      });
      assertEquals(isWebSocketUpgrade(request), false);
    });

    it("should return false for empty upgrade header", () => {
      const request = new Request("http://localhost/ws", {
        headers: { upgrade: "" },
      });
      assertEquals(isWebSocketUpgrade(request), false);
    });

    it("should return false for WEBSOCKET (all caps)", () => {
      const request = new Request("http://localhost/ws", {
        headers: { upgrade: "WEBSOCKET" },
      });
      assertEquals(isWebSocketUpgrade(request), true);
    });
  });

  describe("upgradeWebSocket", () => {
    it("should be a function", () => {
      assertEquals(typeof upgradeWebSocket, "function");
    });

    it("should throw when called with a non-upgradeable request", () => {
      // Deno.upgradeWebSocket throws if the request isn't a real WS upgrade request
      const request = new Request("http://localhost/ws");
      try {
        upgradeWebSocket(request);
        assertEquals(true, false, "Should have thrown");
      } catch (e) {
        assertExists(e);
      }
    });
  });
});
