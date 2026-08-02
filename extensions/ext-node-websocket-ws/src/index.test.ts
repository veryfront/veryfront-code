import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  type NodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
} from "veryfront/extensions/websocket";
import extNodeWebSocketWs, { WsNodeWebSocketServerProvider } from "./index.ts";

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createContext(provided: Map<string, unknown>, signal?: AbortSignal) {
  return {
    config: {},
    logger,
    signal,
    get: () => undefined,
    require: () => {
      throw new Error("No required contracts expected");
    },
    provide: (name: string, implementation: unknown) => {
      provided.set(name, implementation);
    },
  };
}

Deno.test("ws extension explicitly publishes one immutable provider", () => {
  const extension = extNodeWebSocketWs();
  const provided = new Map<string, unknown>();

  extension.setup?.(createContext(provided));
  assertStrictEquals(
    provided.get(NodeWebSocketServerProviderName),
    WsNodeWebSocketServerProvider,
  );
  assertEquals(Object.isFrozen(WsNodeWebSocketServerProvider), true);
  assertEquals(extension.contracts?.provides, [NodeWebSocketServerProviderName]);
  assertEquals(extension.capabilities, [{
    type: "env:read",
    keys: ["WS_NO_BUFFER_UTIL", "WS_NO_UTF_8_VALIDATE"],
  }]);
  assertThrows(() => extension.setup?.(createContext(new Map())), Error, "already set up");

  extension.teardown?.();
  extension.setup?.(createContext(new Map()));
  extension.teardown?.();
});

Deno.test("ws extension creates a no-server transport", () => {
  const provider = WsNodeWebSocketServerProvider as NodeWebSocketServerProvider;
  const server = provider.createServer({
    noServer: true,
    handleProtocols: () => false,
  });

  try {
    assertEquals(typeof server.handleUpgrade, "function");
    assertEquals(typeof server.close, "function");
    assertEquals(typeof server.on, "function");
  } finally {
    server.close();
  }
});

Deno.test("ws extension refuses a revoked setup context", () => {
  const extension = extNodeWebSocketWs();
  const controller = new AbortController();
  controller.abort(new DOMException("context retired", "AbortError"));

  assertThrows(
    () => extension.setup?.(createContext(new Map(), controller.signal)),
    DOMException,
    "context retired",
  );
});
