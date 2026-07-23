import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeHttpServer, writeNodeResponse } from "./node-server.ts";

function getFreePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function listeningPromise(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((value) => {
    resolve = value;
  });
  return { promise, resolve: () => resolve?.() };
}

function createMockServerResponse(writeResult = true) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const response = {
    statusCode: 0,
    statusMessage: undefined as string | undefined,
    destroyed: false,
    headersSent: false,
    writableEnded: false,
    writes: 0,
    ended: false,
    setHeader: () => {},
    write: () => {
      response.writes++;
      return writeResult;
    },
    end: () => {
      response.ended = true;
      response.writableEnded = true;
    },
    destroy: () => {
      response.destroyed = true;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    once: (event: string, listener: (...args: unknown[]) => void) => {
      const wrapped = (...args: unknown[]): void => {
        response.off(event, wrapped);
        listener(...args);
      };
      response.on(event, wrapped);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
  };
  return response;
}

describe("NodeHttpServer", () => {
  it("writes the response status text to the underlying server response", async () => {
    const headers = new Map<string, string | string[]>();
    const response = {
      statusCode: 0,
      statusMessage: undefined as string | undefined,
      setHeader: (name: string, value: string | string[]) => headers.set(name, value),
      end: () => {},
    };

    await writeNodeResponse(
      { method: "GET" } as never,
      response as never,
      new Response(null, { status: 201, statusText: "Custom Created" }),
    );

    assertEquals(response.statusCode, 201);
    assertEquals(response.statusMessage, "Custom Created");
  });

  it("waits for drain when the Node response applies backpressure", async () => {
    const response = createMockServerResponse(false);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });

    const writing = writeNodeResponse(
      { method: "GET" } as never,
      response as never,
      new Response(body),
    );
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(response.writes, 1);
    assertEquals(response.ended, false);
    response.emit("drain");
    await writing;
    assertEquals(response.ended, true);
  });

  it("cancels the source stream when the client disconnects", async () => {
    const response = createMockServerResponse();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const writing = writeNodeResponse(
      { method: "GET" } as never,
      response as never,
      new Response(body),
    );
    await Promise.resolve();
    response.destroyed = true;
    response.emit("close");
    await writing;

    assertEquals(cancelled, true);
    assertEquals(response.ended, false);
  });

  it("keeps serve pending until the server closes", async () => {
    const server = new NodeHttpServer();
    const port = getFreePort();
    const listening = listeningPromise();
    let settled = false;
    const serving = server.serve(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port,
      onListen: listening.resolve,
    }).finally(() => {
      settled = true;
    });

    await listening.promise;
    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const state = await Promise.race([
        serving.then(() => "settled" as const),
        new Promise<"pending">((resolve) => {
          timeoutId = setTimeout(() => resolve("pending"), 25);
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      assertEquals(state, "pending");
      assertEquals(settled, false);

      const response = await fetch(`http://127.0.0.1:${port}/health`);
      assertEquals(await response.text(), "ok");
    } finally {
      await server.close();
      await serving;
    }
    assertEquals(settled, true);
  });

  it("closes when the external signal aborts", async () => {
    const server = new NodeHttpServer();
    const controller = new AbortController();
    const listening = listeningPromise();
    const serving = server.serve(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: getFreePort(),
      signal: controller.signal,
      onListen: listening.resolve,
    });

    await listening.promise;
    controller.abort();
    await serving;
    await server.close();
  });

  it("waits for shutdown when close races startup", async () => {
    const server = new NodeHttpServer();
    let servingSettled = false;
    const serving = server.serve(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: getFreePort(),
    }).finally(() => {
      servingSettled = true;
    });

    await server.close();

    assertEquals(servingSettled, true);
    await serving;
  });

  it("does not start when the external signal is already aborted", async () => {
    const server = new NodeHttpServer();
    const controller = new AbortController();
    controller.abort();
    let listenCalls = 0;

    try {
      await server.serve(() => new Response("ok"), {
        hostname: "127.0.0.1",
        port: getFreePort(),
        signal: controller.signal,
        onListen: () => listenCalls++,
      });

      assertEquals(listenCalls, 0);
    } finally {
      await server.close();
    }
  });

  it("preserves status metadata and separate Set-Cookie headers", async () => {
    const server = new NodeHttpServer();
    const port = getFreePort();
    const listening = listeningPromise();
    const serving = server.serve(() => {
      const headers = new Headers({ "x-test": "value" });
      headers.append("set-cookie", "first=1; Path=/");
      headers.append("set-cookie", "second=2; Path=/");
      return new Response("created", {
        status: 201,
        statusText: "Custom Created",
        headers,
      });
    }, {
      hostname: "127.0.0.1",
      port,
      onListen: listening.resolve,
    });

    await listening.promise;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resource`);
      assertEquals(response.status, 201);
      assertEquals(response.headers.get("x-test"), "value");
      assertEquals(response.headers.getSetCookie(), [
        "first=1; Path=/",
        "second=2; Path=/",
      ]);
      assertEquals(await response.text(), "created");
    } finally {
      await server.close();
      await serving;
    }
  });

  it("cancels a response body instead of consuming it for HEAD", async () => {
    const server = new NodeHttpServer();
    const port = getFreePort();
    const listening = listeningPromise();
    let cancelled = false;
    const serving = server.serve(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("unused"));
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
      ), {
      hostname: "127.0.0.1",
      port,
      onListen: listening.resolve,
    });

    await listening.promise;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/resource`, { method: "HEAD" });
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "");
      assertEquals(cancelled, true);
    } finally {
      await server.close();
      await serving;
    }
  });
});
