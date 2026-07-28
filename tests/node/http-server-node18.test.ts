import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import dns from "node:dns";
import { createServer, type Server as NativeHttpServer } from "node:http";
import process from "node:process";
import { createNodeServerWithStartupOwner } from "../../src/platform/adapters/runtime/node/http-server.ts";

if (process.versions.node !== "18.18.0") {
  throw new Error(
    `Minimum-Node regressions require Node 18.18.0, received ${process.versions.node}`,
  );
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

function rawHttpTransport(server: object): NativeHttpServer {
  return (server as { server: NativeHttpServer }).server;
}

function delayNodeLookup(hostname: string): {
  started: Promise<void>;
  release: (address: string) => void;
  restore: () => void;
} {
  const descriptor = Object.getOwnPropertyDescriptor(dns, "lookup");
  const originalLookup = dns.lookup;
  const lookupStarted = createDeferred<void>();
  let delayedCallback:
    | ((error: Error | null, address: string, family: number) => void)
    | undefined;

  Object.defineProperty(dns, "lookup", {
    ...descriptor,
    configurable: true,
    writable: true,
    value: function (...args: unknown[]): unknown {
      if (args[0] !== hostname) {
        return Reflect.apply(originalLookup, dns, args);
      }
      const callback = typeof args[1] === "function" ? args[1] : args[2];
      if (typeof callback !== "function") {
        throw new TypeError("Expected Node's listener lookup callback");
      }
      delayedCallback = callback as typeof delayedCallback;
      lookupStarted.resolve();
      return undefined;
    },
  });

  return {
    started: lookupStarted.promise,
    release: (address) => {
      const callback = delayedCallback;
      if (!callback) throw new Error(`Lookup for ${hostname} has not started`);
      delayedCallback = undefined;
      callback(null, address, 4);
    },
    restore: () => {
      if (descriptor) Object.defineProperty(dns, "lookup", descriptor);
      else Object.defineProperty(dns, "lookup", { value: originalLookup, writable: true });
    },
  };
}

describe("Node 18.18 HTTP startup cancellation", () => {
  it("retires a listener that binds after startup cancellation", async () => {
    const delayedLookup = delayNodeLookup("delayed-listen.veryfront.invalid");
    const controller = new AbortController();
    const abortReason = new Error("cancel delayed hostname lookup");
    let rawServer: NativeHttpServer | undefined;
    let rejection: unknown;
    try {
      const startup = createNodeServerWithStartupOwner(
        () => new Response("unreachable"),
        {
          hostname: "delayed-listen.veryfront.invalid",
          port: 0,
          signal: controller.signal,
        },
        (server) => {
          rawServer = rawHttpTransport(server);
        },
      );
      await delayedLookup.started;
      controller.abort(abortReason);
      try {
        await startup;
      } catch (error) {
        rejection = error;
      }
      assertStrictEquals(rejection, abortReason);
      assertEquals(rawServer?.listening, false);

      if (!rawServer) throw new Error("Node startup owner was not published");
      const lateClose = createDeferred<void>();
      rawServer.once("close", () => lateClose.resolve());
      delayedLookup.release("127.0.0.1");
      await withTimeout(
        lateClose.promise,
        1_000,
        "Node 18 listener remained live after its delayed lookup completed",
      );
      assertEquals(rawServer.listening, false);
      assertEquals(rawServer.address(), null);
    } finally {
      delayedLookup.restore();
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          rawServer?.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  });

  it("owns a bind error that arrives after startup cancellation", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    if (address === null || typeof address === "string") {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      throw new Error("Expected an IPv4 blocker listener");
    }

    const delayedLookup = delayNodeLookup("delayed-error.veryfront.invalid");
    const controller = new AbortController();
    const abortReason = new Error("cancel lookup before bind error");
    const lateError = createDeferred<Error>();
    let rawServer: NativeHttpServer | undefined;
    let runtimeReports = 0;
    let rejection: unknown;
    let ownedErrorListeners = -1;

    try {
      const startup = createNodeServerWithStartupOwner(
        () => new Response("unreachable"),
        {
          hostname: "delayed-error.veryfront.invalid",
          port: address.port,
          signal: controller.signal,
          onRuntimeError: () => {
            runtimeReports++;
          },
        },
        (server) => {
          rawServer = rawHttpTransport(server);
        },
      );
      await delayedLookup.started;
      controller.abort(abortReason);
      try {
        await startup;
      } catch (error) {
        rejection = error;
      }
      assertStrictEquals(rejection, abortReason);
      if (!rawServer) throw new Error("Node startup owner was not published");

      ownedErrorListeners = rawServer.listenerCount("error");
      rawServer.once("error", (error) => lateError.resolve(error));
      delayedLookup.release("127.0.0.1");
      const emittedError = await withTimeout(
        lateError.promise,
        1_000,
        "Node 18 did not finish the delayed bind attempt",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(ownedErrorListeners, 1);
      assertEquals((emittedError as Error & { code?: string }).code, "EADDRINUSE");
      assertEquals(runtimeReports, 0);
      assertEquals(rawServer.listenerCount("error"), 0);
      assertEquals(rawServer.listening, false);
    } finally {
      delayedLookup.restore();
      if (rawServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          rawServer?.close((error) => error ? reject(error) : resolve());
        });
      }
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
