import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { isWebSocketUpgradeResponse } from "../../base.ts";
import type { BunServer, BunServerWebSocket } from "./types.ts";
import { BunServerAdapter, BunWebSocket, runWithBunServerRequest } from "./websocket-adapter.ts";

function captureVeryfrontError(operation: () => unknown): VeryfrontError {
  try {
    operation();
  } catch (error) {
    if (error instanceof VeryfrontError) return error;
    throw error;
  }
  throw new Error("Expected the operation to throw");
}

function createServer(
  upgrade: BunServer["upgrade"],
): BunServer {
  return {
    hostname: "127.0.0.1",
    port: 3000,
    stop() {},
    upgrade,
  };
}

function createSocket() {
  const sent: Array<string | ArrayBuffer> = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const socket: BunServerWebSocket = {
    send(data) {
      sent.push(data);
      return 1;
    },
    close(code, reason) {
      closes.push({ code, reason });
    },
  };
  return { closes, sent, socket };
}

describe("BunServerAdapter WebSocket upgrade", () => {
  it("requires the active Bun server request context", () => {
    const error = captureVeryfrontError(() =>
      new BunServerAdapter().upgradeWebSocket(new Request("http://localhost/_ws"))
    );

    assertEquals(error.slug, "not-supported");
  });

  it("uses BunServer.upgrade and returns an explicit upgrade signal", async () => {
    let receivedRequest: Request | undefined;
    let receivedOptions: { data?: unknown; headers?: HeadersInit } | undefined;
    const server = createServer((request, options) => {
      receivedRequest = request;
      receivedOptions = options;
      return true;
    });
    const request = new Request("http://localhost/_ws", {
      headers: { "sec-websocket-protocol": "chat, events" },
    });

    const result = await runWithBunServerRequest(
      request,
      server,
      () =>
        new BunServerAdapter().upgradeWebSocket(request, {
          headers: { "x-websocket": "accepted" },
          idleTimeout: 0,
          protocol: "events",
        }),
    );

    assertEquals(receivedRequest, request);
    assertEquals(receivedOptions?.data, result.socket);
    const headers = new Headers(receivedOptions?.headers);
    assertEquals(headers.get("sec-websocket-protocol"), "events");
    assertEquals(headers.get("x-websocket"), "accepted");
    assertEquals(isWebSocketUpgradeResponse(result.response), true);
    assertEquals(result.response instanceof Response, false);
  });

  it("rejects a protocol the client did not request", async () => {
    let upgradeCalled = false;
    const server = createServer(() => {
      upgradeCalled = true;
      return true;
    });
    const request = new Request("http://localhost/_ws", {
      headers: { "sec-websocket-protocol": "chat" },
    });

    const error = await runWithBunServerRequest(
      request,
      server,
      () =>
        captureVeryfrontError(() =>
          new BunServerAdapter().upgradeWebSocket(request, { protocol: "events" })
        ),
    );

    assertEquals(error.slug, "invalid-argument");
    assertEquals(upgradeCalled, false);
  });

  it("rejects nonzero per-connection idle timeouts that Bun cannot honor", async () => {
    let upgradeCalled = false;
    const server = createServer(() => {
      upgradeCalled = true;
      return true;
    });
    const request = new Request("http://localhost/_ws");

    const error = await runWithBunServerRequest(
      request,
      server,
      () =>
        captureVeryfrontError(() =>
          new BunServerAdapter().upgradeWebSocket(request, { idleTimeout: 60 })
        ),
    );

    assertEquals(error.slug, "not-supported");
    assertEquals(upgradeCalled, false);
  });

  it("reports a rejected Bun upgrade as a network error", async () => {
    const server = createServer(() => false);
    const request = new Request("http://localhost/_ws");

    const error = await runWithBunServerRequest(
      request,
      server,
      () => captureVeryfrontError(() => new BunServerAdapter().upgradeWebSocket(request)),
    );

    assertEquals(error.slug, "network-error");
  });
});

describe("BunWebSocket", () => {
  it("queues sends until Bun opens the real socket", () => {
    const wrapper = new BunWebSocket();
    const { sent, socket } = createSocket();
    let propertyOpens = 0;
    let listenerOpens = 0;
    wrapper.onopen = () => propertyOpens++;
    wrapper.addEventListener("open", () => listenerOpens++, { once: true });

    wrapper.send("before-open");
    wrapper._attachRealSocket(socket);

    assertEquals(wrapper.readyState, BunWebSocket.OPEN);
    assertEquals(sent, ["before-open"]);
    assertEquals(propertyOpens, 1);
    assertEquals(listenerOpens, 1);
  });

  it("supports multiple listeners, once, and listener removal", () => {
    const wrapper = new BunWebSocket();
    const { socket } = createSocket();
    const calls: string[] = [];
    const removed = () => calls.push("removed");
    wrapper.addEventListener("message", () => calls.push("first"));
    wrapper.addEventListener("message", () => calls.push("once"), { once: true });
    wrapper.addEventListener("message", removed);
    wrapper.removeEventListener("message", removed);
    wrapper._attachRealSocket(socket);

    wrapper._handleMessage("one");
    wrapper._handleMessage("two");

    assertEquals(calls, ["first", "once", "first"]);
  });

  it("honors close requests made before Bun opens the socket", () => {
    const wrapper = new BunWebSocket();
    const { closes, sent, socket } = createSocket();
    let opened = false;
    wrapper.onopen = () => opened = true;
    wrapper.send("discarded");

    wrapper.close(1000, "done");
    wrapper._attachRealSocket(socket);

    assertEquals(wrapper.readyState, BunWebSocket.CLOSING);
    assertEquals(closes, [{ code: 1000, reason: "done" }]);
    assertEquals(sent, []);
    assertEquals(opened, false);
  });

  it("bounds messages queued while connecting", () => {
    const wrapper = new BunWebSocket();
    for (let index = 0; index < 100; index++) wrapper.send(String(index));

    const error = captureVeryfrontError(() => wrapper.send("overflow"));

    assertEquals(error.slug, "network-error");
  });

  it("dispatches close details and transitions to closed", () => {
    const wrapper = new BunWebSocket();
    const { socket } = createSocket();
    let received: CloseEvent | undefined;
    wrapper.onclose = (event) => received = event;
    wrapper._attachRealSocket(socket);

    wrapper._handleClose(1000, "complete");

    assertEquals(wrapper.readyState, BunWebSocket.CLOSED);
    assertExists(received);
    assertEquals(received.code, 1000);
    assertEquals(received.reason, "complete");
    assertEquals(received.wasClean, true);
    assertThrows(() => wrapper.send("late"), VeryfrontError);
  });
});
