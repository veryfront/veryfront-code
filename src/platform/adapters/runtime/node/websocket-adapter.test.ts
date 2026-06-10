import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isWebSocketUpgradeResponse } from "../../base.ts";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { resolveWebSocketUpgrade } from "./http-server.ts";
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

describe("NodeServerAdapter WebSocket upgrade", () => {
  it("returns an explicit non-DOM upgrade response signal", () => {
    const requestId = "dGhlIHNhbXBsZSBub25jZQ==";
    const adapter = new NodeServerAdapter();

    const { response } = adapter.upgradeWebSocket(
      new Request("http://localhost/_ws", {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": requestId,
        },
      }),
    );

    assertEquals(isWebSocketUpgradeResponse(response), true);
    assertEquals(response.status, 101);
    assertEquals(response.statusText, "Switching Protocols");
    assertEquals(response.headers.get("upgrade"), "websocket");
    assertEquals(response instanceof Response, false);

    assertEquals(resolveWebSocketUpgrade(requestId, createMockWs()), true);
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
    // teardown. The handler must complete without throwing regardless of the
    // runtime's `CloseEvent` support.
    const { socket, ws } = attach();
    socket.onclose = () => {};

    ws.emit("close", 1000, Buffer.from("ok"));
    // Reaching this line without throwing proves the regression is fixed.
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
