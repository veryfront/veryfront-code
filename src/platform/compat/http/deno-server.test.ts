import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { ProxyRequestDrainTracker } from "#veryfront/proxy/request-drain.ts";
import { getRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { DenoHttpServer } from "./deno-server.ts";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  detail: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(detail)), milliseconds);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

async function readUntilHeaders(
  conn: Deno.Conn,
): Promise<{ bytesRead: number; bodyPayloadBytesRead: number }> {
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(16 * 1024);
  let bytesRead = 0;

  while (true) {
    const read = await conn.read(buffer);
    if (read === null) throw new Error("connection closed before response headers");
    const chunk = buffer.slice(0, read);
    chunks.push(chunk);
    bytesRead += read;
    const combined = concatChunks(chunks);
    const headerEnd = findHeaderEnd(combined);
    if (headerEnd !== -1) {
      return {
        bytesRead,
        bodyPayloadBytesRead: countPayloadBytes(combined.slice(headerEnd + 4)),
      };
    }
  }
}

function findHeaderEnd(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.byteLength - 4; index++) {
    if (
      bytes[index] === 13 &&
      bytes[index + 1] === 10 &&
      bytes[index + 2] === 13 &&
      bytes[index + 3] === 10
    ) {
      return index;
    }
  }
  return -1;
}

function countPayloadBytes(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 97) count++;
  }
  return count;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

describe("DenoHttpServer", () => {
  describe("serve", () => {
    it("reports the native bound address before accepting requests", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const ac = new AbortController();
      let resolveAddress: (address: { hostname: string; port: number }) => void = () => {};
      const listening = new Promise<{ hostname: string; port: number }>((resolve) => {
        resolveAddress = resolve;
      });

      const servePromise = server.serve(() => new Response("ready"), {
        hostname: "127.0.0.1",
        port: 0,
        signal: ac.signal,
        onListen: resolveAddress,
      });

      const address = await listening;
      assertEquals(address.hostname, "127.0.0.1");
      assert(address.port > 0);

      try {
        const response = await fetch(`http://${address.hostname}:${address.port}`);
        assertEquals(await response.text(), "ready");
      } finally {
        ac.abort();
      }

      await servePromise;
    });

    it("keeps proxy drain tracking until a slow Deno client receives the closed source body", async () => {
      if (!isDeno) return;
      const requestId = "slow-deno-native-finish";
      const tracker = new ProxyRequestDrainTracker();
      const handlerReturned = createDeferred<void>();
      const sourceClosed = createDeferred<void>();
      const transportFinished = createDeferred<void>();
      void transportFinished.promise.catch(() => {});
      const bodyChunk = new Uint8Array(8 * 1024 * 1024).fill(97);
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      let request: Request | undefined;
      let lifetime: ReturnType<typeof getRequestTransportLifetime>;
      let sent = false;
      const server = new DenoHttpServer();
      const servePromise = server.serve((incoming) => {
        request = incoming;
        tracker.start(requestId, incoming.method, new URL(incoming.url).pathname);
        lifetime = getRequestTransportLifetime(incoming);
        void lifetime?.completed?.then(
          () => transportFinished.resolve(),
          transportFinished.reject,
        );
        const response = new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (sent) return;
              sent = true;
              controller.enqueue(bodyChunk);
              controller.close();
              sourceClosed.resolve();
            },
          }),
        );
        const tracked = tracker.completeOnResponseEnd(requestId, incoming, response);
        handlerReturned.resolve();
        return tracked;
      }, {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      const encoder = new TextEncoder();
      await conn.write(
        encoder.encode(
          "GET /slow-native-finish HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        ),
      );

      try {
        await handlerReturned.promise;
        assertStrictEquals(lifetime?.signal, request?.signal);
        const headerRead = await readUntilHeaders(conn);
        await sourceClosed.promise;
        let completedBeforeClientDrain = false;
        void transportFinished.promise.then(() => {
          completedBeforeClientDrain = true;
        });
        await Promise.resolve();

        assertEquals(headerRead.bytesRead > 0, true);
        assertEquals(
          tracker.getInFlightCount(),
          1,
          "source close must not release proxy tracking before Deno native finish",
        );
        assertEquals(completedBeforeClientDrain, false);

        let bytes = headerRead.bodyPayloadBytesRead;
        const buffer = new Uint8Array(64 * 1024);
        while (true) {
          const read = await conn.read(buffer);
          if (read === null) break;
          bytes += countPayloadBytes(buffer.slice(0, read));
        }

        assertEquals(bytes, bodyChunk.byteLength);
        await withTimeout(transportFinished.promise, 1_000, "native Deno response did not finish");
        assertEquals(await tracker.waitForDrain(1_000, 5), true);
        assertEquals(tracker.getInFlightCount(), 0);
        assertEquals(request && getRequestTransportLifetime(request), undefined);
      } finally {
        try {
          conn.close();
        } catch {
          // The close-path assertion already has the evidence it needs.
        }
        await server.close();
        await servePromise;
      }
    });

    it("releases proxy drain tracking when a Deno client disconnects before the handler returns", async () => {
      if (!isDeno) return;
      const requestId = "deno-early-disconnect";
      const tracker = new ProxyRequestDrainTracker();
      const handlerStarted = createDeferred<void>();
      const handlerReturned = createDeferred<void>();
      const requestAborted = createDeferred<void>();
      const transportFinished = createDeferred<"resolved" | "rejected">();
      void transportFinished.promise.catch(() => {});
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      let lifetime: ReturnType<typeof getRequestTransportLifetime>;
      const server = new DenoHttpServer();
      const servePromise = server.serve(async (incoming) => {
        tracker.start(requestId, incoming.method, new URL(incoming.url).pathname);
        lifetime = getRequestTransportLifetime(incoming);
        if (lifetime?.signal.aborted) requestAborted.resolve();
        else {
          lifetime?.signal.addEventListener("abort", () => requestAborted.resolve(), {
            once: true,
          });
        }
        void lifetime?.completed?.then(
          () => transportFinished.resolve("resolved"),
          () => transportFinished.resolve("rejected"),
        );
        handlerStarted.resolve();
        await requestAborted.promise;
        const tracked = tracker.completeOnResponseEnd(
          requestId,
          incoming,
          new Response(new ReadableStream<Uint8Array>()),
        );
        handlerReturned.resolve();
        return tracked;
      }, {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      const encoder = new TextEncoder();
      await conn.write(
        encoder.encode(
          "GET /early-disconnect HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        ),
      );

      try {
        await handlerStarted.promise;
        conn.close();
        await withTimeout(
          requestAborted.promise,
          1_000,
          "Deno request did not abort after client disconnect",
        );
        await handlerReturned.promise;

        assertEquals(lifetime?.signal.aborted, true);
        assertEquals(
          await withTimeout(
            transportFinished.promise,
            1_000,
            "native Deno response completion did not settle after client disconnect",
          ),
          "resolved",
        );
        assertEquals(await tracker.waitForDrain(1_000, 5), true);
        assertEquals(tracker.getInFlightCount(), 0);
      } finally {
        try {
          conn.close();
        } catch {
          // The connection can already be closed by the early-disconnect path.
        }
        await server.close();
        await servePromise;
      }
    });

    it("returns native Response instances from handler", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });

      const responseBody = "hello";
      const handler = () => new Response(responseBody, { status: 200 });

      const servePromise = server.serve(handler, {
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;

      try {
        assertNotEquals(port, 0);
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 200);
        assertEquals(await res.text(), responseBody);
      } finally {
        await server.close();
      }

      await servePromise;
    });

    it("re-wraps non-native Response-like objects as native Response", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });

      // Simulate what dnt does: create a Response-like object that is NOT
      // an instanceof the native Response class.
      const handler = () => {
        const real = new Response("wrapped body", {
          status: 201,
          statusText: "Created",
          headers: { "x-custom": "test" },
        });
        // Create a plain object that mimics Response but fails instanceof
        return Object.create(null, {
          body: { get: () => real.body },
          status: { get: () => real.status },
          statusText: { get: () => real.statusText },
          headers: { get: () => real.headers },
        }) as Response;
      };

      const servePromise = server.serve(handler, {
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      });
      const port = await listening;

      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        assertEquals(res.status, 201);
        assertEquals(res.headers.get("x-custom"), "test");
        assertEquals(await res.text(), "wrapped body");
      } finally {
        await server.close();
      }

      await servePromise;
    });

    it("close owns shutdown even when serve receives an external signal", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const external = new AbortController();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const servePromise = server.serve(
        () => new Response("ok"),
        {
          port: 0,
          signal: external.signal,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      let timeoutId: number | undefined;

      try {
        await server.close();
        const stopped = await Promise.race([
          servePromise.then(() => true),
          new Promise<false>((resolve) => {
            timeoutId = setTimeout(() => resolve(false), 1_000);
          }),
        ]);
        assertEquals(stopped, true);
        assertNotEquals(port, 0);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        external.abort();
        await servePromise;
      }
    });

    it("rejects an already-aborted startup before binding", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));

      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            { port: 0, signal: controller.signal },
          ),
        DOMException,
        "cancelled",
      );
      await server.close();
    });

    it("rejects a startup aborted while binding and cleans up the listener", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      const controller = new AbortController();

      const servePromise = server.serve(
        () => new Response("unreachable"),
        {
          port: 0,
          signal: controller.signal,
          onListen: () => controller.abort(new DOMException("cancelled", "AbortError")),
        },
      );
      await assertRejects(
        () => servePromise,
        DOMException,
        "cancelled",
        "an abort raised while binding must reject serve() with the abort reason",
      );

      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const restarted = server.serve(
        () => new Response("restarted"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      try {
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "restarted",
          "the instance must be reusable after an abort during binding",
        );
      } finally {
        await server.close();
        await restarted;
      }
    });

    it("rejects concurrent serve calls without losing the active listener", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const first = server.serve(
        () => new Response("first"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;

      try {
        await assertRejects(
          () => server.serve(() => new Response("second"), { port: 0 }),
          Error,
          "more than once concurrently",
        );
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "first",
        );
      } finally {
        await server.close();
        await first;
      }
    });

    it("can be reused after an onListen callback fails and cleanup succeeds", async () => {
      if (!isDeno) return;
      const server = new DenoHttpServer();
      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            {
              port: 0,
              onListen: () => {
                throw new Error("listen callback failed");
              },
            },
          ),
        Error,
        "listen callback failed",
      );

      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const servePromise = server.serve(
        () => new Response("restarted"),
        {
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );
      const port = await listening;
      try {
        assertEquals(
          await (await fetch(`http://127.0.0.1:${port}`)).text(),
          "restarted",
        );
      } finally {
        await server.close();
        await servePromise;
      }
    });
  });
});
