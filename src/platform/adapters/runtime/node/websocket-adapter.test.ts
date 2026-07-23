import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { isWebSocketUpgradeResponse } from "../../base.ts";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import {
  NodeServerAdapter,
  NodeWebSocket,
  runWithNodeWebSocketRequest,
} from "./websocket-adapter.ts";
import type { WSWebSocket } from "./types.ts";

type MockWebSocket = WSWebSocket & EventEmitter & {
  closes: Array<{ code?: number; reason?: string }>;
  sent: Array<string | ArrayBuffer>;
  terminated: boolean;
};

function createMockWs(): MockWebSocket {
  const emitter = new EventEmitter() as EventEmitter & {
    closes: Array<{ code?: number; reason?: string }>;
    sent: Array<string | ArrayBuffer>;
    terminated: boolean;
    send: (data: string | ArrayBuffer) => void;
    close: (code?: number, reason?: string) => void;
    terminate: () => void;
  };
  emitter.closes = [];
  emitter.sent = [];
  emitter.terminated = false;
  emitter.send = (data) => emitter.sent.push(data);
  emitter.close = (code, reason) => emitter.closes.push({ code, reason });
  emitter.terminate = () => emitter.terminated = true;
  return emitter as unknown as MockWebSocket;
}

function createUpgradeRequest(protocols?: string): Request {
  const headers = new Headers({
    connection: "keep-alive, Upgrade",
    upgrade: "websocket",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    "sec-websocket-version": "13",
  });
  if (protocols) headers.set("sec-websocket-protocol", protocols);
  return new Request("http://localhost/_ws", { headers });
}

function captureVeryfrontError(operation: () => unknown): VeryfrontError {
  try {
    operation();
  } catch (error) {
    if (error instanceof VeryfrontError) return error;
    throw error;
  }
  throw new Error("Expected the operation to throw");
}

function attach(): { socket: NodeWebSocket; ws: MockWebSocket } {
  const socket = new NodeWebSocket();
  const ws = createMockWs();
  socket._attachRealSocket(ws);
  return { socket, ws };
}

describe("NodeServerAdapter WebSocket upgrade", () => {
  it("requires the active Node server request context", () => {
    const error = captureVeryfrontError(() =>
      new NodeServerAdapter().upgradeWebSocket(createUpgradeRequest())
    );

    assertEquals(error.slug, "not-supported");
  });

  it("registers an explicit upgrade signal with selected protocol and headers", async () => {
    const request = createUpgradeRequest("alpha, beta");

    const execution = await runWithNodeWebSocketRequest(
      request,
      () =>
        new NodeServerAdapter().upgradeWebSocket(request, {
          headers: { "x-websocket": "accepted" },
          idleTimeout: 0,
          protocol: "beta",
        }),
    );

    assertExists(execution.upgrade);
    assertEquals(execution.value, execution.upgrade.result);
    assertEquals(execution.upgrade.socket, execution.value.socket);
    assertEquals(execution.upgrade.protocol, "beta");
    assertEquals(execution.upgrade.headers.get("x-websocket"), "accepted");
    assertEquals(isWebSocketUpgradeResponse(execution.value.response), true);
    assertEquals(execution.value.response instanceof Response, false);
    assertEquals(execution.value.response.headers.get("sec-websocket-protocol"), "beta");
    assertEquals(
      execution.value.response.headers.get("sec-websocket-accept"),
      "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
    );
  });

  it("rejects a selected protocol the client did not offer", async () => {
    const request = createUpgradeRequest("alpha");

    const execution = await runWithNodeWebSocketRequest(
      request,
      () =>
        captureVeryfrontError(() =>
          new NodeServerAdapter().upgradeWebSocket(request, { protocol: "beta" })
        ),
    );

    assertEquals(execution.value.slug, "invalid-argument");
    assertEquals(execution.upgrade, undefined);
  });

  it("rejects nonzero idle timeouts instead of silently ignoring them", async () => {
    const request = createUpgradeRequest();

    const execution = await runWithNodeWebSocketRequest(
      request,
      () =>
        captureVeryfrontError(() =>
          new NodeServerAdapter().upgradeWebSocket(request, { idleTimeout: 30 })
        ),
    );

    assertEquals(execution.value.slug, "not-supported");
    assertEquals(execution.upgrade, undefined);
  });

  it("rejects multiple upgrade registrations for one request", async () => {
    const request = createUpgradeRequest();
    let secondError: VeryfrontError | undefined;

    const execution = await runWithNodeWebSocketRequest(request, () => {
      const first = new NodeServerAdapter().upgradeWebSocket(request);
      secondError = captureVeryfrontError(() => new NodeServerAdapter().upgradeWebSocket(request));
      return first;
    });

    assertEquals(secondError?.slug, "invalid-argument");
    assertExists(execution.upgrade);
  });
});

describe("NodeWebSocket", () => {
  it("dispatches open once and flushes bounded pending messages", () => {
    const socket = new NodeWebSocket();
    const ws = createMockWs();
    let propertyOpens = 0;
    let listenerOpens = 0;
    socket.onopen = () => propertyOpens++;
    socket.addEventListener("open", () => listenerOpens++, { once: true });
    socket.send("queued");

    socket._attachRealSocket(ws);
    ws.emit("open");

    assertEquals(socket.readyState, NodeWebSocket.OPEN);
    assertEquals(ws.sent, ["queued"]);
    assertEquals(propertyOpens, 1);
    assertEquals(listenerOpens, 1);
  });

  it("supports multiple listeners, once, and listener-specific removal", () => {
    const { socket, ws } = attach();
    const calls: string[] = [];
    const removed = () => calls.push("removed");
    socket.addEventListener("message", () => calls.push("first"));
    socket.addEventListener("message", () => calls.push("once"), { once: true });
    socket.addEventListener("message", removed);
    socket.removeEventListener("message", removed);

    ws.emit("message", Buffer.from("one"), false);
    ws.emit("message", Buffer.from("two"), false);

    assertEquals(calls, ["first", "once", "first"]);
  });

  it("preserves binary messages as ArrayBuffer data", () => {
    const { socket, ws } = attach();
    let data: unknown;
    socket.onmessage = (event) => data = event.data;

    ws.emit("message", Buffer.from([0, 128, 255]), true);

    assertEquals(data instanceof ArrayBuffer, true);
    assertEquals([...new Uint8Array(data as ArrayBuffer)], [0, 128, 255]);
  });

  it("honors a close requested before the transport attaches", () => {
    const socket = new NodeWebSocket();
    const ws = createMockWs();
    let opened = false;
    socket.onopen = () => opened = true;
    socket.send("discarded");

    socket.close(1000, "done");
    socket._attachRealSocket(ws);

    assertEquals(socket.readyState, NodeWebSocket.CLOSING);
    assertEquals(ws.closes, [{ code: 1000, reason: "done" }]);
    assertEquals(ws.sent, []);
    assertEquals(opened, false);
  });

  it("bounds messages queued while connecting", () => {
    const socket = new NodeWebSocket();
    for (let index = 0; index < 100; index++) socket.send(String(index));

    const error = captureVeryfrontError(() => socket.send("overflow"));

    assertEquals(error.slug, "network-error");
  });

  it("emits transport errors without relying on global ErrorEvent", () => {
    const { socket, ws } = attach();
    let received: Event | undefined;
    socket.onerror = (event) => received = event;

    ws.emit("error", new Error("transport failed"));

    assertExists(received);
    assertEquals(received.type, "error");
  });

  it("invokes onclose with close details and a monotonic closed state", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => received = event;

    ws.emit("close", 1000, Buffer.from("bye"));
    socket.close();

    assertExists(received);
    const event = received as unknown as CloseEvent;
    assertEquals(event.type, "close");
    assertEquals(event.code, 1000);
    assertEquals(event.reason, "bye");
    assertEquals(event.wasClean, true);
    assertEquals(socket.readyState, NodeWebSocket.CLOSED);
  });

  it("defaults abnormal close details when ws emits no arguments", () => {
    const { socket, ws } = attach();
    let received: CloseEvent | null = null;
    socket.onclose = (event) => received = event;

    ws.emit("close");

    assertExists(received);
    const event = received as unknown as CloseEvent;
    assertEquals(event.code, 1006);
    assertEquals(event.reason, "");
    assertEquals(event.wasClean, false);
  });

  it("rejects invalid close codes and oversized reasons", () => {
    const socket = new NodeWebSocket();

    assertThrows(() => socket.close(1006), VeryfrontError);
    assertThrows(() => socket.close(1000, "x".repeat(124)), VeryfrontError);
  });
});
