import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isWebSocketUpgradeResponse } from "../../base.ts";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import {
  NODE_WEBSOCKET_UPGRADE_ID_HEADER,
  registerWebSocketUpgrade,
  rejectWebSocketUpgrade,
  resolveWebSocketUpgrade,
} from "./http-server.ts";
import { NodeServerAdapter, NodeWebSocket } from "./websocket-adapter.ts";
import type { WSWebSocket } from "./types.ts";

/**
 * Build a minimal EventEmitter-backed mock that satisfies the `WSWebSocket`
 * interface for the methods `_attachRealSocket` actually uses (`on`, `send`,
 * `close`). The underlying EventEmitter drives `emit("close", ...)` etc. in
 * tests, mirroring the real `ws` library's close-callback shape
 * `(code?: number, reason?: Buffer)`.
 */
function createMockWs(): WSWebSocket & EventEmitter {
  const ee = new EventEmitter() as EventEmitter & {
    send: (data: string | ArrayBuffer) => void;
    close: (code?: number, reason?: string) => void;
  };
  ee.send = () => {};
  ee.close = () => {};
  return ee as unknown as WSWebSocket & EventEmitter;
}

function attach(): { socket: NodeWebSocket; ws: WSWebSocket & EventEmitter } {
  const socket = new NodeWebSocket();
  const ws = createMockWs();
  socket._attachRealSocket(ws);
  return { socket, ws };
}

function websocketRequest(
  key = "dGhlIHNhbXBsZSBub25jZQ==",
  protocols?: string,
  transportId?: string,
): Request {
  return new Request("http://localhost/_ws", {
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": key,
      "sec-websocket-version": "13",
      ...(protocols ? { "sec-websocket-protocol": protocols } : {}),
      ...(transportId ? { [NODE_WEBSOCKET_UPGRADE_ID_HEADER]: transportId } : {}),
    },
  });
}

describe("NodeServerAdapter WebSocket upgrade", () => {
  it("returns an explicit non-DOM upgrade response signal", () => {
    const requestId = "dGhlIHNhbXBsZSBub25jZQ==";
    const adapter = new NodeServerAdapter();

    const { response } = adapter.upgradeWebSocket(websocketRequest(requestId));

    assertEquals(isWebSocketUpgradeResponse(response), true);
    assertEquals(response.status, 101);
    assertEquals(response.statusText, "Switching Protocols");
    assertEquals(response.headers.get("upgrade"), "websocket");
    assertEquals(response instanceof Response, false);

    assertEquals(resolveWebSocketUpgrade(requestId, createMockWs()), true);
  });

  it("uses the transport correlation id instead of the client handshake key", () => {
    const handshakeKey = "YWJjZGVmZ2hpamtsbW5vcA==";
    const transportId = "unique-transport-id";
    const adapter = new NodeServerAdapter();

    adapter.upgradeWebSocket(
      websocketRequest(handshakeKey, undefined, transportId),
    );

    assertEquals(resolveWebSocketUpgrade(handshakeKey, createMockWs()), false);
    assertEquals(resolveWebSocketUpgrade(transportId, createMockWs()), true);
  });

  it("selects exactly one offered protocol and preserves application headers", () => {
    const requestId = "MDEyMzQ1Njc4OWFiY2RlZg==";
    const adapter = new NodeServerAdapter();

    const { response } = adapter.upgradeWebSocket(
      websocketRequest(requestId, "chat, hmr"),
      {
        protocol: "hmr",
        headers: { "x-veryfront-handshake": "accepted" },
        idleTimeout: 0,
      },
    );

    assertEquals(response.headers.get("sec-websocket-protocol"), "hmr");
    assertEquals(response.headers.get("x-veryfront-handshake"), "accepted");
    assertEquals(resolveWebSocketUpgrade(requestId, createMockWs()), true);
  });

  it("does not silently select a client protocol when the application selected none", () => {
    const requestId = "YWJjZGVmZ2hpamtsbW5vcA==";
    const adapter = new NodeServerAdapter();

    const { response } = adapter.upgradeWebSocket(
      websocketRequest(requestId, "chat, hmr"),
    );

    assertEquals(response.headers.get("sec-websocket-protocol"), null);
    assertEquals(resolveWebSocketUpgrade(requestId, createMockWs()), true);
  });

  it("rejects malformed or unsupported upgrade options before registering transport state", () => {
    const adapter = new NodeServerAdapter();
    const request = websocketRequest(
      "MDEyMzQ1Njc4OWFiY2RlZg==",
      "chat, hmr",
    );

    assertThrows(
      () => adapter.upgradeWebSocket(request, { protocol: "not offered" }),
      Error,
      "valid HTTP token",
    );
    assertThrows(
      () => adapter.upgradeWebSocket(request, { protocol: "other" }),
      Error,
      "not offered",
    );
    assertThrows(
      () =>
        adapter.upgradeWebSocket(request, {
          headers: { Upgrade: "different" },
        }),
      Error,
      "manages the upgrade",
    );
    assertThrows(
      () => adapter.upgradeWebSocket(request, { idleTimeout: Number.NaN }),
      Error,
      "non-negative finite",
    );
    assertThrows(
      () => adapter.upgradeWebSocket(request, { idleTimeout: 30 }),
      Error,
      "does not support",
    );

    assertEquals(
      resolveWebSocketUpgrade("MDEyMzQ1Njc4OWFiY2RlZg==", createMockWs()),
      false,
    );
  });

  it("rejects a second upgrade of the same Request", () => {
    const requestId = "QUJDREVGR0hJSktMTU5PUA==";
    const adapter = new NodeServerAdapter();
    const request = websocketRequest(requestId);

    adapter.upgradeWebSocket(request);

    assertThrows(
      () => adapter.upgradeWebSocket(request),
      Error,
      "already been upgraded",
      "a Node Request must not be upgraded twice",
    );
    assertEquals(
      resolveWebSocketUpgrade(requestId, createMockWs()),
      true,
      "only the first upgrade may register pending transport state",
    );
    assertEquals(
      resolveWebSocketUpgrade(requestId, createMockWs()),
      false,
      "the rejected second upgrade must not leave a second pending registration",
    );
  });

  it("rejects requests that are not valid RFC 6455 handshakes", () => {
    const adapter = new NodeServerAdapter();

    assertThrows(
      () =>
        adapter.upgradeWebSocket(
          new Request("http://localhost/_ws", {
            headers: {
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              "sec-websocket-version": "13",
            },
          }),
        ),
      Error,
      "Upgrade: websocket",
    );
    assertThrows(
      () =>
        adapter.upgradeWebSocket(
          websocketRequest("not-a-valid-websocket-key"),
        ),
      Error,
      "Sec-WebSocket-Key",
    );
    assertThrows(
      () =>
        adapter.upgradeWebSocket(
          new Request("http://localhost/_ws", {
            headers: {
              connection: "Upgrade",
              upgrade: "websocket",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              "sec-websocket-version": "12",
            },
          }),
        ),
      Error,
      "Sec-WebSocket-Version",
    );
    assertThrows(
      () =>
        adapter.upgradeWebSocket(
          new Request("http://localhost/_ws", {
            headers: {
              upgrade: "websocket",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              "sec-websocket-version": "13",
            },
          }),
        ),
      Error,
      "Connection: Upgrade",
      "a handshake without a Connection: Upgrade token must be rejected",
    );
    assertThrows(
      () =>
        adapter.upgradeWebSocket(
          new Request("http://localhost/_ws", {
            headers: {
              connection: "keep-alive",
              upgrade: "websocket",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              "sec-websocket-version": "13",
            },
          }),
        ),
      Error,
      "Connection: Upgrade",
      "a Connection header without an upgrade token must be rejected",
    );
  });

  it("rejects duplicate pending ids without replacing the original owner", async () => {
    const requestId = "duplicate-upgrade-id";
    const original = registerWebSocketUpgrade(requestId);

    await assertRejects(
      () => registerWebSocketUpgrade(requestId),
      Error,
      "already pending",
    );
    const ws = createMockWs();
    assertEquals(resolveWebSocketUpgrade(requestId, ws), true);
    assertEquals(await original, ws);
  });

  it("explicitly rejects and removes an abandoned pending upgrade", async () => {
    const requestId = "abandoned-upgrade-id";
    const pending = registerWebSocketUpgrade(requestId);

    assertEquals(
      rejectWebSocketUpgrade(requestId, new Error("upgrade abandoned")),
      true,
    );
    await assertRejects(() => pending, Error, "upgrade abandoned");
    assertEquals(rejectWebSocketUpgrade(requestId, new Error("again")), false);
  });
});

describe("NodeWebSocket message handling", () => {
  it("decodes text frames as strings", () => {
    const { socket, ws } = attach();
    let received: unknown;
    socket.onmessage = (event) => {
      received = event.data;
    };

    ws.emit("message", Buffer.from("hello"), false);

    assertEquals(received, "hello");
  });

  it("preserves binary frames as exact ArrayBuffer copies", () => {
    const { socket, ws } = attach();
    let received: unknown;
    socket.onmessage = (event) => {
      received = event.data;
    };

    ws.emit(
      "message",
      [Buffer.from([0, 1]), Buffer.from([254, 255])],
      true,
    );

    assertEquals(received instanceof ArrayBuffer, true);
    assertEquals(
      [...new Uint8Array(received as ArrayBuffer)],
      [0, 1, 254, 255],
    );
  });
});

describe("NodeWebSocket close handling", () => {
  it("invokes onclose with a CloseEvent-shaped object on a clean close", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => {
      received = event;
    };

    ws.emit("close", 1000, Buffer.from("bye"));

    assertExists(received);
    const event = received as unknown as CloseEvent;
    assertEquals(event.type, "close");
    assertEquals(event.code, 1000);
    assertEquals(event.reason, "bye");
    assertEquals(event.wasClean, true);
  });

  it("defaults to code 1006 and wasClean=false when ws emits no arguments", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => {
      received = event;
    };

    ws.emit("close");

    assertExists(received);
    const event = received as unknown as CloseEvent;
    assertEquals(event.code, 1006);
    assertEquals(event.reason, "");
    assertEquals(event.wasClean, false);
  });

  it("treats any non-1006 code (e.g. 1001 going away) as clean", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => {
      received = event;
    };

    ws.emit("close", 1001, Buffer.from("going away"));

    const event = received as unknown as CloseEvent;
    assertEquals(event.code, 1001);
    assertEquals(event.reason, "going away");
    assertEquals(event.wasClean, true);
  });

  it("accepts a string reason in addition to a Buffer", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => {
      received = event;
    };

    ws.emit("close", 1000, "farewell");

    const event = received as unknown as CloseEvent;
    assertEquals(event.reason, "farewell");
    assertEquals(event.wasClean, true);
  });

  it("does not throw ReferenceError on close when CloseEvent is not a global", () => {
    // Regression test: Node <23 does not expose `CloseEvent` as a global. The
    // previous implementation used `new CloseEvent("close")`, which crashed
    // the dev server with an unhandled `ReferenceError` on every socket
    // teardown. The handler must build and deliver the close event itself.
    // The companion case in tests/integration/adapters covers the same path
    // with the global constructor removed.
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => {
      received = event;
    };

    ws.emit("close", 1000, Buffer.from("ok"));

    const event = received as unknown as CloseEvent;
    assertExists(event, "the close handler must run without throwing a ReferenceError");
    assertEquals(event.code, 1000, "the close code must reach the handler");
    assertEquals(event.reason, "ok", "the close reason must reach the handler");
    assertEquals(event.wasClean, true, "a 1000 close must be reported as clean");
  });

  it("transitions readyState to CLOSED after close", () => {
    const { socket, ws } = attach();
    socket.onclose = () => {};

    ws.emit("close", 1000, Buffer.from("ok"));

    assertEquals(socket.readyState, 3); // NodeWebSocket.CLOSED
  });

  it("is safe when onclose is not set (no listener attached)", () => {
    const { ws } = attach();
    // onclose left null — emitting should be a no-op, not a crash.
    ws.emit("close", 1000, Buffer.from("ok"));
  });
});

describe("NodeWebSocket error handling", () => {
  it("emits an ErrorEvent-shaped object without relying on the global constructor", () => {
    const socket = new NodeWebSocket();
    let received: ErrorEvent | null = null;
    socket.onerror = (event) => {
      received = event as ErrorEvent;
    };

    socket._emitError(new Error("transport failed"));

    assertExists(received);
    const event = received as unknown as ErrorEvent;
    assertEquals(event.type, "error");
    assertEquals(event.message, "transport failed");
    assertEquals(event.error instanceof Error, true);
    assertEquals(socket.readyState, NodeWebSocket.CLOSED);
    assertStrictEquals(
      Object.getPrototypeOf(event),
      Event.prototype,
      "the error event must be a plain Event so runtimes without a global ErrorEvent do not throw",
    );
  });
});

describe("NodeWebSocket EventTarget compatibility", () => {
  it("supports multiple listeners and removes only the matching callback", () => {
    const socket = new NodeWebSocket();
    const calls: string[] = [];
    const first = () => calls.push("first");
    const second = () => calls.push("second");
    socket.addEventListener("open", first);
    socket.addEventListener("open", second);
    socket.removeEventListener("open", first);

    socket._attachRealSocket(createMockWs());

    assertEquals(calls, ["second"]);
  });

  it("honors once and AbortSignal listener options", () => {
    const socket = new NodeWebSocket();
    const ws = createMockWs();
    let onceCalls = 0;
    let abortedCalls = 0;
    const controller = new AbortController();
    socket.addEventListener("message", () => onceCalls++, { once: true });
    socket.addEventListener("message", () => abortedCalls++, {
      signal: controller.signal,
    });
    controller.abort();
    socket._attachRealSocket(ws);

    ws.emit("message", Buffer.from("one"), false);
    ws.emit("message", Buffer.from("two"), false);

    assertEquals(onceCalls, 1);
    assertEquals(abortedCalls, 0);
  });

  it("honors close requested while the transport is still connecting", () => {
    const socket = new NodeWebSocket();
    const ws = createMockWs();
    const closeCalls: Array<[number | undefined, string | undefined]> = [];
    ws.close = (code?: number, reason?: string) => {
      closeCalls.push([code, reason]);
    };
    let openCalls = 0;
    socket.addEventListener("open", () => openCalls++);
    assertThrows(
      () => socket.send("before-open"),
      DOMException,
      "not open",
    );

    socket.close(1000, "done");
    socket._attachRealSocket(ws);

    assertEquals(socket.readyState, NodeWebSocket.CLOSING);
    assertEquals(closeCalls, [[1000, "done"]]);
    assertEquals(openCalls, 0);

    ws.emit("close", 1000, Buffer.from("done"));
    assertEquals(socket.readyState, NodeWebSocket.CLOSED);
  });
});
