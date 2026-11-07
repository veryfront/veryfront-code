import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES } from "#veryfront/extensions/first-party-defaults.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
  type NodeWebSocketConnection,
  type NodeWebSocketServer,
  NodeWebSocketServerProviderName,
  snapshotNodeWebSocketServerProvider,
} from "./node-websocket-server-provider.ts";

const SERVER = {} as NodeWebSocketServer;

Deno.test("Node WebSocket server capture pins callable methods and client ownership", () => {
  let closeCalls = 0;
  const clients = new Set<never>();
  const records: { receiver: unknown; args: unknown[] }[] = [];
  const source = {
    clients,
    on(...args: unknown[]) {
      records.push({ receiver: this, args });
      return source;
    },
    close(callback?: (error?: Error) => void) {
      closeCalls++;
      callback?.();
    },
    handleUpgrade(...args: unknown[]) {
      records.push({ receiver: this, args });
    },
    emit(...args: unknown[]) {
      records.push({ receiver: this, args });
    },
  };
  const captured = captureNodeWebSocketServer(source);
  const listener = (_headers: string[], _request: unknown) => {};
  const request = { url: "/socket" };
  const socket = {} as NodeWebSocketConnection;
  const head = new Uint8Array(0);
  const callback = (_socket: NodeWebSocketConnection) => {};

  assertStrictEquals(
    captured.on("headers", listener),
    captured,
    "on must return the captured facade so handshake listeners can chain",
  );
  captured.handleUpgrade(request, socket, head, callback);
  captured.emit("connection", socket, request);

  source.close = () => {
    throw new Error("mutated close must not run");
  };
  captured.close();

  assertEquals(closeCalls, 1);
  assertEquals(records.length, 3, "every captured method must forward to the source");
  for (const record of records) {
    assertStrictEquals(
      record.receiver,
      source,
      "the underlying implementation must remain the receiver",
    );
  }
  assertEquals(
    records.map((record) => record.args),
    [
      ["headers", listener],
      [request, socket, head, callback],
      ["connection", socket, request],
    ],
    "every captured method must forward its arguments unchanged",
  );
  assertStrictEquals(captured.clients, clients);
  assertEquals(Object.isFrozen(captured), true);
});

Deno.test("Node WebSocket server capture rejects proxies, accessors, and missing methods", () => {
  const valid = {
    on() {
      return valid;
    },
    close() {},
    handleUpgrade() {},
    emit() {},
  };
  const accessor = Object.defineProperty({ ...valid }, "close", {
    get() {
      return () => {};
    },
  });

  for (const value of [new Proxy(valid, {}), accessor, { close() {} }]) {
    assertThrows(
      () => captureNodeWebSocketServer(value),
      TypeError,
      "must expose data-function",
    );
  }

  for (
    const value of [
      { ...valid, clients: 42 },
      { ...valid, clients: new Proxy(new Set(), {}) },
      Object.defineProperty({ ...valid }, "clients", {
        enumerable: true,
        get() {
          return new Set();
        },
      }),
    ]
  ) {
    assertThrows(
      () => captureNodeWebSocketServer(value),
      TypeError,
      "must expose data-function",
      "a non-iterable, proxied, or accessor-backed clients set must be rejected at capture time",
    );
  }

  const captured = captureNodeWebSocketServer({ ...valid, clients: undefined });
  assertEquals(
    Object.hasOwn(captured, "clients"),
    false,
    "an absent clients set must not become an own property of the captured server",
  );
});

Deno.test("Node WebSocket provider captures one immutable factory generation", () => {
  let calls = 0;
  const originalFactory = () => {
    calls++;
    return SERVER;
  };
  const source = { createServer: originalFactory };
  const captured = snapshotNodeWebSocketServerProvider(source);

  source.createServer = () => {
    throw new Error("mutated factory must not run");
  };

  assertStrictEquals(
    captured.createServer({ noServer: true, handleProtocols: () => false }),
    SERVER,
  );
  assertEquals(calls, 1);
  assertEquals(Object.isFrozen(captured), true);
});

Deno.test("Node WebSocket provider rejects accessors, proxies, and extra fields", () => {
  let accessorCalls = 0;
  const accessor = Object.defineProperty({}, "createServer", {
    enumerable: true,
    get() {
      accessorCalls++;
      return () => SERVER;
    },
  });

  for (
    const value of [
      accessor,
      new Proxy({ createServer: () => SERVER }, {}),
      { createServer: () => SERVER, fallback: true },
    ]
  ) {
    assertThrows(
      () => snapshotNodeWebSocketServerProvider(value),
      TypeError,
      "an enumerable createServer data function and optional supportsIdleTimeout: true",
    );
  }
  assertEquals(accessorCalls, 0);
});

Deno.test("Node WebSocket provider helper and missing-contract diagnostic are actionable", () => {
  const provider = createNodeWebSocketServerProvider(() => SERVER);
  assertStrictEquals(
    provider.createServer({ noServer: true, handleProtocols: () => false }),
    SERVER,
  );
  const policy = FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES.find(
    (candidate) => candidate.name === "ext-node-websocket-ws",
  );
  assertEquals(
    NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
    `@veryfront/${policy?.sourceDirectory}`,
    "diagnostic package must match the first-party deferred builtin policy",
  );
  assertEquals(
    getRecommendation(NodeWebSocketServerProviderName),
    NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
    "diagnostic package must match the contract recommendation",
  );
  assertStringIncludes(
    NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
    "install it or remove the extension disable directive",
  );
});

Deno.test("heartbeat capability is immutable captured registration metadata", () => {
  const source = { createServer: () => SERVER, supportsIdleTimeout: true as const };
  const captured = snapshotNodeWebSocketServerProvider(source);
  Object.defineProperty(source, "supportsIdleTimeout", { value: false });
  assertEquals(captured.supportsIdleTimeout, true);
  assertEquals(Object.isFrozen(captured), true);
  assertThrows(() =>
    snapshotNodeWebSocketServerProvider({ createServer: () => SERVER, supportsIdleTimeout: false })
  );
  assertThrows(() =>
    snapshotNodeWebSocketServerProvider({
      createServer: () => SERVER,
      get supportsIdleTimeout() {
        throw new Error("must not read");
      },
    })
  );
});

Deno.test("buffered amount accessor is captured without invoking registration getters", () => {
  const provider = {
    createServer: () => SERVER,
    getBufferedAmount: () => 17,
  };
  const snapshot = snapshotNodeWebSocketServerProvider(provider);
  provider.getBufferedAmount = () => 99;
  assertEquals(snapshot.getBufferedAmount?.({} as NodeWebSocketConnection), 17);
  let reads = 0;
  const capabilities = Object.defineProperty(
    { supportsIdleTimeout: true as const },
    "getBufferedAmount",
    {
      enumerable: true,
      get() {
        reads++;
        return () => 0;
      },
    },
  );
  assertThrows(() => createNodeWebSocketServerProvider(() => SERVER, capabilities), TypeError);
  assertEquals(reads, 0);
});
