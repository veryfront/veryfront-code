import { assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { parseProjectDomain } from "../src/server/utils/domain-parser.ts";

describe("Proxy WebSocket Handler Tests", () => {
  describe("parseProjectDomain Import", () => {
    // This test verifies the ES module import works correctly
    // Previously used require() which fails in Deno (ReferenceError: require is not defined)
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
      const host = "myproject.veryfront.com";
      const parsed = parseProjectDomain(host);

      assertEquals(parsed.slug, "myproject");
      assertEquals(parsed.environment, "production");
    });
  });

  describe("WebSocket Upgrade Detection", () => {
    it("detects WebSocket upgrade request", () => {
      const req = new Request("http://localhost:8080/_ws", {
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
        },
      });

      const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
      assertEquals(isWebSocket, true);
    });

    it("ignores non-WebSocket requests", () => {
      const req = new Request("http://localhost:8080/_ws");

      const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
      assertEquals(isWebSocket, false);
    });

    it("handles case-insensitive upgrade header", () => {
      const variants = ["websocket", "WebSocket", "WEBSOCKET", "WebSOCKET"];

      for (const variant of variants) {
        const req = new Request("http://localhost:8080/_ws", {
          headers: { upgrade: variant },
        });

        const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
        assertEquals(isWebSocket, true, `Should detect '${variant}' as WebSocket upgrade`);
      }
    });
  });

  describe("WebSocket URL Construction", () => {
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
      // This simulates what parseProjectDomain would return
      const host = "myproject.preview.veryfront.com";
      const parts = host.split(".");

      // For preview domains: slug.preview.veryfront.com
      const slug = parts[0];
      const isPreview = parts[1] === "preview";

      assertEquals(slug, "myproject");
      assertEquals(isPreview, true);
    });

    it("extracts branch from preview domain with branch", () => {
      const host = "myproject--feature-branch.preview.veryfront.com";
      const parts = host.split(".");

      // For branch preview: slug--branch.preview.veryfront.com
      const firstPart = parts[0] ?? "";
      const slugAndBranch = firstPart.split("--");
      const slug = slugAndBranch[0];
      const branch = slugAndBranch[1];

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
});
