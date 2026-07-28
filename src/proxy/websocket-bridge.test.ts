import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  closeBridgePeer,
  createProxyWebSocketBridge,
  createProxyWebSocketTargetUrl,
  type ProxyBridgeSocket,
  type ProxyWebSocketBridge,
  ProxyWebSocketBridgeRegistry,
} from "./websocket-bridge.ts";

type SocketMessage = Parameters<ProxyBridgeSocket["send"]>[0];

class FakeWebSocket implements ProxyBridgeSocket {
  bufferedAmount = 0;
  readyState: number = WebSocket.CONNECTING;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null = null;
  onopen: ((event: Event) => unknown) | null = null;
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  readonly sent: SocketMessage[] = [];
  throwOnSend = false;
  throwOnCodedClose = false;

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.throwOnCodedClose && code !== undefined) {
      throw new DOMException("invalid close code", "InvalidAccessError");
    }
    this.readyState = WebSocket.CLOSING;
  }

  send(data: SocketMessage): void {
    if (this.throwOnSend) throw new Error("send race");
    this.sent.push(data);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as unknown as Event);
  }

  remoteClose(code = 1000, reason = "done", wasClean = true): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean } as CloseEvent);
  }
}

function createBridge(options: {
  client?: FakeWebSocket;
  connectTimeoutMs?: number;
  logger?: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(
      message: string,
      context?: Record<string, unknown>,
      error?: unknown,
    ): void;
  };
  maxBufferedBytes?: number;
  maxMessageBytes?: number;
  maxQueuedBytes?: number;
  maxQueuedMessages?: number;
  server?: FakeWebSocket;
} = {}) {
  const client = options.client ?? new FakeWebSocket();
  const server = options.server ?? new FakeWebSocket();
  const targets: string[] = [];
  const bridge = createProxyWebSocketBridge({
    clientSocket: client,
    connectTimeoutMs: options.connectTimeoutMs ?? 100,
    createServerSocket: (targetUrl) => {
      targets.push(targetUrl);
      return server;
    },
    logger: options.logger,
    maxBufferedBytes: options.maxBufferedBytes,
    maxMessageBytes: options.maxMessageBytes,
    maxQueuedBytes: options.maxQueuedBytes,
    maxQueuedMessages: options.maxQueuedMessages,
    targetUrl: "ws://renderer.test/_ws?project=demo",
  });
  return { bridge, client, server, targets };
}

function createRegistryBridge() {
  let resolveClosed!: () => void;
  const closeCalls: Array<{ code?: number; reason?: string }> = [];
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const bridge: ProxyWebSocketBridge = Object.freeze({
    closed,
    close(code?: number, reason?: string): void {
      closeCalls.push({ code, reason });
      resolveClosed();
    },
  });
  return Object.freeze({
    bridge,
    closeCalls,
    resolveClosed,
  });
}

function messageBytes(message: SocketMessage): number[] {
  if (typeof message === "string") {
    return [...new TextEncoder().encode(message)];
  }
  if (message instanceof Blob) {
    throw new TypeError("Blob assertions must await arrayBuffer()");
  }
  if (ArrayBuffer.isView(message)) {
    return [
      ...new Uint8Array(
        message.buffer,
        message.byteOffset,
        message.byteLength,
      ),
    ];
  }
  return [...new Uint8Array(message)];
}

describe("proxy WebSocket bridge lifecycle", () => {
  it("queues client messages until the upstream opens and flushes immutable snapshots in order", async () => {
    const { bridge, client, server, targets } = createBridge();
    const mutable = new Uint8Array([1, 2, 3]);

    client.open();
    client.message("first");
    client.message(mutable);
    mutable[0] = 9;

    assertEquals(targets, ["ws://renderer.test/_ws?project=demo"]);
    assertEquals(server.sent, []);

    server.open();

    assertEquals(server.sent[0], "first");
    assertEquals(messageBytes(server.sent[1]!), [1, 2, 3]);
    bridge.close();
    await bridge.closed;
  });

  it("closes both peers when the bounded pre-open queue is exhausted", async () => {
    const { bridge, client, server } = createBridge({
      maxMessageBytes: 4,
      maxQueuedBytes: 4,
      maxQueuedMessages: 2,
    });

    client.open();
    client.message("abc");
    client.message("de");
    await bridge.closed;

    assertEquals(client.closeCalls[0]?.code, 1009);
    assertEquals(server.closeCalls[0]?.code, 1009);
    assertEquals(server.sent, []);
  });

  it("rejects unsupported and oversized messages with protocol-specific close codes", async () => {
    const unsupported = createBridge({ maxMessageBytes: 4 });
    unsupported.client.open();
    unsupported.client.message({ unexpected: true });
    await unsupported.bridge.closed;
    assertEquals(unsupported.client.closeCalls[0]?.code, 1003);

    const oversized = createBridge({ maxMessageBytes: 4 });
    oversized.client.open();
    oversized.client.message("12345");
    await oversized.bridge.closed;
    assertEquals(oversized.client.closeCalls[0]?.code, 1009);
  });

  it("enforces destination backpressure in both forwarding directions", async () => {
    const toServer = createBridge({ maxBufferedBytes: 4 });
    toServer.client.open();
    toServer.server.open();
    toServer.server.bufferedAmount = 4;
    toServer.client.message("x");
    await toServer.bridge.closed;
    assertEquals(toServer.client.closeCalls[0]?.code, 1013);
    assertEquals(toServer.server.sent, []);

    const toClient = createBridge({ maxBufferedBytes: 4 });
    toClient.client.open();
    toClient.server.open();
    toClient.client.bufferedAmount = 4;
    toClient.server.message("x");
    await toClient.bridge.closed;
    assertEquals(toClient.server.closeCalls[0]?.code, 1013);
    assertEquals(toClient.client.sent, []);
  });

  it("turns send races into symmetric bridge failures", async () => {
    const { bridge, client, server } = createBridge();
    client.open();
    server.open();
    server.throwOnSend = true;

    client.message("update");
    await bridge.closed;

    assertEquals(client.closeCalls[0]?.code, 1011);
    assertEquals(server.closeCalls[0]?.code, 1011);
  });

  it("closes a connecting upstream when the client closes or errors", async () => {
    const closed = createBridge();
    closed.client.open();
    closed.client.remoteClose(1000, "browser left");
    await closed.bridge.closed;
    assertEquals(closed.server.closeCalls[0], {
      code: 1000,
      reason: "browser left",
    });

    const failed = createBridge();
    failed.client.open();
    failed.client.fail("Unexpected EOF");
    await failed.bridge.closed;
    assertEquals(failed.server.closeCalls[0]?.code, 1011);
  });

  it("propagates upstream closure and closes both peers on upstream errors", async () => {
    const closed = createBridge();
    closed.client.open();
    closed.server.open();
    closed.server.remoteClose(1000, "renderer stopped");
    await closed.bridge.closed;
    assertEquals(closed.client.closeCalls[0], {
      code: 1000,
      reason: "renderer stopped",
    });

    const failed = createBridge();
    failed.client.open();
    failed.server.fail("connection reset");
    await failed.bridge.closed;
    assertEquals(failed.client.closeCalls[0]?.code, 1011);
    assertEquals(failed.server.closeCalls[0]?.code, 1011);
  });

  it("bounds upstream connection establishment and isolates logger failures", async () => {
    const logger = {
      info: () => {
        throw new Error("logger failed");
      },
      warn: () => {
        throw new Error("logger failed");
      },
      error: () => {
        throw new Error("logger failed");
      },
    };
    const { bridge, client, server } = createBridge({
      connectTimeoutMs: 1,
      logger,
    });

    client.open();
    await bridge.closed;

    assertEquals(client.closeCalls[0]?.code, 1013);
    assertEquals(server.closeCalls[0]?.code, 1013);
  });

  it("bounds accepted client connection establishment before creating an upstream", async () => {
    const { bridge, client, server, targets } = createBridge({
      connectTimeoutMs: 1,
    });

    await bridge.closed;

    assertEquals(client.closeCalls[0]?.code, 1013);
    assertEquals(server.closeCalls, []);
    assertEquals(targets, []);
  });

  it("handles already-open clients and synchronous upstream construction failures", async () => {
    const openClient = new FakeWebSocket();
    openClient.readyState = WebSocket.OPEN;
    const alreadyOpen = createBridge({ client: openClient });
    await Promise.resolve();
    assertEquals(alreadyOpen.targets.length, 1);
    alreadyOpen.bridge.close();
    await alreadyOpen.bridge.closed;

    const failedClient = new FakeWebSocket();
    const failed = createProxyWebSocketBridge({
      clientSocket: failedClient,
      connectTimeoutMs: 100,
      createServerSocket: () => {
        throw new Error("construction failed");
      },
      targetUrl: "ws://renderer.test/_ws",
    });
    failedClient.open();
    await failed.closed;
    assertEquals(failedClient.closeCalls[0]?.code, 1011);
  });

  it("detaches handlers after synchronous socket callback failures", async () => {
    const eagerClient = new FakeWebSocket();
    let clientOpenHandler: ProxyBridgeSocket["onopen"] = null;
    Object.defineProperty(eagerClient, "onopen", {
      configurable: true,
      get: () => clientOpenHandler,
      set: (handler: ProxyBridgeSocket["onopen"]) => {
        clientOpenHandler = handler;
        if (handler) {
          eagerClient.readyState = WebSocket.OPEN;
          handler(new Event("open"));
        }
      },
    });
    const failedClientBridge = createProxyWebSocketBridge({
      clientSocket: eagerClient,
      createServerSocket: () => {
        throw new Error("construction failed");
      },
      targetUrl: "ws://renderer.test/_ws",
    });

    await failedClientBridge.closed;
    assertEquals(eagerClient.onopen, null);
    assertEquals(eagerClient.onmessage, null);
    assertEquals(eagerClient.onerror, null);
    assertEquals(eagerClient.onclose, null);

    const client = new FakeWebSocket();
    const eagerServer = new FakeWebSocket();
    let serverErrorHandler: ProxyBridgeSocket["onerror"] = null;
    Object.defineProperty(eagerServer, "onerror", {
      configurable: true,
      get: () => serverErrorHandler,
      set: (handler: ProxyBridgeSocket["onerror"]) => {
        serverErrorHandler = handler;
        if (handler) handler({ message: "synchronous failure" } as unknown as Event);
      },
    });
    const failedServerBridge = createBridge({ client, server: eagerServer });
    client.open();

    await failedServerBridge.bridge.closed;
    assertEquals(eagerServer.onopen, null);
    assertEquals(eagerServer.onmessage, null);
    assertEquals(eagerServer.onerror, null);
    assertEquals(eagerServer.onclose, null);
  });
});

describe("proxy WebSocket bridge registry", () => {
  it("bounds default admission and closes excess bridges deterministically", async () => {
    const registry = new ProxyWebSocketBridgeRegistry();
    const bridges = Array.from(
      { length: 257 },
      () => createRegistryBridge(),
    );

    const admission = bridges.map(({ bridge }) => registry.track(bridge));
    const excess = bridges[256];

    assertEquals(admission.filter(Boolean).length, 256);
    assertEquals(registry.size, 256);
    assert(excess);
    assertEquals(excess.closeCalls, [{
      code: 1013,
      reason: "Proxy WebSocket bridge capacity exhausted",
    }]);

    await registry.close();
    assertEquals(registry.size, 0);
  });

  it("releases bounded admission exactly when a tracked bridge settles", async () => {
    const registry = new ProxyWebSocketBridgeRegistry(2);
    const first = createRegistryBridge();
    const second = createRegistryBridge();
    const excess = createRegistryBridge();

    assertEquals(registry.track(first.bridge), true);
    assertEquals(registry.track(second.bridge), true);
    assertEquals(registry.track(excess.bridge), false);
    assertEquals(registry.size, 2);
    assertEquals(excess.closeCalls, [{
      code: 1013,
      reason: "Proxy WebSocket bridge capacity exhausted",
    }]);

    first.resolveClosed();
    await first.bridge.closed;
    await Promise.resolve();
    assertEquals(registry.size, 1);

    const replacement = createRegistryBridge();
    assertEquals(registry.track(replacement.bridge), true);
    assertEquals(registry.size, 2);

    await registry.close();
    assertEquals(second.closeCalls, [{
      code: 1001,
      reason: "Proxy is shutting down",
    }]);
    assertEquals(replacement.closeCalls, [{
      code: 1001,
      reason: "Proxy is shutting down",
    }]);
    assertEquals(registry.size, 0);
  });

  it("closes an excess live bridge before it can open an upstream socket", async () => {
    const registry = new ProxyWebSocketBridgeRegistry(1);
    const incumbent = createRegistryBridge();
    assertEquals(registry.track(incumbent.bridge), true);

    const client = new FakeWebSocket();
    client.readyState = WebSocket.OPEN;
    const excess = createBridge({ client });

    assertEquals(registry.track(excess.bridge), false);
    await excess.bridge.closed;
    await Promise.resolve();

    assertEquals(excess.targets, []);
    assertEquals(client.closeCalls, [{
      code: 1013,
      reason: "Proxy WebSocket bridge capacity exhausted",
    }]);

    await registry.close();
  });

  it("rejects invalid capacities instead of allowing an unbounded registry", () => {
    for (const capacity of [0, -1, 1.5, Number.NaN, Infinity, 65_536]) {
      assertThrows(
        () => new ProxyWebSocketBridgeRegistry(capacity),
        RangeError,
        "capacity must be an integer between 1 and 65535",
      );
    }
  });

  it("tracks live bridges, shares close, and rejects late ownership", async () => {
    const registry = new ProxyWebSocketBridgeRegistry();
    const first = createBridge();
    const second = createBridge();
    assertEquals(registry.track(first.bridge), true);
    assertEquals(registry.track(second.bridge), true);
    assertEquals(registry.size, 2);

    const close = registry.close();
    assert(close === registry.close());
    await close;
    assertEquals(registry.size, 0);
    assertEquals(first.client.closeCalls[0]?.code, 1001);
    assertEquals(second.client.closeCalls[0]?.code, 1001);

    const late = createBridge();
    assertEquals(registry.track(late.bridge), false);
    await late.bridge.closed;
    assertEquals(late.client.closeCalls[0]?.reason, "Proxy is shutting down");
  });

  it("uses stable handle snapshots and completes shutdown after a handle rejection", async () => {
    const registry = new ProxyWebSocketBridgeRegistry();
    let closeReads = 0;
    let closedReads = 0;
    let closeCalls = 0;
    const bridge = {
      get close() {
        closeReads += 1;
        return () => {
          closeCalls += 1;
        };
      },
      get closed() {
        closedReads += 1;
        return Promise.reject(new Error("bridge close failed"));
      },
    } as ProxyWebSocketBridge;

    assertEquals(registry.track(bridge), true);
    await registry.close();

    assertEquals(closeReads, 1);
    assertEquals(closedReads, 1);
    assertEquals(closeCalls, 1);
    assertEquals(registry.size, 0);
  });
});

describe("proxy WebSocket boundaries", () => {
  it("constructs canonical upstream URLs and overwrites routing query values", () => {
    const target = new URL(
      createProxyWebSocketTargetUrl(
        "https://renderer.test",
        new URL(
          "https://proxy.test//_ws?x-project-slug=attacker&x-environment=wrong&mode=hmr",
        ),
        "demo-project",
        "preview",
      ),
    );

    assertEquals(target.protocol, "wss:");
    assertEquals(target.pathname, "/_ws");
    assertEquals(target.searchParams.get("mode"), "hmr");
    assertEquals(target.searchParams.get("x-project-slug"), "demo-project");
    assertEquals(target.searchParams.get("x-environment"), "preview");
  });

  it("rejects malformed origins and bridge policy", () => {
    assertThrows(
      () =>
        createProxyWebSocketTargetUrl(
          "https://user:pass@renderer.test",
          new URL("https://proxy.test/_ws"),
          "demo-project",
          "preview",
        ),
      TypeError,
      "credential-free",
    );
    assertThrows(
      () =>
        createProxyWebSocketBridge({
          clientSocket: new FakeWebSocket(),
          connectTimeoutMs: 0,
          createServerSocket: () => new FakeWebSocket(),
          targetUrl: "ws://renderer.test/_ws",
        }),
      RangeError,
      "connect timeout",
    );
    assertThrows(
      () =>
        createProxyWebSocketBridge({
          clientSocket: new FakeWebSocket(),
          createServerSocket: () => new FakeWebSocket(),
          logger: {} as never,
          targetUrl: "ws://renderer.test/_ws",
        }),
      TypeError,
      "logger contract",
    );
    const unreadableSocket = new Proxy(new FakeWebSocket(), {
      get(target, property, receiver) {
        if (property === "close") throw new TypeError("hostile getter");
        return Reflect.get(target, property, receiver);
      },
    });
    assertThrows(
      () =>
        createProxyWebSocketBridge({
          clientSocket: unreadableSocket,
          createServerSocket: () => new FakeWebSocket(),
          targetUrl: "ws://renderer.test/_ws",
        }),
      TypeError,
      "socket is unreadable",
    );
  });

  it("falls back to an unqualified close when a runtime rejects a bridge code", () => {
    const socket = new FakeWebSocket();
    socket.readyState = WebSocket.OPEN;
    socket.throwOnCodedClose = true;

    assertEquals(
      closeBridgePeer(socket, 1011, "Bridge failed"),
      true,
    );
    assertEquals(socket.closeCalls, [
      { code: 1011, reason: "Bridge failed" },
      { code: undefined, reason: undefined },
    ]);
  });
});
