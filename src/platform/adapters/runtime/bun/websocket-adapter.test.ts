import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createWebSocketUpgradeResponse } from "../../base.ts";
import type { BunServer, BunServerWebSocket, BunWebSocketMessage } from "./types.ts";
import {
  BunServerAdapter,
  BunWebSocket,
  type BunWebSocketData,
  bunWebSocketHandler,
  dispatchBunRequest,
  resolveBunWebSocketUpgradeHeaders,
} from "./websocket-adapter.ts";

function websocketRequest(protocols?: string): Request {
  return new Request("http://localhost/_ws", {
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      ...(protocols ? { "sec-websocket-protocol": protocols } : {}),
    },
  });
}

class FakeNativeSocket implements BunServerWebSocket<BunWebSocketData> {
  readonly sent: Array<string | ArrayBuffer | Uint8Array> = [];
  readonly closes: Array<[number | undefined, string | undefined]> = [];
  readyState = BunWebSocket.OPEN;
  sendResult = 1;
  terminated = false;

  constructor(readonly data: BunWebSocketData) {}

  send(data: string | ArrayBuffer | Uint8Array): number {
    this.sent.push(data);
    return this.sendResult;
  }

  close(code?: number, reason?: string): void {
    this.closes.push([code, reason]);
  }

  terminate(): void {
    this.terminated = true;
  }
}

class FakeBunServer implements BunServer<BunWebSocketData> {
  readonly port = 3000;
  readonly hostname = "localhost";
  upgradeResult = true;
  upgradeError: Error | null = null;
  openSynchronously = false;
  lastNativeSocket: FakeNativeSocket | null = null;
  upgradeCalls: Array<{
    request: Request;
    requestProtocols: string | null;
    data: BunWebSocketData;
    headers?: HeadersInit;
  }> = [];

  stop(): Promise<void> {
    return Promise.resolve();
  }

  upgrade(
    request: Request,
    options: { data: BunWebSocketData; headers?: HeadersInit },
  ): boolean {
    if (this.upgradeError) throw this.upgradeError;
    this.upgradeCalls.push({
      request,
      requestProtocols: request.headers.get("sec-websocket-protocol"),
      ...options,
    });
    if (this.openSynchronously) {
      this.lastNativeSocket = new FakeNativeSocket(options.data);
      bunWebSocketHandler.open?.(this.lastNativeSocket);
    }
    return this.upgradeResult;
  }
}

describe("Bun WebSocket handshake validation", () => {
  it("preserves custom headers and selects only a client-offered protocol", () => {
    const headers = resolveBunWebSocketUpgradeHeaders(
      websocketRequest("chat, hmr"),
      {
        protocol: "hmr",
        headers: { "Set-Cookie": "session=one" },
        idleTimeout: 0,
      },
    );

    assertEquals(headers.get("sec-websocket-protocol"), "hmr");
    assertEquals(headers.get("set-cookie"), "session=one");
  });

  it("rejects non-upgrade requests, managed headers, and unsupported timeouts", () => {
    assertThrows(
      () => resolveBunWebSocketUpgradeHeaders(new Request("http://localhost")),
      Error,
      "Upgrade: websocket",
    );
    assertThrows(
      () =>
        resolveBunWebSocketUpgradeHeaders(websocketRequest(), {
          headers: { Connection: "Upgrade" },
        }),
      Error,
      "manages the connection",
    );
    assertThrows(
      () => resolveBunWebSocketUpgradeHeaders(websocketRequest(), { idleTimeout: 30 }),
      Error,
      "supports only idleTimeout: 0",
    );
    assertThrows(
      () => resolveBunWebSocketUpgradeHeaders(websocketRequest(), { idleTimeout: Number.NaN }),
      Error,
      "non-negative finite",
    );
  });

  it("rejects an invalid or unoffered subprotocol", () => {
    assertThrows(
      () =>
        resolveBunWebSocketUpgradeHeaders(websocketRequest("hmr"), {
          protocol: "not valid",
        }),
      Error,
      "valid HTTP token",
    );
    assertThrows(
      () =>
        resolveBunWebSocketUpgradeHeaders(websocketRequest("chat"), {
          protocol: "hmr",
        }),
      Error,
      "not offered",
    );
  });
});

describe("Bun WebSocket transport bridge", () => {
  it("exposes OPEN state when Bun opens synchronously during upgrade", async () => {
    const server = new FakeBunServer();
    server.openSynchronously = true;
    let socket: BunWebSocket | undefined;

    await dispatchBunRequest(websocketRequest(), server, (request) => {
      const upgrade = new BunServerAdapter().upgradeWebSocket(request);
      socket = upgrade.socket as BunWebSocket;
      return upgrade.response;
    });

    assertExists(socket);
    assertEquals(socket.readyState, BunWebSocket.OPEN);
    assertEquals(server.lastNativeSocket?.terminated, false);
  });

  it("upgrades the original request and bridges open, send, message, and close", async () => {
    const request = websocketRequest("chat, hmr");
    const server = new FakeBunServer();
    const adapter = new BunServerAdapter();
    let socket: BunWebSocket | undefined;
    let openCalls = 0;
    const messages: unknown[] = [];
    let closeEvent: CloseEvent | undefined;

    const result = await dispatchBunRequest(request, server, (activeRequest) => {
      const upgrade = adapter.upgradeWebSocket(activeRequest, {
        protocol: "hmr",
        headers: { "Set-Cookie": "session=one" },
        idleTimeout: 0,
      });
      socket = upgrade.socket as BunWebSocket;
      socket.addEventListener("open", () => openCalls++, { once: true });
      socket.addEventListener("message", (event) => {
        messages.push((event as MessageEvent).data);
      });
      socket.addEventListener("close", (event) => {
        closeEvent = event as CloseEvent;
      });
      return upgrade.response;
    });

    assertEquals(result, {});
    assertEquals(server.upgradeCalls.length, 1);
    const upgradeCall = server.upgradeCalls[0];
    if (!upgradeCall) throw new Error("Expected one native upgrade call");
    assertEquals(upgradeCall.request, request);
    assertEquals(upgradeCall.requestProtocols, "hmr");
    assertEquals(new Headers(upgradeCall.headers).has("sec-websocket-protocol"), false);
    assertEquals(new Headers(upgradeCall.headers).get("set-cookie"), "session=one");
    assertEquals(request.headers.get("sec-websocket-protocol"), "chat, hmr");

    const nativeSocket = new FakeNativeSocket(upgradeCall.data);
    bunWebSocketHandler.open?.(nativeSocket);
    await Promise.resolve();
    assertExists(socket);
    assertEquals(socket.readyState, BunWebSocket.OPEN);
    assertEquals(openCalls, 1);

    socket.send("hello");
    assertEquals(nativeSocket.sent, ["hello"]);

    bunWebSocketHandler.message(nativeSocket, "world");
    bunWebSocketHandler.message(nativeSocket, new Uint8Array([1, 2, 3]));
    assertEquals(messages[0], "world");
    assertEquals([...new Uint8Array(messages[1] as ArrayBuffer)], [1, 2, 3]);

    bunWebSocketHandler.close?.(nativeSocket, 1000, "done");
    assertEquals(socket.readyState, BunWebSocket.CLOSED);
    assertExists(closeEvent);
    assertEquals(closeEvent.code, 1000);
    assertEquals(closeEvent.reason, "done");
    assertEquals(closeEvent.wasClean, true);
  });

  it("fails closed when Bun rejects or throws during the native upgrade", async () => {
    const adapter = new BunServerAdapter();
    const rejectedServer = new FakeBunServer();
    rejectedServer.upgradeResult = false;

    await assertRejects(
      () =>
        dispatchBunRequest(
          websocketRequest(),
          rejectedServer,
          (request) => adapter.upgradeWebSocket(request).response,
        ),
      Error,
      "rejected the WebSocket upgrade",
    );

    const throwingServer = new FakeBunServer();
    throwingServer.upgradeError = new Error("native failure");
    await assertRejects(
      () =>
        dispatchBunRequest(
          websocketRequest(),
          throwingServer,
          (request) => adapter.upgradeWebSocket(request).response,
        ),
      Error,
      "failed to upgrade",
    );
  });

  it("rejects upgrades outside the active server request context", () => {
    assertThrows(
      () => new BunServerAdapter().upgradeWebSocket(websocketRequest()),
      Error,
      "original Request",
    );
  });

  it("closes a committed upgrade if the handler returns an HTTP response", async () => {
    const server = new FakeBunServer();
    const adapter = new BunServerAdapter();
    let socket: BunWebSocket | undefined;
    let errorCalls = 0;
    let closeCalls = 0;

    const result = await dispatchBunRequest(websocketRequest(), server, (request) => {
      socket = adapter.upgradeWebSocket(request).socket as BunWebSocket;
      socket.addEventListener("error", () => errorCalls++);
      socket.addEventListener("close", () => closeCalls++);
      return new Response("wrong");
    });

    assertExists(result.upgradeError);
    assertExists(socket);
    assertEquals(socket.readyState, BunWebSocket.CLOSED);
    assertEquals(errorCalls, 1);
    assertEquals(closeCalls, 1);

    const upgradeCall = server.upgradeCalls[0];
    if (!upgradeCall) throw new Error("Expected one native upgrade call");
    const nativeSocket = new FakeNativeSocket(upgradeCall.data);
    bunWebSocketHandler.open?.(nativeSocket);
    await Promise.resolve();
    assertEquals(nativeSocket.terminated, true);
  });

  it("rejects a fabricated upgrade signal without a native upgrade", async () => {
    await assertRejects(
      () =>
        dispatchBunRequest(
          websocketRequest(),
          new FakeBunServer(),
          () => createWebSocketUpgradeResponse(),
        ),
      Error,
      "without upgrading",
    );
  });

  it("surfaces a dropped Bun send instead of silently losing the message", async () => {
    const server = new FakeBunServer();
    let socket: BunWebSocket | undefined;
    await dispatchBunRequest(websocketRequest(), server, (request) => {
      const upgrade = new BunServerAdapter().upgradeWebSocket(request);
      socket = upgrade.socket as BunWebSocket;
      return upgrade.response;
    });

    const upgradeCall = server.upgradeCalls[0];
    if (!upgradeCall) throw new Error("Expected one native upgrade call");
    const nativeSocket = new FakeNativeSocket(upgradeCall.data);
    nativeSocket.sendResult = 0;
    bunWebSocketHandler.open?.(nativeSocket);
    await Promise.resolve();

    assertExists(socket);
    const activeSocket = socket;
    assertThrows(() => activeSocket.send("lost"), Error, "dropped a WebSocket message");
  });

  it("rejects concurrent dispatch of the same Request object", async () => {
    const request = websocketRequest();
    const server = new FakeBunServer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = dispatchBunRequest(request, server, async () => {
      await gate;
      return new Response("ok");
    });

    await Promise.resolve();
    await assertRejects(
      () => dispatchBunRequest(request, server, () => new Response("duplicate")),
      Error,
      "cannot be dispatched concurrently",
    );
    release();
    assertEquals((await first).response?.status, 200);
  });

  it("ignores messages after close", async () => {
    const socket = new BunWebSocket();
    const nativeSocket = new FakeNativeSocket({ socket });
    const messages: BunWebSocketMessage[] = [];
    socket.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    bunWebSocketHandler.open?.(nativeSocket);
    await Promise.resolve();
    bunWebSocketHandler.close?.(nativeSocket, 1000, "done");
    bunWebSocketHandler.message(nativeSocket, "late");
    assertEquals(messages, []);
  });
});
