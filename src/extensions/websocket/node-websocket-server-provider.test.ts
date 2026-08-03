import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
  type NodeWebSocketServer,
  snapshotNodeWebSocketServerProvider,
} from "./node-websocket-server-provider.ts";

const SERVER = {} as NodeWebSocketServer;

Deno.test("Node WebSocket server capture pins callable methods and client ownership", () => {
  let closeCalls = 0;
  const clients = new Set<never>();
  const source = {
    clients,
    on() {
      return source;
    },
    close(callback?: (error?: Error) => void) {
      closeCalls++;
      callback?.();
    },
    handleUpgrade() {},
    emit() {},
  };
  const captured = captureNodeWebSocketServer(source);

  source.close = () => {
    throw new Error("mutated close must not run");
  };
  captured.close();

  assertEquals(closeCalls, 1);
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
      "one enumerable createServer data property",
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
  assertStringIncludes(
    NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
    NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
  );
  assertStringIncludes(
    NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
    "install it or remove the extension disable directive",
  );
});
