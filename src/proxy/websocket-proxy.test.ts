import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  authorizeWebSocketRequest,
  closeBridgePeer,
  createProxyClientWebSocketUpgradeOptions,
  getClientWebSocketErrorLogLevel,
  getServerWebSocketErrorLogLevel,
  isProxyWebSocketUpgrade,
} from "./websocket-bridge.ts";
import type { ProxyContext } from "./handler.ts";

describe("Proxy WebSocket Handler Tests", () => {
  describe("WebSocket Upgrade Detection", () => {
    it("uses the normal proxy authorization result before upgrading", async () => {
      const req = new Request("https://project.example/_ws", {
        headers: { upgrade: "websocket" },
      });
      const context = {
        error: { status: 401, message: "Authentication required" },
      } as ProxyContext;

      const result = await authorizeWebSocketRequest(
        req,
        new URL(req.url),
        () => Promise.resolve(context),
      );

      assertEquals(result, {
        allowed: false,
        error: { status: 401, message: "Authentication required" },
      });
    });

    it("detects WebSocket upgrade request", () => {
      const req = new Request("http://localhost:8080/_ws", {
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
        },
      });

      assertEquals(isProxyWebSocketUpgrade(req), true);
    });

    it("ignores non-WebSocket requests", () => {
      const req = new Request("http://localhost:8080/_ws");
      assertEquals(isProxyWebSocketUpgrade(req), false);
    });

    it("handles case-insensitive upgrade header", () => {
      const variants = ["websocket", "WebSocket", "WEBSOCKET", "WebSOCKET"];

      for (const variant of variants) {
        const req = new Request("http://localhost:8080/_ws", {
          headers: { upgrade: variant },
        });

        assertEquals(
          isProxyWebSocketUpgrade(req),
          true,
          `Should detect '${variant}' as WebSocket upgrade`,
        );
      }
    });
  });

  describe("Server WebSocket error handling", () => {
    it("treats upstream EOF as a transient warning", () => {
      assertEquals(getServerWebSocketErrorLogLevel("Unexpected EOF"), "warn");
    });

    it("treats browser-side EOF and ping timeouts as transient warnings", () => {
      assertEquals(getClientWebSocketErrorLogLevel("Unexpected EOF"), "warn");
      assertEquals(getClientWebSocketErrorLogLevel("No response from ping frame."), "warn");
    });

    it("closes the accepted client socket when the upstream bridge fails", () => {
      const calls: Array<{ code?: number; reason?: string }> = [];
      const socket = {
        readyState: WebSocket.OPEN,
        close(code?: number, reason?: string) {
          calls.push({ code, reason });
        },
      };

      closeBridgePeer(socket, 1011, "Server connection error");

      assertEquals(calls, [{ code: 1011, reason: "Server connection error" }]);
    });
  });

  describe("Proxy client WebSocket upgrade options", () => {
    it("disables Deno transport idle timeout for proxied browser sockets", () => {
      assertEquals(createProxyClientWebSocketUpgradeOptions(), { idleTimeout: 0 });
    });
  });
});
