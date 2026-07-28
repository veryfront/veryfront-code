import { assertEquals, assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
import {
  createVeryfrontServer,
  startNodeVeryfrontServer,
  startVeryfrontServer,
} from "./service-server.ts";
import { ServerStartupCleanupError } from "./startup-cleanup-error.ts";

Deno.test("createVeryfrontServer dispatches to the first module response", async () => {
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "miss",
        handle: () => null,
      },
      {
        name: "hit",
        handle: () => new Response("ok", { status: 201 }),
      },
    ],
  });

  const response = await runtime.fetch(new Request("http://localhost/test"));

  assertEquals(response.status, 201);
  assertEquals(await response.text(), "ok");
});

Deno.test("createVeryfrontServer returns a default 404 when no module handles the request", async () => {
  const runtime = createVeryfrontServer({
    modules: [{ name: "empty", handle: () => null }],
  });

  const response = await runtime.fetch(new Request("http://localhost/missing"));

  assertEquals(response.status, 404);
  assertEquals(await response.text(), "Not Found");
});

Deno.test("createVeryfrontServer fans out shutdown state and stop hooks", async () => {
  const events: string[] = [];
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "first",
        handle: () => null,
        setShuttingDown: () => events.push("first:shutdown"),
        stop: () => {
          events.push("first:stop");
        },
      },
      {
        name: "second",
        handle: () => null,
        setShuttingDown: () => events.push("second:shutdown"),
        stop: async () => {
          events.push("second:stop");
        },
      },
    ],
  });

  runtime.setShuttingDown();
  await runtime.stop();

  assertEquals(events, ["first:shutdown", "second:shutdown", "first:stop", "second:stop"]);
});

Deno.test("createVeryfrontServer retries only failed module shutdown notifications", () => {
  const transientFailure = new Error("first shutdown notification failed");
  let firstCalls = 0;
  let secondCalls = 0;
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "first",
        handle: () => null,
        setShuttingDown: () => {
          firstCalls++;
          if (firstCalls === 1) throw transientFailure;
        },
      },
      {
        name: "second",
        handle: () => null,
        setShuttingDown: () => {
          secondCalls++;
        },
      },
    ],
  });

  let received: unknown;
  try {
    runtime.setShuttingDown();
  } catch (error) {
    received = error;
  }

  assertInstanceOf(received, AggregateError);
  assertEquals(received.errors, [transientFailure]);
  assertEquals([firstCalls, secondCalls], [1, 1]);

  runtime.setShuttingDown();
  runtime.setShuttingDown();
  assertEquals([firstCalls, secondCalls], [2, 1]);
});

Deno.test("createVeryfrontServer shares module cleanup and retries only failed hooks", async () => {
  const firstAttemptStarted = Promise.withResolvers<void>();
  const releaseFirstAttempt = Promise.withResolvers<void>();
  const transientFailure = new Error("first module cleanup failed");
  let firstCalls = 0;
  let secondCalls = 0;
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "first",
        handle: () => null,
        stop: async () => {
          firstCalls++;
          if (firstCalls !== 1) return;
          firstAttemptStarted.resolve();
          await releaseFirstAttempt.promise;
          throw transientFailure;
        },
      },
      {
        name: "second",
        handle: () => null,
        stop: () => {
          secondCalls++;
        },
      },
    ],
  });

  const first = runtime.stop();
  await firstAttemptStarted.promise;
  const concurrent = runtime.stop();
  releaseFirstAttempt.resolve();
  const [firstResult, concurrentResult] = await Promise.allSettled([first, concurrent]);

  assertStrictEquals(first, concurrent);
  assertEquals(firstResult.status, "rejected");
  assertEquals(concurrentResult.status, "rejected");
  if (firstResult.status !== "rejected") throw new Error("Expected module cleanup to reject");
  assertInstanceOf(firstResult.reason, AggregateError);
  assertEquals(firstResult.reason.errors, [transientFailure]);
  assertEquals([firstCalls, secondCalls], [1, 1]);

  await runtime.stop();
  await runtime.stop();
  assertEquals([firstCalls, secondCalls], [2, 1]);
});

Deno.test("startVeryfrontServer starts the current runtime fetch server", async () => {
  const events: string[] = [];
  const runtime = createVeryfrontServer({
    modules: [{
      name: "test",
      handle: () => new Response("served"),
      setShuttingDown: () => events.push("shutdown"),
      stop: () => {
        events.push("stop");
      },
    }],
  });
  const server = await startVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
  });

  try {
    const response = await fetch(server.url);

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "served");
    assertEquals(server.runtime, "deno");
  } finally {
    await server.stop();
  }

  assertEquals(events, ["shutdown", "stop"]);
});

Deno.test("startVeryfrontServer shares and retries current-runtime cleanup", async () => {
  const transientFailure = new Error("current runtime cleanup failed");
  let shutdownCalls = 0;
  let stopCalls = 0;
  const runtime = {
    fetch: () => new Response("served"),
    setShuttingDown: () => {
      shutdownCalls++;
    },
    stop: async () => {
      stopCalls++;
      if (stopCalls === 1) throw transientFailure;
    },
  };
  const handle = await startVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });

  const first = handle.stop();
  const concurrent = handle.stop();
  const [firstResult, concurrentResult] = await Promise.allSettled([first, concurrent]);

  assertStrictEquals(first, concurrent);
  assertEquals(firstResult.status, "rejected");
  assertEquals(concurrentResult.status, "rejected");
  if (firstResult.status !== "rejected") throw new Error("Expected runtime cleanup to reject");
  assertInstanceOf(firstResult.reason, AggregateError);
  assertEquals(firstResult.reason.errors, [transientFailure]);
  assertEquals([shutdownCalls, stopCalls], [1, 1]);

  await handle.stop();
  await handle.stop();
  assertEquals([shutdownCalls, stopCalls], [1, 2]);
});

Deno.test("startNodeVeryfrontServer reports the actual bound port after readiness", async () => {
  const runtime = createVeryfrontServer({
    modules: [{ name: "test", handle: () => new Response("served") }],
  });
  const handle = await startNodeVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });

  try {
    await handle.ready;
    const address = handle.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a bound TCP address");
    }

    assertEquals(handle.port, address.port);
    assertEquals(handle.url, `http://127.0.0.1:${address.port}`);
    const response = await fetch(handle.url);
    assertEquals(await response.text(), "served");
  } finally {
    await handle.stop();
  }
});

Deno.test("startNodeVeryfrontServer rejects readiness when stopped before binding", async () => {
  const process = (await import("node:process")).default;
  const signal = "SIGUSR2" as const;
  const initialSignalListeners = process.listenerCount(signal);
  let shutdownCalls = 0;
  let runtimeStopCalls = 0;
  const handle = await startNodeVeryfrontServer({
    runtime: {
      fetch: () => new Response("unreachable"),
      setShuttingDown: () => {
        shutdownCalls++;
      },
      stop: () => {
        runtimeStopCalls++;
        return Promise.resolve();
      },
    },
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [signal],
  });

  try {
    assertEquals(process.listenerCount(signal), initialSignalListeners + 1);

    const firstStop = handle.stop();
    const concurrentStop = handle.stop();
    assertStrictEquals(firstStop, concurrentStop);
    await firstStop;

    let readyError: unknown;
    try {
      await handle.ready;
    } catch (error) {
      readyError = error;
    }

    assertInstanceOf(readyError, Error);
    assertEquals(
      readyError.message,
      "Veryfront Node service server stopped before readiness",
    );
    assertEquals(handle.server.listening, false);
    const retainedErrorListeners = handle.server.listeners("error");
    assertEquals(retainedErrorListeners.length, 1);
    assertEquals(retainedErrorListeners[0]?.name, "absorbCanceledNodeListenError");
    assertEquals(handle.server.listenerCount("close"), 0);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
    assertEquals([shutdownCalls, runtimeStopCalls], [1, 1]);
    assertStrictEquals(handle.stop(), firstStop);
  } finally {
    await handle.stop().catch(() => undefined);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
  }
});

Deno.test("startNodeVeryfrontServer removes readiness listeners when listen throws", async () => {
  const process = (await import("node:process")).default;
  const signal = "SIGUSR2" as const;
  const initialSignalListeners = process.listenerCount(signal);
  let shutdownCalls = 0;
  let runtimeStopCalls = 0;
  const handle = await startNodeVeryfrontServer({
    runtime: {
      fetch: () => new Response("unreachable"),
      setShuttingDown: () => {
        shutdownCalls++;
      },
      stop: () => {
        runtimeStopCalls++;
        return Promise.resolve();
      },
    },
    port: -1,
    bindAddress: "127.0.0.1",
    signals: [signal],
  });

  try {
    let readyError: unknown;
    try {
      await handle.ready;
    } catch (error) {
      readyError = error;
    }

    assertInstanceOf(readyError, RangeError);
    assertEquals(Reflect.get(readyError, "code"), "ERR_SOCKET_BAD_PORT");
    assertEquals(handle.server.listenerCount("error"), 0);
    assertEquals(handle.server.listenerCount("close"), 0);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
    assertEquals([shutdownCalls, runtimeStopCalls], [1, 1]);

    const stopped = handle.stop();
    await stopped;
    assertStrictEquals(handle.stop(), stopped);
  } finally {
    await handle.stop().catch(() => undefined);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
  }
});

Deno.test("startNodeVeryfrontServer cleans up an occupied-port readiness failure", async () => {
  const occupied = await startNodeVeryfrontServer({
    runtime: createVeryfrontServer({ modules: [] }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });
  await occupied.ready;

  const process = (await import("node:process")).default;
  const signal = "SIGUSR2" as const;
  const initialSignalListeners = process.listenerCount(signal);
  let shutdownCalls = 0;
  let runtimeStopCalls = 0;
  let failed:
    | Awaited<ReturnType<typeof startNodeVeryfrontServer>>
    | undefined;

  try {
    failed = await startNodeVeryfrontServer({
      runtime: {
        fetch: () => new Response("unreachable"),
        setShuttingDown: () => {
          shutdownCalls++;
        },
        stop: () => {
          runtimeStopCalls++;
          return Promise.resolve();
        },
      },
      port: occupied.port,
      bindAddress: "127.0.0.1",
      signals: [signal],
    });

    let emittedStartupError: unknown;
    failed.server.once("error", (error) => {
      emittedStartupError = error;
    });

    let received: unknown;
    try {
      await failed.ready;
    } catch (error) {
      received = error;
    }

    assertInstanceOf(received, Error);
    assertStrictEquals(received, emittedStartupError);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
    assertEquals([shutdownCalls, runtimeStopCalls], [1, 1]);
    assertEquals(failed.server.listening, false);

    const firstStop = failed.stop();
    const concurrentStop = failed.stop();
    assertStrictEquals(firstStop, concurrentStop);
    await firstStop;
    assertStrictEquals(failed.stop(), firstStop);
    assertEquals([shutdownCalls, runtimeStopCalls], [1, 1]);
  } finally {
    await failed?.stop().catch(() => undefined);
    await occupied.stop();
    assertEquals(process.listenerCount(signal), initialSignalListeners);
  }
});

Deno.test(
  "startNodeVeryfrontServer exposes retryable cleanup when occupied-port cleanup fails",
  async () => {
    const occupied = await startNodeVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });
    await occupied.ready;

    const process = (await import("node:process")).default;
    const signal = "SIGUSR2" as const;
    const initialSignalListeners = process.listenerCount(signal);
    const transientCleanupError = new Error("runtime cleanup failed");
    let shutdownCalls = 0;
    let runtimeStopCalls = 0;
    let failed:
      | Awaited<ReturnType<typeof startNodeVeryfrontServer>>
      | undefined;

    try {
      failed = await startNodeVeryfrontServer({
        runtime: {
          fetch: () => new Response("unreachable"),
          setShuttingDown: () => {
            shutdownCalls++;
          },
          stop: () => {
            runtimeStopCalls++;
            return runtimeStopCalls === 1
              ? Promise.reject(transientCleanupError)
              : Promise.resolve();
          },
        },
        port: occupied.port,
        bindAddress: "127.0.0.1",
        signals: [signal],
      });

      let emittedStartupError: unknown;
      failed.server.once("error", (error) => {
        emittedStartupError = error;
      });

      let received: unknown;
      try {
        await failed.ready;
      } catch (error) {
        received = error;
      }

      assertInstanceOf(received, ServerStartupCleanupError);
      assertStrictEquals(received.errors[0], emittedStartupError);
      assertInstanceOf(received.errors[1], AggregateError);
      assertEquals(received.errors[1].errors, [transientCleanupError]);
      assertStrictEquals(received.retryCleanup, failed.stop);
      assertEquals(process.listenerCount(signal), initialSignalListeners);
      assertEquals([shutdownCalls, runtimeStopCalls], [1, 1]);
      assertEquals(failed.server.listening, false);

      const retry = received.retryCleanup();
      const concurrentRetry = failed.stop();
      assertStrictEquals(retry, concurrentRetry);
      await retry;
      assertStrictEquals(failed.stop(), retry);
      assertEquals([shutdownCalls, runtimeStopCalls], [1, 2]);
    } finally {
      await failed?.stop().catch(() => undefined);
      await occupied.stop();
      assertEquals(process.listenerCount(signal), initialSignalListeners);
    }
  },
);

Deno.test("startNodeVeryfrontServer aggregates listener and runtime failures for retry", async () => {
  const transientListenerFailure = new Error("listener cleanup failed");
  const transientRuntimeFailure = new Error("runtime cleanup failed");
  let shutdownCalls = 0;
  let runtimeStopCalls = 0;
  const runtime = {
    fetch: () => new Response("served"),
    setShuttingDown: () => {
      shutdownCalls++;
    },
    stop: async () => {
      runtimeStopCalls++;
      if (runtimeStopCalls === 1) throw transientRuntimeFailure;
    },
  };
  const process = (await import("node:process")).default;
  const signal = "SIGUSR2" as const;
  const initialSignalListeners = process.listenerCount(signal);
  const handle = await startNodeVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [signal],
  });
  await handle.ready;
  assertEquals(process.listenerCount(signal), initialSignalListeners + 1);

  const originalClose = handle.server.close;
  let listenerStopCalls = 0;
  handle.server.close = ((callback?: (error?: Error) => void) => {
    listenerStopCalls++;
    if (listenerStopCalls === 1) {
      queueMicrotask(() => callback?.(transientListenerFailure));
      return handle.server;
    }
    return Reflect.apply(originalClose, handle.server, [callback]);
  }) as typeof handle.server.close;

  try {
    const first = handle.stop();
    const concurrent = handle.stop();
    const [firstResult, concurrentResult] = await Promise.allSettled([first, concurrent]);

    assertStrictEquals(first, concurrent);
    assertEquals(firstResult.status, "rejected");
    assertEquals(concurrentResult.status, "rejected");
    if (firstResult.status !== "rejected") throw new Error("Expected server cleanup to reject");
    assertInstanceOf(firstResult.reason, AggregateError);
    assertEquals(firstResult.reason.errors, [
      transientListenerFailure,
      transientRuntimeFailure,
    ]);
    assertEquals([shutdownCalls, listenerStopCalls, runtimeStopCalls], [1, 1, 1]);
    assertEquals(process.listenerCount(signal), initialSignalListeners);

    await handle.stop();
    await handle.stop();
    assertEquals([shutdownCalls, listenerStopCalls, runtimeStopCalls], [1, 2, 2]);
    assertEquals(process.listenerCount(signal), initialSignalListeners);
    assertEquals(handle.server.listening, false);
  } finally {
    handle.server.close = originalClose;
    if (handle.server.listening) {
      await new Promise<void>((resolve, reject) => {
        Reflect.apply(originalClose, handle.server, [
          (error?: Error) => error ? reject(error) : resolve(),
        ]);
      });
    }
  }
});
