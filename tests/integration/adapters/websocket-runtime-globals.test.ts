/**
 * WebSocket runtime-global integration tests.
 *
 * These cases replace runtime globals (`WebSocketPair`, `CloseEvent`) to prove
 * the adapters behave correctly on hosts that do or do not provide them. The
 * global mutation is a host effect, so the cases live here instead of beside
 * the adapters they cover.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { CloudflareServerAdapter } from "#veryfront/platform/adapters/runtime/cloudflare/server.ts";
import type { CloudflareWebSocket } from "#veryfront/platform/adapters/runtime/cloudflare/types.ts";
import { NodeWebSocket } from "#veryfront/platform/adapters/runtime/node/websocket-adapter.ts";
import type { WSWebSocket } from "#veryfront/platform/adapters/runtime/node/types.ts";

function cloudflareWebSocketRequest(protocols?: string): Request {
  return new Request("https://example.com/socket", {
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      ...(protocols ? { "sec-websocket-protocol": protocols } : {}),
    },
  });
}

function createMockWs(): WSWebSocket & EventEmitter {
  const emitter = new EventEmitter() as EventEmitter & {
    send: (data: string | ArrayBuffer) => void;
    close: (code?: number, reason?: string) => void;
  };
  emitter.send = () => {};
  emitter.close = () => {};
  return emitter as unknown as WSWebSocket & EventEmitter;
}

describe("CloudflareServerAdapter with a host-provided WebSocketPair", () => {
  it("hands the application the accepted server half with a 101 handshake response", () => {
    let acceptCalls = 0;
    const clientHalf = { half: "client" } as unknown as CloudflareWebSocket;
    const serverHalf = {
      half: "server",
      accept() {
        acceptCalls++;
      },
    } as unknown as CloudflareWebSocket;
    const globalRecord = globalThis as Record<string, unknown>;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
    globalRecord.WebSocketPair = class {
      0 = clientHalf;
      1 = serverHalf;
    };

    try {
      const upgrade = new CloudflareServerAdapter().upgradeWebSocket(
        cloudflareWebSocketRequest("chat"),
        { protocol: "chat" },
      );

      assertStrictEquals(
        upgrade.socket,
        serverHalf,
        "the application must receive the server half of the pair",
      );
      assertEquals(acceptCalls, 1, "the server half must be accepted exactly once");
      assertEquals(
        upgrade.response.status,
        101,
        "the handshake must be reported as 101 Switching Protocols",
      );
      assertEquals(
        upgrade.response.headers.get("sec-websocket-protocol"),
        "chat",
        "the negotiated subprotocol must travel on the handshake response",
      );
    } finally {
      if (previous) Object.defineProperty(globalThis, "WebSocketPair", previous);
      else delete globalRecord.WebSocketPair;
    }
  });
});

describe("NodeWebSocket on a host without a global CloseEvent", () => {
  it("delivers a close event instead of throwing a ReferenceError", () => {
    // Regression test: Node <23 does not expose `CloseEvent` as a global. An
    // implementation that calls `new CloseEvent("close")` crashes the dev
    // server with an unhandled `ReferenceError` on every socket teardown.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "CloseEvent");
    Reflect.deleteProperty(globalThis, "CloseEvent");

    try {
      const socket = new NodeWebSocket();
      const ws = createMockWs();
      socket._attachRealSocket(ws);
      let received: CloseEvent | null = null;
      socket.onclose = (event) => {
        received = event;
      };

      ws.emit("close", 1000, Buffer.from("ok"));

      const event = received as unknown as CloseEvent;
      assertExists(event, "close must be delivered without a global CloseEvent constructor");
      assertEquals(event.code, 1000, "the close code must survive without a global CloseEvent");
      assertEquals(event.reason, "ok", "the close reason must survive without a global CloseEvent");
      assertEquals(event.wasClean, true, "a 1000 close must be reported as clean");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "CloseEvent", descriptor);
    }
  });
});
