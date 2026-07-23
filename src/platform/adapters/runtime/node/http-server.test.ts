import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Server } from "../../base.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createNodeServer, NodeServer } from "./http-server.ts";
import type { NodeHttpServer } from "./types.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";

function waitForWebSocketEvent(
  socket: WebSocket,
  type: "open" | "close" | "error" | "message",
  timeoutMs = 2_000,
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WebSocket ${type}`));
    }, timeoutMs);
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

function waitForWebSocketOutcome(socket: WebSocket): Promise<"opened" | "rejected"> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the WebSocket handshake"));
    }, 2_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    const onOpen = (): void => {
      cleanup();
      resolve("opened");
    };
    const onError = (): void => {
      cleanup();
      resolve("rejected");
    };
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

async function stopServer(server: Server | undefined): Promise<void> {
  if (server) await server.stop();
}

async function performRawWebSocketHandshake(
  port: number,
  key: string,
  protocols = "alpha, beta",
): Promise<string> {
  const connection = await Deno.connect({ hostname: "127.0.0.1", port });
  try {
    const request = [
      "GET /socket HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      ...(protocols ? [`Sec-WebSocket-Protocol: ${protocols}`] : []),
      "",
      "",
    ].join("\r\n");
    await connection.write(new TextEncoder().encode(request));

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 16_384) {
      const chunk = new Uint8Array(2_048);
      const size = await connection.read(chunk);
      if (size === null) break;
      chunks.push(chunk.slice(0, size));
      total += size;
      const response = new TextDecoder().decode(concatenate(chunks, total));
      if (response.includes("\r\n\r\n")) return response;
    }
    throw new Error("WebSocket handshake response was incomplete");
  } finally {
    connection.close();
  }
}

function concatenate(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe("createNodeServer", () => {
  it("reports the actual address selected for port zero", async () => {
    let listened: { hostname: string; port: number } | undefined;
    const server = await createNodeServer(() => new Response("ok"), {
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

  it("preserves repeated cookies and cancels bodies for HEAD", async () => {
    let cancelled = false;
    const server = await createNodeServer((request) => {
      const headers = new Headers();
      headers.append("set-cookie", "first=1; Path=/");
      headers.append("set-cookie", "second=2; Path=/");
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("body"));
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers, status: request.method === "HEAD" ? 200 : 201 },
      );
    }, { hostname: "127.0.0.1", port: 0 });

    try {
      const url = `http://127.0.0.1:${server.addr.port}/resource`;
      const response = await fetch(url);
      assertEquals(response.status, 201);
      assertEquals(response.headers.getSetCookie(), [
        "first=1; Path=/",
        "second=2; Path=/",
      ]);
      assertEquals(await response.text(), "body");

      const head = await fetch(url, { method: "HEAD" });
      assertEquals(await head.text(), "");
      assertEquals(cancelled, true);
    } finally {
      await server.stop();
    }
  });

  it("rejects occupied ports with a typed error instead of hanging", async () => {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    try {
      const error = await assertRejects(
        () => createNodeServer(() => new Response("ok"), { hostname: "127.0.0.1", port }),
        VeryfrontError,
      );
      assertEquals((error as VeryfrontError).slug, "port-in-use");
    } finally {
      listener.close();
    }
  });

  it("does not bind when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let listenCalls = 0;

    await assertRejects(() =>
      createNodeServer(() => new Response("ok"), {
        hostname: "127.0.0.1",
        port: 0,
        signal: controller.signal,
        onListen: () => listenCalls++,
      })
    );

    assertEquals(listenCalls, 0);
  });

  it("stops after abort and remains idempotent", async () => {
    const controller = new AbortController();
    const server = await createNodeServer(() => new Response("ok"), {
      hostname: "127.0.0.1",
      port: 0,
      signal: controller.signal,
    });

    controller.abort();
    await server.stop();
    await server.stop();
    await assertRejects(() => fetch(`http://127.0.0.1:${server.addr.port}/health`));
  });

  it("allows a failed stop to be retried", async () => {
    let closeCalls = 0;
    const nativeServer = {
      address: () => ({ address: "127.0.0.1", family: "IPv4", port: 43124 }),
      close(callback?: (error?: Error) => void) {
        closeCalls++;
        callback?.(closeCalls === 1 ? new Error("transient stop failure") : undefined);
      },
      listen() {},
      off() {},
      on() {},
      once() {},
    } satisfies NodeHttpServer;
    const server = new NodeServer(
      nativeServer,
      { close: () => Promise.resolve(), handle: () => Promise.resolve() },
      "127.0.0.1",
      43124,
    );

    await assertRejects(() => server.stop(), Error, "transient stop failure");
    await server.stop();

    assertEquals(closeCalls, 2);
  });

  it("forces active connections after the configured graceful shutdown timeout", async () => {
    let closeCallback: ((error?: Error) => void) | undefined;
    let forceCloseCalls = 0;
    const nativeServer = {
      address: () => ({ address: "127.0.0.1", family: "IPv4", port: 43125 }),
      close(callback?: (error?: Error) => void) {
        closeCallback = callback;
      },
      closeAllConnections() {
        forceCloseCalls++;
        queueMicrotask(() => closeCallback?.());
      },
      listen() {},
      off() {},
      on() {},
      once() {},
    } satisfies NodeHttpServer;
    const server = new NodeServer(
      nativeServer,
      { close: () => Promise.resolve(), handle: () => Promise.resolve() },
      "127.0.0.1",
      43125,
      undefined,
      5,
    );

    await server.stop();

    assertEquals(forceCloseCalls, 1);
  });

  it("rejects invalid graceful shutdown timeouts before creating a listener", async () => {
    const error = await assertRejects(
      () =>
        createNodeServer(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port: 0,
          gracefulShutdownTimeoutMs: -1,
        }),
      VeryfrontError,
      "Node graceful shutdown timeout must be an integer",
    );

    assertEquals(error.slug, "invalid-argument");
  });

  it("rejects when force-closing connections cannot settle the server", async () => {
    let forceCloseCalls = 0;
    const nativeServer = {
      address: () => ({ address: "127.0.0.1", family: "IPv4", port: 43126 }),
      close() {},
      closeAllConnections() {
        forceCloseCalls++;
      },
      listen() {},
      off() {},
      on() {},
      once() {},
    } satisfies NodeHttpServer;
    const server = new NodeServer(
      nativeServer,
      { close: () => Promise.resolve(), handle: () => Promise.resolve() },
      "127.0.0.1",
      43126,
      undefined,
      1,
    );

    const error = await assertRejects(
      () => server.stop(),
      VeryfrontError,
      "Node server did not stop within 1ms",
    );

    assertEquals(error.slug, "timeout-error");
    assertEquals(forceCloseCalls, 1);
  });

  it("bounds WebSocket shutdown when the controller cannot settle", async () => {
    const nativeServer = {
      address: () => ({ address: "127.0.0.1", family: "IPv4", port: 43127 }),
      close(callback?: (error?: Error) => void) {
        callback?.();
      },
      listen() {},
      off() {},
      on() {},
      once() {},
    } satisfies NodeHttpServer;
    const server = new NodeServer(
      nativeServer,
      { close: () => new Promise(() => {}), handle: () => Promise.resolve() },
      "127.0.0.1",
      43127,
      undefined,
      1,
    );
    let deadlineId: ReturnType<typeof setTimeout> | undefined;

    const outcome = await Promise.race([
      server.stop().then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ),
      new Promise<{ status: "deadline" }>((resolve) => {
        deadlineId = setTimeout(() => resolve({ status: "deadline" }), 750);
      }),
    ]);
    if (deadlineId) clearTimeout(deadlineId);

    assertEquals(outcome.status, "rejected");
    if (outcome.status === "rejected") {
      assertEquals(outcome.error instanceof VeryfrontError, true);
      assertEquals((outcome.error as VeryfrontError).slug, "timeout-error");
    }
  });

  it("releases the listener when onListen throws", async () => {
    let boundPort = 0;
    await assertRejects(
      () =>
        createNodeServer(() => new Response("ok"), {
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

  it("does not upgrade when the handler rejects the request", async () => {
    const server = await createNodeServer(
      () => new Response("Forbidden", { status: 403 }),
      { hostname: "127.0.0.1", port: 0 },
    );
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/socket`);

    try {
      const outcome = await waitForWebSocketOutcome(client);
      assertEquals(outcome, "rejected");
    } finally {
      client.close();
      await server.stop();
    }
  });

  it("upgrades an accepted request and bridges messages", async () => {
    const adapter = new NodeServerAdapter();
    let serverSocketClosed = false;
    const server = await createNodeServer((request) => {
      const { socket, response } = adapter.upgradeWebSocket(request, { idleTimeout: 0 });
      socket.addEventListener(
        "message",
        (event) => socket.send(`echo:${(event as MessageEvent).data}`),
      );
      socket.addEventListener("close", () => serverSocketClosed = true);
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
      assertEquals(serverSocketClosed, true);
    } finally {
      client.close();
      await stopServer(server);
    }
  });

  it("isolates duplicate client keys and applies the selected protocol and headers", async () => {
    const adapter = new NodeServerAdapter();
    let opened = 0;
    const server = await createNodeServer((request) => {
      const { socket, response } = adapter.upgradeWebSocket(request, {
        headers: { "x-websocket": "accepted" },
        protocol: "beta",
      });
      socket.addEventListener("open", () => opened++);
      return response;
    }, { hostname: "127.0.0.1", port: 0 });

    try {
      const key = "dGhlIHNhbXBsZSBub25jZQ==";
      const responses = await Promise.all([
        performRawWebSocketHandshake(server.addr.port, key),
        performRawWebSocketHandshake(server.addr.port, key),
      ]);
      for (const response of responses) {
        const normalized = response.toLowerCase();
        assertEquals(normalized.startsWith("http/1.1 101"), true);
        assertEquals(normalized.includes("sec-websocket-protocol: beta\r\n"), true);
        assertEquals(normalized.includes("x-websocket: accepted\r\n"), true);
      }
      assertEquals(opened, 2);
    } finally {
      await server.stop();
    }
  });

  it("keeps WebSocket state isolated between server instances", async () => {
    const adapter = new NodeServerAdapter();
    const start = (name: string) =>
      createNodeServer((request) => {
        const { response } = adapter.upgradeWebSocket(request, {
          headers: { "x-server": name },
        });
        return response;
      }, { hostname: "127.0.0.1", port: 0 });
    const [first, second] = await Promise.all([start("first"), start("second")]);

    try {
      const key = "dGhlIHNhbXBsZSBub25jZQ==";
      const [firstResponse, secondResponse] = await Promise.all([
        performRawWebSocketHandshake(first.addr.port, key, ""),
        performRawWebSocketHandshake(second.addr.port, key, ""),
      ]);
      assertEquals(firstResponse.toLowerCase().includes("x-server: first\r\n"), true);
      assertEquals(secondResponse.toLowerCase().includes("x-server: second\r\n"), true);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
