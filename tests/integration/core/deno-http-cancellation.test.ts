import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { DenoHttpServer } from "#veryfront/platform/compat/http/deno-server.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";

async function writeAll(connection: Deno.Conn, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  while (offset < bytes.length) offset += await connection.write(bytes.subarray(offset));
}

describe("Deno HTTP request cancellation", () => {
  for (const transport of ["compatibility", "runtime"] as const) {
    it(`observes disconnect after consuming a segmented body through ${transport}`, async () => {
      const started = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      const listening = Promise.withResolvers<number>();
      const handler = async (request: Request): Promise<Response> => {
        await request.text();
        request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        started.resolve();
        await released.promise;
        return new Response("complete");
      };
      const compatibility = new DenoHttpServer();
      const runtime = new DenoAdapter();
      const options = {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }: { port: number }) => listening.resolve(port),
      };
      const running = transport === "compatibility"
        ? compatibility.serve(handler, options)
        : runtime.serve(handler, options);
      const connection = await Deno.connect({
        hostname: "127.0.0.1",
        port: await listening.promise,
      });
      const body = "x".repeat(65536);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await writeAll(
          connection,
          `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n\r\n${
            body.slice(0, 1024)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await writeAll(connection, body.slice(1024));
        await started.promise;
        connection.close();
        const observed = await Promise.race([
          aborted.promise.then(() => true),
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(false), 1000);
          }),
        ]);
        assertEquals(observed, true);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        released.resolve();
        await compatibility.close();
        await runtime.shutdown();
        await running;
      }
    });
  }
});

for (const transport of ["compatibility", "runtime"] as const) {
  it(`preserves implicit Deno WebSocket support through ${transport}`, async () => {
    const compatibility = new DenoHttpServer();
    const runtime = new DenoAdapter();
    const listening = Promise.withResolvers<number>();
    const { upgradeWebSocket } = await import("#veryfront/platform/compat/http/websocket.ts");
    const handler = (request: Request) => {
      const upgrade = transport === "compatibility"
        ? upgradeWebSocket(request, { protocol: "echo", idleTimeout: 1 })
        : runtime.server.upgradeWebSocket(request, { protocol: "echo", idleTimeout: 1 });
      upgrade.socket.addEventListener("message", (event) => {
        upgrade.socket.send((event as MessageEvent).data);
      });
      return upgrade.response;
    };
    const options = {
      hostname: "127.0.0.1",
      port: 0,
      onListen: ({ port }: { port: number }) => listening.resolve(port),
    };
    const running = transport === "compatibility"
      ? compatibility.serve(handler, options)
      : runtime.serve(handler, options);
    const client = new WebSocket(`ws://127.0.0.1:${await listening.promise}/`, "echo");
    try {
      await new Promise<void>((resolve, reject) => {
        client.onopen = () => resolve();
        client.onerror = () => reject(new Error("Deno default WebSocket handshake failed"));
      });
      assertEquals(client.protocol, "echo");
      const reply = Promise.withResolvers<unknown>();
      client.onmessage = (event) => reply.resolve(event.data);
      client.send("hello");
      assertEquals(await reply.promise, "hello");
      const binary = Promise.withResolvers<unknown>();
      client.binaryType = "arraybuffer";
      client.onmessage = (event) => binary.resolve(event.data);
      client.send(new Uint8Array([0, 255, 8]));
      assertEquals(
        new Uint8Array(await binary.promise as ArrayBuffer),
        new Uint8Array([0, 255, 8]),
      );
    } finally {
      const closed = Promise.withResolvers<void>();
      client.onclose = () => closed.resolve();
      client.close();
      await closed.promise;
      await compatibility.close();
      await runtime.shutdown();
      await running;
    }
  });
}

for (const transport of ["compatibility", "runtime"] as const) {
  it(`isolates request async context through ${transport}`, async () => {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const storage = new AsyncLocalStorage<string>();
    const compatibility = new DenoHttpServer();
    const runtime = new DenoAdapter();
    const listening = Promise.withResolvers<number>();
    const handler = async (request: Request) => {
      const initial = storage.getStore();
      const id = new URL(request.url).pathname;
      storage.enterWith(id);
      await new Promise((resolve) => setTimeout(resolve, id === "/first" ? 10 : 1));
      return Response.json({ initial: initial ?? null, current: storage.getStore() });
    };
    const options = {
      hostname: "127.0.0.1",
      port: 0,
      onListen: ({ port }: { port: number }) => listening.resolve(port),
    };
    const running = transport === "compatibility"
      ? compatibility.serve(handler, options)
      : runtime.serve(handler, options);
    const base = `http://127.0.0.1:${await listening.promise}`;
    try {
      const first = fetch(`${base}/first`).then((response) => response.json());
      const second = fetch(`${base}/second`).then((response) => response.json());
      assertEquals(await first, { initial: null, current: "/first" });
      assertEquals(await second, { initial: null, current: "/second" });
      assertEquals(await (await fetch(`${base}/later`)).json(), {
        initial: null,
        current: "/later",
      });
    } finally {
      storage.disable();
      await compatibility.close();
      await runtime.shutdown();
      await running;
    }
  });
}

it("settles serving on a failed fallback close and retains teardown for retry", async () => {
  const { NodeHttpServer } = await import("#veryfront/platform/compat/http/node-server.ts");
  const { assertRejects } = await import("#veryfront/testing/assert.ts");
  const originalClose = NodeHttpServer.prototype.close;
  const compatibility = new DenoHttpServer();
  const listening = Promise.withResolvers<void>();
  const failure = new Error("injected close failure");
  const outcome = compatibility.serve(() => new Response("ok"), {
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => listening.resolve(),
  }).then(() => undefined, (error) => error);
  await listening.promise;
  try {
    NodeHttpServer.prototype.close = () => Promise.reject(failure);
    await assertRejects(() => compatibility.close(), Error, "injected close failure");
    assertEquals(await outcome, failure);
  } finally {
    NodeHttpServer.prototype.close = originalClose;
    await compatibility.close();
  }
});

it("close during asynchronous startup prevents a listener from escaping", async () => {
  const compatibility = new DenoHttpServer();
  let listened = false;
  const serving = compatibility.serve(() => new Response("ok"), {
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {
      listened = true;
    },
  }).then(() => undefined, (error) => error);
  await compatibility.close();
  const result = await serving;
  assertEquals(result instanceof DOMException && result.name === "AbortError", true);
  assertEquals(listened, false);
  await compatibility.close();
});

it("Deno compatibility fallback preserves its default listening address", async () => {
  const { NodeHttpServer } = await import("#veryfront/platform/compat/http/node-server.ts");
  const original = NodeHttpServer.prototype.serve;
  const seen = Promise.withResolvers<{ hostname?: string; port?: number }>();
  NodeHttpServer.prototype.serve = async (_handler, options) => {
    seen.resolve(options ?? {});
  };
  const server = new DenoHttpServer();
  const running = server.serve(() => new Response("ok"), { nodeWebSocketServerProvider: null });
  try {
    const options = await seen.promise;
    assertEquals([options.hostname, options.port], ["127.0.0.1", 8000]);
  } finally {
    await server.close();
    await running;
    NodeHttpServer.prototype.serve = original;
  }
});

it("Deno fallback retains startup ownership until cleanup can be retried", async () => {
  const { NodeHttpServer } = await import("#veryfront/platform/compat/http/node-server.ts");
  const originalServe = NodeHttpServer.prototype.serve;
  const originalClose = NodeHttpServer.prototype.close;
  let closes = 0;
  NodeHttpServer.prototype.serve = () => Promise.reject(new Error("startup failed"));
  NodeHttpServer.prototype.close = () =>
    ++closes === 1 ? Promise.reject(new Error("cleanup failed")) : Promise.resolve();
  const server = new DenoHttpServer();
  try {
    let failed = false;
    try {
      await server.serve(() => new Response("ok"), { nodeWebSocketServerProvider: null });
    } catch (error) {
      failed = error instanceof AggregateError;
    }
    assertEquals(failed, true);
    assertEquals(closes, 1);
    await server.close();
    assertEquals(closes, 2);
    await server.close();
    assertEquals(closes, 2);
  } finally {
    NodeHttpServer.prototype.serve = originalServe;
    NodeHttpServer.prototype.close = originalClose;
  }
});

it("service listener observes disconnect after consuming the complete segmented body", async () => {
  const { createVeryfrontServer, startVeryfrontServer } = await import(
    "#veryfront/server/service-server.ts"
  );
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const server = await startVeryfrontServer({
    runtime: createVeryfrontServer({
      modules: [{
        name: "cancellation",
        handle: async (request) => {
          await request.text();
          request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
          started.resolve();
          await released.promise;
          return new Response("complete");
        },
      }],
    }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
    logger: {},
  });
  const connection = await Deno.connect({ hostname: "127.0.0.1", port: server.port });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = "x".repeat(65536);
    await writeAll(
      connection,
      `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n\r\n${
        body.slice(0, 1024)
      }`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeAll(connection, body.slice(1024));
    await started.promise;
    connection.close();
    assertEquals(
      await Promise.race([
        aborted.promise.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1000);
        }),
      ]),
      true,
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    released.resolve();
    await server.stop();
  }
});
