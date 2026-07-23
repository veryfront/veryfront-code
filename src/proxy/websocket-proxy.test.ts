import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import {
  authorizeWebSocketRequest,
  closeBridgePeer,
  createProxyClientWebSocketUpgradeOptions,
  createUpstreamWebSocketUrl,
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

  describe("WebSocket URL Construction", () => {
    it("builds a normalized upstream URL and replaces trusted routing parameters", () => {
      const target = createUpstreamWebSocketUrl(
        "https://renderer.example.test/base",
        new URL(
          "https://project.example.test/_ws?x-project-slug=attacker&x-environment=production&foo=bar",
        ),
        "trusted-project",
        "preview",
      );

      assertEquals(target.protocol, "wss:");
      assertEquals(target.pathname, "/_ws");
      assertEquals(target.searchParams.get("x-project-slug"), "trusted-project");
      assertEquals(target.searchParams.get("x-environment"), "preview");
      assertEquals(target.searchParams.get("foo"), "bar");
    });

    it("converts HTTP to WS URL", () => {
      const rendererUrl = "http://localhost:3001";
      const wsUrl = rendererUrl.replace(/^http/, "ws");

      assertEquals(wsUrl, "ws://localhost:3001");
    });

    it("converts HTTPS to WSS URL", () => {
      const rendererUrl = "https://renderer.example.com";
      const wsUrl = rendererUrl.replace(/^http/, "ws");

      assertEquals(wsUrl, "wss://renderer.example.com");
    });

    it("preserves path in WebSocket URL", () => {
      const rendererUrl = "http://localhost:3001";
      const path = "/_ws";
      const query = "?foo=bar";
      const targetUrl = `${rendererUrl.replace(/^http/, "ws")}${path}${query}`;

      assertEquals(targetUrl, "ws://localhost:3001/_ws?foo=bar");
    });
  });

  describe("WebSocket Query Parameters", () => {
    it("adds project slug as query parameter", () => {
      const baseUrl = new URL("ws://localhost:3001/_ws");
      const projectSlug = "my-project";

      baseUrl.searchParams.set("x-project-slug", projectSlug);

      assertEquals(baseUrl.searchParams.get("x-project-slug"), "my-project");
    });

    it("adds environment as query parameter", () => {
      const baseUrl = new URL("ws://localhost:3001/_ws");
      const environment = "preview";

      baseUrl.searchParams.set("x-environment", environment);

      assertEquals(baseUrl.searchParams.get("x-environment"), "preview");
    });

    it("handles empty project slug", () => {
      const baseUrl = new URL("ws://localhost:3001/_ws");

      baseUrl.searchParams.set("x-project-slug", "");

      assertEquals(baseUrl.searchParams.get("x-project-slug"), "");
    });
  });

  describe("Domain Parsing for WebSocket", () => {
    it("extracts project slug from preview domain", () => {
      const host = "myproject.preview.veryfront.com";
      const [slug, env] = host.split(".");

      assertEquals(slug, "myproject");
      assertEquals(env === "preview", true);
    });

    it("extracts branch from preview domain with branch", () => {
      const host = "myproject--feature-branch.preview.veryfront.com";
      const [firstPart = ""] = host.split(".");
      const [slug, branch] = firstPart.split("--");

      assertEquals(slug, "myproject");
      assertEquals(branch, "feature-branch");
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

    it("normalizes reserved codes, bounds UTF-8 reasons, and contains close failures", () => {
      const calls: Array<{ code?: number; reason?: string }> = [];
      const socket = {
        readyState: WebSocket.CONNECTING,
        close(code?: number, reason?: string) {
          calls.push({ code, reason });
        },
      };

      closeBridgePeer(socket, 1006, "🙂".repeat(100));
      assertEquals(calls[0]?.code, 1011);
      assertEquals(new TextEncoder().encode(calls[0]?.reason ?? "").byteLength <= 123, true);

      closeBridgePeer(
        {
          readyState: WebSocket.OPEN,
          close() {
            throw new Error("already closed");
          },
        },
        1011,
        "failure",
      );
    });
  });

  describe("Proxy client WebSocket upgrade options", () => {
    it("disables Deno transport idle timeout for proxied browser sockets", () => {
      assertEquals(createProxyClientWebSocketUpgradeOptions(), { idleTimeout: 0 });
    });
  });
});
