import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createServer, request as nodeRequest } from "node:http";
import { createConnection } from "node:net";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { createNodeServer, NodeServer } from "./http-server.ts";
import type { NodeHttpServer } from "./types.ts";
import { NodeServerAdapter } from "./websocket-adapter.ts";

function createHttpServer(
  close: NodeHttpServer["close"],
): NodeHttpServer {
  return {
    listen: () => {},
    close,
  };
}

describe("NodeServer lifecycle", () => {
  it("shares shutdown and retries only the failed HTTP close phase", async () => {
    let upgradeDisposeCalls = 0;
    let closeCalls = 0;
    const server = new NodeServer(
      createHttpServer((callback) => {
        closeCalls++;
        callback(closeCalls === 1 ? new Error("transient HTTP close failure") : undefined);
      }),
      "localhost",
      3_000,
      () => {
        upgradeDisposeCalls++;
      },
    );

    const first = server.stop();
    const concurrent = server.stop();
    assertStrictEquals(first, concurrent);
    await assertRejects(() => first, Error, "transient HTTP close failure");

    await server.stop();
    await server.stop();
    assertEquals(upgradeDisposeCalls, 1);
    assertEquals(closeCalls, 2);
  });

  it("does not close HTTP while upgrade resources failed to retire", async () => {
    let upgradeDisposeCalls = 0;
    let closeCalls = 0;
    const server = new NodeServer(
      createHttpServer((callback) => {
        closeCalls++;
        callback();
      }),
      "localhost",
      3_000,
      () => {
        upgradeDisposeCalls++;
        if (upgradeDisposeCalls === 1) throw new Error("upgrade cleanup failed");
      },
    );

    await assertRejects(() => server.stop(), Error, "upgrade cleanup failed");
    assertEquals(closeCalls, 0);

    await server.stop();
    assertEquals(upgradeDisposeCalls, 2);
    assertEquals(closeCalls, 1);
  });

  it("rejects startup without listening when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () =>
        createNodeServer(() => new Response("ok"), {
          hostname: "127.0.0.1",
          port: 0,
          signal: controller.signal,
        }),
      DOMException,
      "aborted",
    );
  });

  it("rejects a listener startup error instead of leaving the promise pending", async () => {
    if (!isNode) return;
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an IP listener address");
    }

    try {
      await assertRejects(
        () =>
          createNodeServer(() => new Response("ok"), {
            hostname: "127.0.0.1",
            port: address.port,
          }),
        Error,
        "EADDRINUSE",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("destroys an upgrade that the request handler did not authorize", async () => {
    if (!isNode) return;
    let handlerCalls = 0;
    const server = await createNodeServer(() => {
      handlerCalls++;
      return new Response("forbidden", { status: 403 });
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      assertNotEquals(server.addr.port, 0);
      const socket = createConnection({ host: "127.0.0.1", port: server.addr.port });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(
        "GET /_ws HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Unauthorized upgrade socket remained open")),
          1_000,
        );
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      assertEquals(handlerCalls, 1);
    } finally {
      await server.stop();
    }
  });

  it("owns and terminates authorized WebSocket clients during stop", async () => {
    if (!isNode) return;
    const adapter = new NodeServerAdapter();
    const server = await createNodeServer((request) => {
      return adapter.upgradeWebSocket(request).response;
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });
    const { WebSocket } = await import("ws");
    const client = new WebSocket(`ws://127.0.0.1:${server.addr.port}/_ws`);

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));

      await server.stop();
      await closed;

      assertEquals(client.readyState, WebSocket.CLOSED);
    } finally {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
      await server.stop();
    }
  });

  it("aborts the Fetch request when the HTTP client disconnects", async () => {
    if (!isNode) return;
    const handlerStarted = Promise.withResolvers<void>();
    const requestAborted = Promise.withResolvers<void>();
    const server = await createNodeServer(async (request) => {
      handlerStarted.resolve();
      if (request.signal.aborted) requestAborted.resolve();
      else request.signal.addEventListener("abort", () => requestAborted.resolve(), { once: true });
      await requestAborted.promise;
      return new Response("too late");
    }, {
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = nodeRequest({
      host: "127.0.0.1",
      port: server.addr.port,
      path: "/slow",
    });
    client.on("error", () => {});
    client.end();

    try {
      await handlerStarted.promise;
      client.destroy();
      await requestAborted.promise;
    } finally {
      client.destroy();
      await server.stop();
    }
  });

  it("waits for response drain and cancels the body when the client disconnects", async () => {
    if (!isNode) return;
    const totalChunks = 256;
    let producedChunks = 0;
    const bodyCancelled = Promise.withResolvers<void>();
    const server = await createNodeServer(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (producedChunks >= totalChunks) {
              controller.close();
              return;
            }
            producedChunks++;
            controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            bodyCancelled.resolve();
          },
        }),
      ), {
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = nodeRequest({
      host: "127.0.0.1",
      port: server.addr.port,
      path: "/stream",
    });
    client.on("error", () => {});
    const responseReceived = new Promise<import("node:http").IncomingMessage>((resolve) => {
      client.once("response", (response) => {
        response.pause();
        resolve(response);
      });
    });
    client.end();

    try {
      const response = await responseReceived;
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEquals(producedChunks < totalChunks, true);

      response.destroy();
      client.destroy();
      await bodyCancelled.promise;
    } finally {
      client.destroy();
      await server.stop();
    }
  });
});
