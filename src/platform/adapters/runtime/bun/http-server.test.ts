import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  BunNamespace,
  BunServeOptions,
  BunServer as BunServerType,
  BunServerWebSocket,
} from "./types.ts";
import { createBunServer } from "./http-server.ts";
import { BunServerAdapter, BunWebSocket } from "./websocket-adapter.ts";

async function withMockBun<T>(
  serve: (options: BunServeOptions) => BunServerType,
  operation: () => Promise<T> | T,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Bun");
  Object.defineProperty(globalThis, "Bun", {
    configurable: true,
    value: { serve } as Partial<BunNamespace>,
    writable: true,
  });
  try {
    return await operation();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "Bun", descriptor);
    else delete (globalThis as { Bun?: unknown }).Bun;
  }
}

function createNativeServer(
  overrides: Partial<BunServerType> = {},
): BunServerType {
  return {
    hostname: "127.0.0.1",
    port: 43123,
    stop() {},
    upgrade() {
      return true;
    },
    ...overrides,
  };
}

function createNativeSocket(data?: unknown) {
  const sent: Array<string | ArrayBuffer> = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const socket: BunServerWebSocket = {
    data,
    send(message) {
      sent.push(message);
      return 1;
    },
    close(code, reason) {
      closes.push({ code, reason });
    },
  };
  return { closes, sent, socket };
}

describe("createBunServer", () => {
  it("reports the actual address selected by Bun", async () => {
    let serveOptions: BunServeOptions | undefined;
    let listened: { hostname: string; port: number } | undefined;
    const nativeServer = createNativeServer();

    const server = await withMockBun(
      (options) => {
        serveOptions = options;
        return nativeServer;
      },
      () =>
        createBunServer(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port: 0,
          onListen: (address) => listened = address,
        }),
    );

    assertEquals(serveOptions?.hostname, "127.0.0.1");
    assertEquals(serveOptions?.port, 0);
    assertEquals(server.addr, { hostname: "127.0.0.1", port: 43123 });
    assertEquals(listened, server.addr);
  });

  it("binds requests and Bun WebSocket lifecycle callbacks", async () => {
    let serveOptions: BunServeOptions | undefined;
    let upgradeData: unknown;
    const nativeServer = createNativeServer({
      upgrade(_request, options) {
        upgradeData = options?.data;
        return true;
      },
    });
    let wrapper: BunWebSocket | undefined;

    await withMockBun(
      (options) => {
        serveOptions = options;
        return nativeServer;
      },
      async () => {
        await createBunServer((request) => {
          const upgrade = new BunServerAdapter().upgradeWebSocket(request, {
            idleTimeout: 0,
          });
          wrapper = upgrade.socket as BunWebSocket;
          return upgrade.response;
        });
      },
    );

    assertExists(serveOptions);
    const request = new Request("http://localhost/_ws");
    const response = await serveOptions.fetch(request, nativeServer);
    assertEquals(response, undefined);
    assertEquals(upgradeData, wrapper);

    const nativeSocket = createNativeSocket(upgradeData);
    serveOptions.websocket?.open?.(nativeSocket.socket);
    assertEquals(wrapper?.readyState, BunWebSocket.OPEN);
    wrapper?.send("outbound");
    assertEquals(nativeSocket.sent, ["outbound"]);

    serveOptions.websocket?.message?.(nativeSocket.socket, "inbound");
    serveOptions.websocket?.close?.(nativeSocket.socket, 1000, "complete");
    assertEquals(wrapper?.readyState, BunWebSocket.CLOSED);
  });

  it("does not start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let serveCalls = 0;

    await withMockBun(
      () => {
        serveCalls++;
        return createNativeServer();
      },
      async () => {
        await assertRejects(() =>
          createBunServer(() => new Response("ok"), { signal: controller.signal })
        );
      },
    );

    assertEquals(serveCalls, 0);
  });

  it("stops once when aborted and remains safe to stop again", async () => {
    const controller = new AbortController();
    let stopCalls = 0;
    const nativeServer = createNativeServer({
      stop() {
        stopCalls++;
      },
    });

    const server = await withMockBun(
      () => nativeServer,
      () =>
        createBunServer(() => new Response("ok"), {
          signal: controller.signal,
        }),
    );

    controller.abort();
    await Promise.resolve();
    assertEquals(stopCalls, 1);
    await server.stop();
    assertEquals(stopCalls, 1);
  });

  it("waits for Bun to finish stopping", async () => {
    let stopFinished = false;
    let finishStop: (() => void) | undefined;
    const stopPromise = new Promise<void>((resolve) => {
      finishStop = () => {
        stopFinished = true;
        resolve();
      };
    });
    const nativeServer = createNativeServer({
      stop: (() => stopPromise) as unknown as () => void,
    });
    const server = await withMockBun(
      () => nativeServer,
      () => createBunServer(() => new Response("ok")),
    );

    const stopping = server.stop();
    await Promise.resolve();
    assertEquals(stopFinished, false);
    finishStop?.();
    await stopping;

    assertEquals(stopFinished, true);
  });

  it("allows a failed stop to be retried", async () => {
    let stopCalls = 0;
    const nativeServer = createNativeServer({
      stop: (() => {
        stopCalls++;
        return stopCalls === 1
          ? Promise.reject(new Error("transient stop failure"))
          : Promise.resolve();
      }) as unknown as () => void,
    });
    const server = await withMockBun(
      () => nativeServer,
      () => createBunServer(() => new Response("ok")),
    );

    await assertRejects(() => server.stop(), Error, "transient stop failure");
    await server.stop();

    assertEquals(stopCalls, 2);
  });

  it("stops the native server if onListen throws", async () => {
    let stopCalls = 0;
    const nativeServer = createNativeServer({
      stop() {
        stopCalls++;
      },
    });

    await withMockBun(
      () => nativeServer,
      async () => {
        await assertRejects(
          () =>
            createBunServer(() => new Response("ok"), {
              onListen() {
                throw new Error("listen callback failed");
              },
            }),
          Error,
          "listen callback failed",
        );
      },
    );

    assertEquals(stopCalls, 1);
  });
});
