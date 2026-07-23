import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { DenoAdapter } from "./adapter.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => resolve = resolvePromise);
  return { promise, resolve };
}

function waitForWebSocketEvent(
  socket: WebSocket,
  type: "open" | "close" | "message",
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WebSocket ${type}`));
    }, 2_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeEventListener(type, onEvent);
    };
    const onEvent = (event: Event): void => {
      cleanup();
      resolve(event);
    };
    socket.addEventListener(type, onEvent, { once: true });
  });
}

describe("DenoAdapter server", () => {
  it("rejects unsupported WebSocket headers and unrequested protocols", () => {
    const adapter = new DenoAdapter();
    const request = new Request("http://localhost/socket", {
      headers: { "sec-websocket-protocol": "alpha" },
    });

    for (
      const options of [
        { headers: { "x-websocket": "value" } },
        { protocol: "beta" },
      ]
    ) {
      try {
        adapter.server.upgradeWebSocket(request, options);
        throw new Error("Expected the WebSocket options to be rejected");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
      }
    }
  });

  it("reports the actual address selected for port zero", async () => {
    const adapter = new DenoAdapter();
    let listened: { hostname: string; port: number } | undefined;
    const server = await adapter.serve(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (address) => listened = address,
    });

    try {
      assertEquals(server.addr.hostname, "127.0.0.1");
      assertEquals(server.addr.port > 0, true);
      assertEquals(listened, server.addr);
      const response = await fetch(`http://127.0.0.1:${server.addr.port}/health`);
      assertEquals(await response.text(), "ok");
    } finally {
      await server.stop();
    }
  });

  it("rejects duplicate starts and allows restart after direct stop", async () => {
    const adapter = new DenoAdapter();
    const first = await adapter.serve(() => new Response("first"), {
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const error = await assertRejects(
        () =>
          adapter.serve(() => new Response("second"), {
            hostname: "127.0.0.1",
            port: 0,
          }),
        VeryfrontError,
      );
      assertEquals((error as VeryfrontError).slug, "server-start-error");
    } finally {
      await first.stop();
    }

    const restarted = await adapter.serve(() => new Response("restarted"), {
      hostname: "127.0.0.1",
      port: 0,
    });
    await restarted.stop();
  });

  it("does not bind when the signal is already aborted", async () => {
    const adapter = new DenoAdapter();
    const controller = new AbortController();
    controller.abort();
    let listenCalls = 0;

    await assertRejects(() =>
      adapter.serve(() => new Response("ok"), {
        hostname: "127.0.0.1",
        port: 0,
        signal: controller.signal,
        onListen: () => listenCalls++,
      })
    );

    assertEquals(listenCalls, 0);
  });

  it("releases the listener when onListen throws", async () => {
    const adapter = new DenoAdapter();
    let boundPort = 0;
    await assertRejects(
      () =>
        adapter.serve(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port: 0,
          onListen(address) {
            boundPort = address.port;
            throw new Error("listen callback failed");
          },
        }),
      Error,
      "listen callback failed",
    );

    const listener = Deno.listen({ hostname: "127.0.0.1", port: boundPort });
    listener.close();
  });

  it("rejects occupied ports asynchronously with a typed error", async () => {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    const adapter = new DenoAdapter();
    try {
      const error = await assertRejects(
        () =>
          adapter.serve(() => new Response("ok"), {
            hostname: "127.0.0.1",
            port,
          }),
        VeryfrontError,
      );
      assertEquals((error as VeryfrontError).slug, "port-in-use");
    } finally {
      listener.close();
    }
  });

  it("lets an in-flight response finish during graceful stop", async () => {
    const adapter = new DenoAdapter();
    const entered = deferred<void>();
    const release = deferred<void>();
    const server = await adapter.serve(async () => {
      entered.resolve();
      await release.promise;
      return new Response("complete");
    }, { hostname: "127.0.0.1", port: 0 });
    const request = fetch(`http://127.0.0.1:${server.addr.port}/slow`);
    await entered.promise;

    let stopSettled = false;
    const stopping = server.stop().finally(() => stopSettled = true);
    await Promise.resolve();
    assertEquals(stopSettled, false);
    release.resolve();

    assertEquals(await (await request).text(), "complete");
    await stopping;
  });

  it("closes owned WebSockets during stop", async () => {
    const adapter = new DenoAdapter();
    const server = await adapter.serve((request) => {
      const { socket, response } = adapter.server.upgradeWebSocket(request, {
        idleTimeout: 0,
      });
      socket.addEventListener(
        "message",
        (event) => socket.send(`echo:${(event as MessageEvent).data}`),
      );
      return response;
    }, { hostname: "127.0.0.1", port: 0 });
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/socket`);

    try {
      await waitForWebSocketEvent(client, "open");
      const message = waitForWebSocketEvent(client, "message") as Promise<MessageEvent>;
      client.send("hello");
      assertEquals((await message).data, "echo:hello");

      const closed = waitForWebSocketEvent(client, "close");
      await server.stop();
      await closed;
      assertEquals(client.readyState, WebSocket.CLOSED);
    } finally {
      client.close();
      await adapter.shutdown();
    }
  });
});
