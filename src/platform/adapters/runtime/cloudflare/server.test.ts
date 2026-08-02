import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareServerAdapter, resolveCloudflareWebSocketUpgradeHeaders } from "./server.ts";

function websocketRequest(protocols?: string): Request {
  return new Request("https://example.com/socket", {
    headers: {
      upgrade: "websocket",
      ...(protocols ? { "sec-websocket-protocol": protocols } : {}),
    },
  });
}

describe("CloudflareServerAdapter WebSocket handshake", () => {
  it("rejects non-WebSocket requests before constructing a runtime pair", () => {
    assertThrows(
      () => resolveCloudflareWebSocketUpgradeHeaders(new Request("https://example.com")),
      Error,
      "Upgrade: websocket",
    );
  });

  it("selects only a protocol offered by the client", () => {
    const headers = resolveCloudflareWebSocketUpgradeHeaders(
      websocketRequest("chat, hmr"),
      { protocol: "hmr" },
    );

    assertEquals(headers.get("sec-websocket-protocol"), "hmr");
    assertThrows(
      () =>
        resolveCloudflareWebSocketUpgradeHeaders(
          websocketRequest("chat"),
          { protocol: "hmr" },
        ),
      Error,
      "not offered",
    );
  });

  it("preserves application headers but rejects runtime-managed handshake headers", () => {
    const headers = resolveCloudflareWebSocketUpgradeHeaders(
      websocketRequest(),
      { headers: { "x-request-id": "request-1" } },
    );

    assertEquals(headers.get("x-request-id"), "request-1");
    assertThrows(
      () =>
        resolveCloudflareWebSocketUpgradeHeaders(websocketRequest(), {
          headers: { Upgrade: "websocket" },
        }),
      Error,
      "manages the upgrade",
    );
  });

  it("accepts the portable no-timeout sentinel and fails closed for unsupported timeouts", () => {
    resolveCloudflareWebSocketUpgradeHeaders(websocketRequest(), { idleTimeout: 0 });

    assertThrows(
      () => resolveCloudflareWebSocketUpgradeHeaders(websocketRequest(), { idleTimeout: 30 }),
      Error,
      "application-level heartbeats",
    );
    assertThrows(
      () =>
        resolveCloudflareWebSocketUpgradeHeaders(websocketRequest(), {
          idleTimeout: Number.NaN,
        }),
      Error,
      "non-negative finite",
    );
  });

  it("reports a structured runtime error when WebSocketPair is unavailable", () => {
    assertThrows(
      () => new CloudflareServerAdapter().upgradeWebSocket(websocketRequest()),
      Error,
      "WebSocketPair is not available",
    );
  });
});
