import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isWebSocketUpgrade } from "./websocket.ts";

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
  });
});
