import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import {
  authorizeWebSocketRequest,
  buildRendererBridgeRequest,
  closeBridgePeer,
  createProxyClientWebSocketUpgradeOptions,
  getClientWebSocketErrorLogLevel,
  getServerWebSocketErrorLogLevel,
} from "./websocket-bridge.ts";
import type { ProxyContext } from "./handler.ts";

function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

describe("Proxy WebSocket Handler Tests", () => {
  describe("parseProjectDomain Import", () => {
    it("parseProjectDomain is available as ES module import", () => {
      assertEquals(typeof parseProjectDomain, "function");
    });

    it("parses preview domain correctly for WebSocket context", () => {
      const host = "reliable-fermat-clkqh.preview.veryfront.com";
      const parsed = parseProjectDomain(host);

      assertEquals(parsed.slug, "reliable-fermat-clkqh");
      assertEquals(parsed.environment, "preview");
      assertEquals(parsed.isVeryfrontDomain, true);
    });

    it("parses production domain correctly for WebSocket context", () => {
      const host = "myproject.production.veryfront.com";
      const parsed = parseProjectDomain(host);

      assertEquals(parsed.slug, "myproject");
      assertEquals(parsed.environment, "production");
    });
  });

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

      assertEquals(isWebSocketUpgrade(req), true);
    });

    it("ignores non-WebSocket requests", () => {
      const req = new Request("http://localhost:8080/_ws");
      assertEquals(isWebSocketUpgrade(req), false);
    });

    it("handles case-insensitive upgrade header", () => {
      const variants = ["websocket", "WebSocket", "WEBSOCKET", "WebSOCKET"];

      for (const variant of variants) {
        const req = new Request("http://localhost:8080/_ws", {
          headers: { upgrade: variant },
        });

        assertEquals(
          isWebSocketUpgrade(req),
          true,
          `Should detect '${variant}' as WebSocket upgrade`,
        );
      }
    });
  });

  describe("Renderer bridge hop construction", () => {
    const BRIDGE_HOST = "support-agent-agodnc.preview.veryfront.com";

    function bridgeContext(): ProxyContext {
      return {
        token: "vf_proxy_minted_project_token",
        projectSlug: "support-agent-agodnc",
        projectId: "prj_01hzzz",
        environment: "preview",
        contentSourceId: "src_01hzzz",
        host: BRIDGE_HOST,
        parsedDomain: parseProjectDomain(BRIDGE_HOST),
        isLocalProject: false,
      };
    }

    it("converts the renderer hop to ws and keeps the path and benign query", () => {
      const req = new Request(`https://${BRIDGE_HOST}/_ws?foo=bar&x-project-slug=victim`);

      const bridge = buildRendererBridgeRequest(
        req,
        new URL(req.url),
        bridgeContext(),
        "http://veryfront-server",
      );

      assertEquals(
        bridge.url.toString(),
        "ws://veryfront-server/_ws?foo=bar",
        "the bridge hop must convert http to ws and preserve path and benign query while dropping browser-named identity",
      );
    });

    it("reaches an https renderer over wss", () => {
      const req = new Request(`https://${BRIDGE_HOST}/_ws`);

      const bridge = buildRendererBridgeRequest(
        req,
        new URL(req.url),
        bridgeContext(),
        "https://renderer.example.com",
      );

      assertEquals(
        bridge.url.protocol,
        "wss:",
        "an https renderer must be reached over wss",
      );
    });
  });

  describe("WebSocket State Management", () => {
    it("WebSocket readyState constants are correct", () => {
      assertEquals(WebSocket.CONNECTING, 0);
      assertEquals(WebSocket.OPEN, 1);
      assertEquals(WebSocket.CLOSING, 2);
      assertEquals(WebSocket.CLOSED, 3);
    });
  });

  describe("Server WebSocket error handling", () => {
    it("treats upstream EOF as a transient warning", () => {
      assertEquals(
        getServerWebSocketErrorLogLevel("Unexpected EOF"),
        "warn",
        "an upstream EOF is a routine bridge teardown, not an alertable failure",
      );
    });

    it("treats browser-side EOF and ping timeouts as transient warnings", () => {
      assertEquals(
        getClientWebSocketErrorLogLevel("Unexpected EOF"),
        "warn",
        "a browser-side EOF is a routine bridge teardown, not an alertable failure",
      );
      assertEquals(
        getClientWebSocketErrorLogLevel("No response from ping frame."),
        "warn",
        "a missed heartbeat is a routine bridge teardown, not an alertable failure",
      );
    });

    it("keeps non-transient bridge failures at error level", () => {
      assertEquals(
        getServerWebSocketErrorLogLevel("connection refused"),
        "error",
        "non-transient upstream failures must stay at error level",
      );
      assertEquals(
        getServerWebSocketErrorLogLevel("invalid peer certificate: UnknownIssuer"),
        "error",
        "TLS failures must stay at error level",
      );
      assertEquals(
        getClientWebSocketErrorLogLevel("error sending frame"),
        "error",
        "non-transient browser-side failures must stay at error level",
      );
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
