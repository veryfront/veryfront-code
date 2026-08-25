import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isWebSocketUpgrade,
  resolveDenoUpgradeWebSocketOptions,
  upgradeWebSocket,
} from "./websocket.ts";

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
      assertThrows(
        () => upgradeWebSocket(new Request("http://localhost/ws")),
        Error,
        "requires an Upgrade: websocket request",
        "a request without Upgrade: websocket must be rejected",
      );
    });

    it("passes idleTimeout through to Deno upgrade options", () => {
      assertEquals(resolveDenoUpgradeWebSocketOptions({ idleTimeout: 0 }), { idleTimeout: 0 });
      assertEquals(resolveDenoUpgradeWebSocketOptions({ protocol: "hmr", idleTimeout: 60 }), {
        protocol: "hmr",
        idleTimeout: 60,
      });
    });

    it("rejects invalid Deno idle timeouts before native coercion", () => {
      assertThrows(
        () => resolveDenoUpgradeWebSocketOptions({ idleTimeout: Number.NaN }),
        Error,
        "non-negative finite number",
      );
      assertThrows(
        () => resolveDenoUpgradeWebSocketOptions({ idleTimeout: -1 }),
        Error,
        "non-negative finite number",
      );
    });

    it("rejects response headers that Deno cannot apply", () => {
      assertThrows(
        () =>
          resolveDenoUpgradeWebSocketOptions({
            headers: { "X-Application-Header": "value" },
          }),
        Error,
        "does not support custom WebSocket response headers",
      );
    });
  });
});
