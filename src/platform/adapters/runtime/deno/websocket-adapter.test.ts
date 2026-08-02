import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { DenoServerAdapter } from "./websocket-adapter.ts";

function websocketRequest(protocols?: string): Request {
  return new Request("http://localhost/_ws", {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
      ...(protocols === undefined ? {} : { "Sec-WebSocket-Protocol": protocols }),
    },
  });
}

if (isDeno) {
  describe("Deno WebSocket adapter", () => {
    it("selects one explicitly offered protocol and accepts native timeouts", () => {
      const upgrade = new DenoServerAdapter().upgradeWebSocket(
        websocketRequest("chat, hmr"),
        { protocol: "hmr", idleTimeout: 60 },
      );
      try {
        assertEquals(
          upgrade.response.headers.get("sec-websocket-protocol"),
          "hmr",
        );
      } finally {
        upgrade.socket.close();
      }
    });

    it("rejects custom response headers instead of silently dropping them", () => {
      assertThrows(
        () =>
          new DenoServerAdapter().upgradeWebSocket(websocketRequest(), {
            headers: { "X-Application-Header": "value" },
          }),
        Error,
        "does not support custom WebSocket response headers",
      );
    });

    it("rejects invalid idle timeout values before native coercion", () => {
      assertThrows(
        () =>
          new DenoServerAdapter().upgradeWebSocket(websocketRequest(), {
            idleTimeout: Number.POSITIVE_INFINITY,
          }),
        Error,
        "non-negative finite number",
      );
      assertThrows(
        () =>
          new DenoServerAdapter().upgradeWebSocket(websocketRequest(), {
            idleTimeout: -1,
          }),
        Error,
        "non-negative finite number",
      );
    });

    it("rejects an unoffered or malformed protocol selection", () => {
      assertThrows(
        () =>
          new DenoServerAdapter().upgradeWebSocket(
            websocketRequest("chat"),
            { protocol: "hmr" },
          ),
        Error,
        "was not offered",
      );
      assertThrows(
        () =>
          new DenoServerAdapter().upgradeWebSocket(
            websocketRequest("chat, chat"),
            { protocol: "chat" },
          ),
        Error,
        "invalid Sec-WebSocket-Protocol",
      );
    });

    it("rejects duplicate upgrades of the same Request", () => {
      const adapter = new DenoServerAdapter();
      const request = websocketRequest();
      const first = adapter.upgradeWebSocket(request);
      try {
        assertThrows(
          () => adapter.upgradeWebSocket(request),
          Error,
          "already been upgraded",
        );
      } finally {
        first.socket.close();
      }
    });
  });
}
