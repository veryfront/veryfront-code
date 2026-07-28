import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { Server as NativeHttpServer } from "node:http";
import { NodeHttpServer } from "./node-server.ts";

function listeningPort(
  start: (onListen: (port: number) => void) => Promise<void>,
): { readonly port: Promise<number>; readonly serve: Promise<void> } {
  let resolvePort!: (port: number) => void;
  const port = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  return {
    port,
    serve: start(resolvePort),
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  detail: string,
): Promise<T> {
  let timeoutId: number | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(detail)), milliseconds);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

describe("NodeHttpServer lifecycle", () => {
  it("reports the native ephemeral port and retains the listener after startup", async () => {
    const server = new NodeHttpServer();
    const running = listeningPort((onListen) =>
      server.serve(
        () => new Response("ok"),
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const port = await running.port;
    await running.serve;

    try {
      assertNotEquals(port, 0);
      assertEquals(
        await (await fetch(`http://127.0.0.1:${port}`)).text(),
        "ok",
      );
    } finally {
      await server.close();
      await running.serve;
    }
  });

  it("rejects an already-aborted startup before binding", async () => {
    const server = new NodeHttpServer();
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let listened = false;

    try {
      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            {
              hostname: "127.0.0.1",
              port: 0,
              signal: controller.signal,
              onListen: () => {
                listened = true;
              },
            },
          ),
        DOMException,
        "cancelled",
      );
      assertEquals(listened, false);
    } finally {
      await server.close();
    }
  });

  it("cancels startup when close wins the module-loading race", async () => {
    const server = new NodeHttpServer();
    const serve = server.serve(
      () => new Response("unreachable"),
      { hostname: "127.0.0.1", port: 0 },
    );

    await server.close();
    await assertRejects(
      () => serve,
      DOMException,
      "closed during startup",
    );
  });

  it("rejects a concurrent serve without losing the active listener", async () => {
    const server = new NodeHttpServer();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = listeningPort((onListen) =>
      server.serve(
        () => new Response("first"),
        {
          hostname: "127.0.0.1",
          port: 0,
          signal: firstController.signal,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const firstPort = await first.port;
    const second = server.serve(
      () => new Response("second"),
      {
        hostname: "127.0.0.1",
        port: 0,
        signal: secondController.signal,
      },
    );

    try {
      await assertRejects(
        () => second,
        Error,
        "more than once concurrently",
      );
      assertEquals(
        await (await fetch(`http://127.0.0.1:${firstPort}`)).text(),
        "first",
      );
    } finally {
      firstController.abort();
      secondController.abort();
      await server.close();
      await Promise.allSettled([first.serve, second]);
    }
  });

  it("shares concurrent close calls and remains reusable", async () => {
    const server = new NodeHttpServer();
    const first = listeningPort((onListen) =>
      server.serve(
        () => new Response("first"),
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    await first.port;

    await Promise.all([server.close(), server.close()]);
    await first.serve;
    await server.close();

    const second = listeningPort((onListen) =>
      server.serve(
        () => new Response("second"),
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const secondPort = await second.port;
    try {
      assertEquals(
        await (await fetch(`http://127.0.0.1:${secondPort}`)).text(),
        "second",
      );
    } finally {
      await server.close();
      await second.serve;
    }
  });

  it("cleans up when onListen throws and allows a later start", async () => {
    const server = new NodeHttpServer();
    await assertRejects(
      () =>
        server.serve(
          () => new Response("unreachable"),
          {
            hostname: "127.0.0.1",
            port: 0,
            onListen: () => {
              throw new Error("listener setup failed");
            },
          },
        ),
      Error,
      "listener setup failed",
    );

    const running = listeningPort((onListen) =>
      server.serve(
        () => new Response("recovered"),
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const port = await running.port;
    try {
      assertEquals(
        await (await fetch(`http://127.0.0.1:${port}`)).text(),
        "recovered",
      );
    } finally {
      await server.close();
      await running.serve;
    }
  });

  it("retains a failed startup cleanup owner for an explicit close retry", async () => {
    const startupError = new Error("listener startup failed");
    const cleanupError = new Error("transient startup cleanup failure");
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      NativeHttpServer.prototype,
      "close",
    );
    const originalClose = NativeHttpServer.prototype.close;
    let closeCalls = 0;
    let rawServer: NativeHttpServer | undefined;
    NativeHttpServer.prototype.close = function (
      this: NativeHttpServer,
      callback?: (error?: Error) => void,
    ): NativeHttpServer {
      rawServer = this;
      closeCalls++;
      if (closeCalls <= 2) {
        callback?.(cleanupError);
        return this;
      }
      return Reflect.apply(originalClose, this, [callback]);
    } as typeof originalClose;
    const server = new NodeHttpServer();

    try {
      await assertRejects(
        () =>
          server.serve(
            () => new Response("unreachable"),
            {
              hostname: "127.0.0.1",
              port: 0,
              onListen: () => {
                throw startupError;
              },
            },
          ),
        AggregateError,
        "cleanup remains incomplete",
      );
      assertEquals(closeCalls, 2);

      await server.close();
      await server.close();
      assertEquals(closeCalls, 3);
    } finally {
      if (closeDescriptor) {
        Object.defineProperty(NativeHttpServer.prototype, "close", closeDescriptor);
      } else {
        Reflect.deleteProperty(NativeHttpServer.prototype, "close");
      }
      await server.close();
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          Reflect.apply(originalClose, rawServer, [
            (error?: Error) => error ? reject(error) : resolve(),
          ]);
        });
      }
    }
  });

  it("does not hang when onListen closes the starting server", async () => {
    const server = new NodeHttpServer();
    let close: Promise<void> | undefined;
    const serve = server.serve(
      () => new Response("unreachable"),
      {
        hostname: "127.0.0.1",
        port: 0,
        onListen: () => {
          close = server.close();
        },
      },
    );

    const outcome = await withTimeout(
      Promise.allSettled([serve]),
      2_000,
      "Node HTTP startup did not settle after onListen closed it",
    );
    assertEquals(outcome.length, 1);
    assertExists(close);
    await close;
    await server.close();
  });

  it("owns post-start abort cleanup without mutating the caller signal", async () => {
    const server = new NodeHttpServer();
    const state = server as unknown as { active?: unknown };
    const controller = new AbortController();
    const running = listeningPort((onListen) =>
      server.serve(
        () => new Response("ok"),
        {
          hostname: "127.0.0.1",
          port: 0,
          signal: controller.signal,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    await running.port;
    await running.serve;

    controller.abort(new DOMException("stop serving", "AbortError"));
    await withTimeout(
      (async () => {
        while (state.active !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      })(),
      2_000,
      "Node HTTP server did not release its listener after the serving signal aborted",
    );
    await server.close();
    assertEquals(controller.signal.reason?.message, "stop serving");
  });

  it("preserves status text and distinct Set-Cookie response headers", async () => {
    const server = new NodeHttpServer();
    const running = listeningPort((onListen) =>
      server.serve(
        () => {
          const headers = new Headers();
          headers.append("Set-Cookie", "first=1; Path=/");
          headers.append("Set-Cookie", "second=2; Path=/");
          return new Response("created", {
            status: 201,
            statusText: "Created Here",
            headers,
          });
        },
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const port = await running.port;

    try {
      const http = await import("node:http");
      const result = await new Promise<{
        statusCode: number | undefined;
        statusMessage: string | undefined;
        cookies: string[] | undefined;
      }>((resolve, reject) => {
        const request = http.get(
          `http://127.0.0.1:${port}`,
          (response) => {
            response.resume();
            response.once("end", () => {
              resolve({
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                cookies: response.headers["set-cookie"],
              });
            });
          },
        );
        request.once("error", reject);
      });

      assertEquals(result.statusCode, 201);
      assertEquals(
        result.statusMessage,
        isDeno ? "Created" : "Created Here",
      );
      assertEquals(result.cookies, [
        "first=1; Path=/",
        "second=2; Path=/",
      ]);
    } finally {
      await server.close();
      await running.serve;
    }
  });

  it("aborts the Fetch request and cancels its response body on disconnect", async () => {
    const server = new NodeHttpServer();
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const largeChunk = new Uint8Array(1024 * 1024);

    const running = listeningPort((onListen) =>
      server.serve(
        (request) => {
          observedSignal = request.signal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(largeChunk);
              },
              pull() {
                return new Promise<void>(() => {});
              },
              cancel() {
                resolveCancelled();
              },
            }),
          );
        },
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => onListen(port),
        },
      )
    );
    const port = await running.port;

    try {
      const http = await import("node:http");
      await new Promise<void>((resolve, reject) => {
        const request = http.get(
          `http://127.0.0.1:${port}`,
          (response) => {
            response.once("data", () => {
              response.destroy();
              resolve();
            });
          },
        );
        request.once("error", reject);
      });
      await withTimeout(
        cancelled,
        2_000,
        "Node HTTP response body was not cancelled after disconnect",
      );
      assertExists(observedSignal);
      assertEquals(observedSignal.aborted, true);
    } finally {
      await server.close();
      await running.serve;
    }
  });
});
