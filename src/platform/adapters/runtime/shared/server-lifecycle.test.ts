import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { RuntimeRequestHandler } from "../../base.ts";
import {
  createServeHandler,
  createServerLifecycle,
  stopManagedServer,
} from "./server-lifecycle.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("platform/adapters/runtime/shared/server-lifecycle", () => {
  describe("createServeHandler", () => {
    it("should create a handler that calls createServer and setActive", async () => {
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 3000 },
      };

      let setActiveCalled = false;
      let capturedServer: unknown = null;

      const createServer = async (
        _handler: RuntimeRequestHandler,
        _options: unknown,
      ) => {
        return fakeServer;
      };

      const setActive = (server: unknown) => {
        setActiveCalled = true;
        capturedServer = server;
      };

      const serve = createServeHandler(createServer, setActive);
      const handler = (_req: Request) => new Response("ok");
      const server = await serve(handler);

      assertEquals(server, fakeServer);
      assertEquals(setActiveCalled, true);
      assertEquals(capturedServer, fakeServer);
    });

    it("should pass options to createServer", async () => {
      let receivedOptions: unknown = null;
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 8080 },
      };

      const createServer = async (_handler: unknown, options: unknown) => {
        receivedOptions = options;
        return fakeServer;
      };

      const serve = createServeHandler(createServer, () => {});
      await serve((_req: Request) => new Response("ok"), { port: 8080 });

      assertEquals((receivedOptions as { port: number }).port, 8080);
    });

    it("should default options to empty object", async () => {
      let receivedOptions: unknown = null;
      const fakeServer = {
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 3000 },
      };

      const createServer = async (_handler: unknown, options: unknown) => {
        receivedOptions = options;
        return fakeServer;
      };

      const serve = createServeHandler(createServer, () => {});
      await serve((_req: Request) => new Response("ok"));

      assertEquals(receivedOptions, {});
    });
  });

  describe("stopManagedServer", () => {
    it("should return null when server is null", async () => {
      const result = await stopManagedServer(null);
      assertEquals(result, null);
    });

    it("should call stop() and return null", async () => {
      let stopCalled = false;
      const fakeServer = {
        stop: async () => {
          stopCalled = true;
        },
        addr: { hostname: "localhost", port: 3000 },
      };

      const result = await stopManagedServer(fakeServer);
      assertEquals(result, null);
      assertEquals(stopCalled, true);
    });
  });

  describe("createServerLifecycle", () => {
    it("rejects a second start while a server is running", async () => {
      const server = {
        addr: { hostname: "localhost", port: 3000 },
        stop: () => Promise.resolve(),
      };
      const lifecycle = createServerLifecycle(() => Promise.resolve(server));
      await lifecycle.serve(() => new Response("ok"));

      try {
        await lifecycle.serve(() => new Response("other"));
        throw new Error("Expected the second start to fail");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, "server-start-error");
      } finally {
        await lifecycle.shutdown();
      }
    });

    it("rejects a concurrent second start before the factory settles", async () => {
      const pending = deferred<{
        addr: { hostname: string; port: number };
        stop: () => Promise<void>;
      }>();
      const lifecycle = createServerLifecycle(() => pending.promise);
      const first = lifecycle.serve(() => new Response("first"));

      try {
        await lifecycle.serve(() => new Response("second"));
        throw new Error("Expected the concurrent start to fail");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
      }

      pending.resolve({
        addr: { hostname: "localhost", port: 3000 },
        stop: () => Promise.resolve(),
      });
      await first;
      await lifecycle.shutdown();
    });

    it("waits for a pending start and stops the created server during shutdown", async () => {
      const pending = deferred<{
        addr: { hostname: string; port: number };
        stop: () => Promise<void>;
      }>();
      let stopCalls = 0;
      const lifecycle = createServerLifecycle(() => pending.promise);
      const starting = lifecycle.serve(() => new Response("ok"));
      const shuttingDown = lifecycle.shutdown();

      pending.resolve({
        addr: { hostname: "localhost", port: 3000 },
        stop: async () => {
          stopCalls++;
        },
      });
      await starting;
      await shuttingDown;

      assertEquals(stopCalls, 1);
      assertEquals(lifecycle.state, "idle");
    });

    it("coalesces concurrent shutdown calls", async () => {
      let stopCalls = 0;
      const finishStop = deferred<void>();
      const lifecycle = createServerLifecycle(() =>
        Promise.resolve({
          addr: { hostname: "localhost", port: 3000 },
          stop: async () => {
            stopCalls++;
            await finishStop.promise;
          },
        })
      );
      await lifecycle.serve(() => new Response("ok"));

      const first = lifecycle.shutdown();
      const second = lifecycle.shutdown();
      await Promise.resolve();
      assertEquals(stopCalls, 1);
      finishStop.resolve();
      await Promise.all([first, second]);
      assertEquals(stopCalls, 1);
    });

    it("returns to idle when the returned server is stopped directly", async () => {
      let stopCalls = 0;
      const lifecycle = createServerLifecycle(() =>
        Promise.resolve({
          addr: { hostname: "localhost", port: 3000 },
          stop: async () => {
            stopCalls++;
          },
        })
      );
      const server = await lifecycle.serve(() => new Response("ok"));

      await server.stop();

      assertEquals(stopCalls, 1);
      assertEquals(lifecycle.state, "idle");
    });

    it("owns external aborts, including aborts during startup", async () => {
      const pending = deferred<{
        addr: { hostname: string; port: number };
        stop: () => Promise<void>;
      }>();
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      const lifecycle = createServerLifecycle((_handler, options) => {
        receivedSignal = options.signal;
        options.signal?.addEventListener(
          "abort",
          () => pending.reject(options.signal?.reason),
          { once: true },
        );
        return pending.promise;
      });
      const starting = lifecycle.serve(() => new Response("ok"), {
        signal: controller.signal,
      });

      await Promise.resolve();
      controller.abort();
      if (!receivedSignal) pending.reject(new Error("Factory did not receive the abort signal"));

      try {
        await starting;
        throw new Error("Expected startup to abort");
      } catch {
        // The factory must reject when the shared signal aborts.
      }
      await lifecycle.shutdown();

      assertEquals(receivedSignal === controller.signal, true);
      assertEquals(lifecycle.state, "idle");
    });

    it("returns to idle after a failed start", async () => {
      let calls = 0;
      const lifecycle = createServerLifecycle(() => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("start failed"));
        return Promise.resolve({
          addr: { hostname: "localhost", port: 3000 },
          stop: () => Promise.resolve(),
        });
      });

      try {
        await lifecycle.serve(() => new Response("first"));
      } catch {
        // Expected startup failure.
      }
      await lifecycle.serve(() => new Response("second"));
      assertEquals(lifecycle.state, "running");
      await lifecycle.shutdown();
    });
  });
});
