import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type NodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
} from "veryfront/extensions/websocket";
import extensionPackage from "../deno.json" with { type: "json" };
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

describe("extNodeWebSocketWs", () => {
  it("auto-activates one immutable provider", () => {
    const extension = extNodeWebSocketWs();
    const provided = new Map<string, unknown>();

    assertEquals(extensionPackage.veryfront.activation, "auto");
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

  it("creates a no-server transport", () => {
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

  it("refuses a revoked setup context", () => {
    const extension = extNodeWebSocketWs();
    const controller = new AbortController();
    controller.abort(new DOMException("context retired", "AbortError"));

    assertThrows(
      () => extension.setup?.(createContext(new Map(), controller.signal)),
      DOMException,
      "context retired",
    );
  });
});
