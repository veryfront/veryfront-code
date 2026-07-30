import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
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

Deno.test("createVeryfrontServer still returns 500 when an injected logger throws", async () => {
  const runtime = createVeryfrontServer({
    modules: [{
      name: "broken",
      handle: () => {
        throw new Error("request failed");
      },
    }],
    logger: {
      error: () => {
        throw new Error("logger failed");
      },
    },
  });

  const response = await runtime.fetch(new Request("http://localhost/failure"));

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "Internal Server Error");
});

Deno.test("createVeryfrontServer contains hostile thrown values while returning 500", async () => {
  const inspectionError = new Error("hostile error inspection");
  const hostileThrownValue = new Proxy(Object.create(null), {
    get: () => {
      throw inspectionError;
    },
    getPrototypeOf: () => {
      throw inspectionError;
    },
  });
  const runtime = createVeryfrontServer({
    modules: [{
      name: "broken",
      handle: () => {
        throw hostileThrownValue;
      },
    }],
  });

  const response = await runtime.fetch(new Request("http://localhost/hostile-failure"));

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "Internal Server Error");
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

  assertStrictEquals(received, transientFailure);
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
  assertStrictEquals(firstResult.reason, transientFailure);
  assertEquals([firstCalls, secondCalls], [1, 1]);

  await runtime.stop();
  await runtime.stop();
  assertEquals([firstCalls, secondCalls], [2, 1]);
});

Deno.test("createVeryfrontServer publishes cleanup ownership before reentrant hooks run", async () => {
  let nestedStop: Promise<void> | undefined;
  let stopCalls = 0;
  const runtime = createVeryfrontServer({
    modules: [{
      name: "reentrant",
      handle: () => null,
      stop: () => {
        stopCalls++;
        nestedStop = runtime.stop();
      },
    }],
  });

  const outerStop = runtime.stop();
  await outerStop;

  assertStrictEquals(nestedStop, outerStop);
  assertEquals(stopCalls, 1);
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
  assertStrictEquals(firstResult.reason, transientFailure);
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
      assertStrictEquals(received.errors[1], transientCleanupError);
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

Deno.test("Deno service shutdown runs runtime stop when server shutdown rejects", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const shutdownError = new Error("deno shutdown failed");
  const events: string[] = [];

  denoRuntime.serve = (() => ({
    addr: { port: 3210 },
    shutdown: () => {
      events.push("server-shutdown");
      return Promise.reject(shutdownError);
    },
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = (() => {}) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {}) as typeof Deno.removeSignalListener;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });

    const rejected = await assertRejects(() => server.stop(), Error, "deno shutdown failed");

    assertStrictEquals(rejected, shutdownError);
    assertEquals(events, ["runtime-shutdown", "server-shutdown", "runtime-stop"]);
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
  }
});

Deno.test("Deno startup exposes retryable cleanup when serve and runtime cleanup fail", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
  };
  const originalServe = denoRuntime.serve;
  const startupError = new Error("deno serve failed");
  const cleanupError = new Error("deno runtime cleanup failed");
  const events: string[] = [];
  let stopCalls = 0;

  denoRuntime.serve = (() => {
    throw startupError;
  }) as unknown as typeof Deno.serve;

  try {
    let received: unknown;
    try {
      await startVeryfrontServer({
        runtime: {
          fetch: () => new Response("unreachable"),
          setShuttingDown: () => events.push("runtime-shutdown"),
          stop: () => {
            stopCalls++;
            events.push("runtime-stop");
            return stopCalls === 1 ? Promise.reject(cleanupError) : Promise.resolve();
          },
        },
        port: 0,
        bindAddress: "127.0.0.1",
        signals: [],
      });
    } catch (error) {
      received = error;
    }

    assertInstanceOf(received, ServerStartupCleanupError);
    assertStrictEquals(received.errors[0], startupError);
    assertStrictEquals(received.errors[1], cleanupError);
    assertEquals(events, ["runtime-shutdown", "runtime-stop"]);

    const retry = received.retryCleanup();
    const concurrentRetry = received.retryCleanup();
    assertStrictEquals(retry, concurrentRetry);
    await retry;
    assertEquals(events, ["runtime-shutdown", "runtime-stop", "runtime-stop"]);
    assertStrictEquals(received.retryCleanup(), retry);
  } finally {
    denoRuntime.serve = originalServe;
  }
});

Deno.test("Deno invalid listener cleanup owns shutdown before validating metadata", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
  };
  const originalServe = denoRuntime.serve;
  const events: string[] = [];

  denoRuntime.serve = (() => ({
    shutdown: () => events.push("server-shutdown"),
    addr: { port: "invalid" },
  })) as unknown as typeof Deno.serve;

  try {
    await assertRejects(
      () =>
        startVeryfrontServer({
          runtime: {
            fetch: () => new Response("unreachable"),
            setShuttingDown: () => events.push("runtime-shutdown"),
            stop: () => {
              events.push("runtime-stop");
              return Promise.resolve();
            },
          },
          port: 0,
          bindAddress: "127.0.0.1",
          signals: [],
        }),
      TypeError,
      "invalid listener port",
    );

    assertEquals(events, ["runtime-shutdown", "server-shutdown", "runtime-stop"]);
  } finally {
    denoRuntime.serve = originalServe;
  }
});

Deno.test("Deno abort fallback owns finished before validating listener metadata", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
  };
  const originalServe = denoRuntime.serve;
  const metadataError = new Error("deno address metadata failed");
  const aborted = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const events: string[] = [];
  let runtimeStopCalls = 0;

  denoRuntime.serve = ((options: Deno.ServeTcpOptions) => {
    options.signal?.addEventListener("abort", () => {
      events.push("listener-abort");
      aborted.resolve();
    }, { once: true });
    return {
      finished: finished.promise,
      get addr(): never {
        throw metadataError;
      },
    };
  }) as unknown as typeof Deno.serve;

  try {
    const rejection = assertRejects(
      () =>
        startVeryfrontServer({
          runtime: {
            fetch: () => new Response("unreachable"),
            setShuttingDown: () => events.push("runtime-shutdown"),
            stop: () => {
              runtimeStopCalls++;
              events.push("runtime-stop");
              return Promise.resolve();
            },
          },
          port: 0,
          bindAddress: "127.0.0.1",
          signals: [],
        }),
      Error,
      "deno address metadata failed",
    );

    await aborted.promise;
    await Promise.resolve();
    assertEquals(runtimeStopCalls, 0);

    finished.resolve();
    const received = await rejection;
    assertStrictEquals(received, metadataError);
    assertEquals(events, ["runtime-shutdown", "listener-abort", "runtime-stop"]);
  } finally {
    finished.resolve();
    denoRuntime.serve = originalServe;
  }
});

Deno.test("Deno signal installation failure cleans the listener and runtime", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const signalError = new Error("signal installation failed");
  const events: string[] = [];

  denoRuntime.serve = (() => ({
    addr: { port: 3217 },
    shutdown: () => events.push("server-shutdown"),
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = (() => {
    throw signalError;
  }) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {
    events.push("signal-remove");
  }) as typeof Deno.removeSignalListener;

  try {
    let received: unknown;
    try {
      await startVeryfrontServer({
        runtime: {
          fetch: () => new Response("unreachable"),
          setShuttingDown: () => events.push("runtime-shutdown"),
          stop: () => {
            events.push("runtime-stop");
            return Promise.resolve();
          },
        },
        port: 0,
        bindAddress: "127.0.0.1",
        signals: ["SIGTERM"],
      });
    } catch (error) {
      received = error;
    }

    assertStrictEquals(received, signalError);
    assertEquals(events, ["runtime-shutdown", "server-shutdown", "runtime-stop"]);
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
  }
});

Deno.test("Deno service shutdown preserves undefined transport rejection", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const events: string[] = [];

  denoRuntime.serve = (() => ({
    addr: { port: 3212 },
    shutdown: () => {
      events.push("server-shutdown");
      return Promise.reject(undefined);
    },
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = (() => {}) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {}) as typeof Deno.removeSignalListener;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });

    let rejected: unknown = "not-thrown";
    try {
      await server.stop();
    } catch (error) {
      rejected = error;
    }

    assertStrictEquals(rejected, undefined);
    assertEquals(events, ["runtime-shutdown", "server-shutdown", "runtime-stop"]);
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
  }
});

Deno.test("Deno service shutdown preserves and retries undefined signal cleanup failure", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const events: string[] = [];
  let removeCalls = 0;

  denoRuntime.serve = (() => ({
    addr: { port: 3214 },
    shutdown: () => {
      events.push("server-shutdown");
    },
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = (() => {}) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {
    removeCalls++;
    events.push("signal-remove");
    if (removeCalls === 1) throw undefined;
  }) as typeof Deno.removeSignalListener;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: ["SIGTERM"],
    });
    let rejected: unknown = "not-thrown";

    try {
      await server.stop();
    } catch (error) {
      rejected = error;
    }

    assertStrictEquals(rejected, undefined);
    assertEquals(events, [
      "runtime-shutdown",
      "server-shutdown",
      "runtime-stop",
      "signal-remove",
    ]);

    await server.stop();
    assertEquals(events, [
      "runtime-shutdown",
      "server-shutdown",
      "runtime-stop",
      "signal-remove",
      "signal-remove",
    ]);
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
  }
});

Deno.test("Deno service lifecycle survives throwing logging and hostile cleanup errors", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
    exit: typeof Deno.exit;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const originalExit = denoRuntime.exit;
  const events: string[] = [];
  const exited = Promise.withResolvers<void>();
  let signalHandler: (() => void) | undefined;
  let infoCalls = 0;
  let runtimeStopCalls = 0;
  const inspectionError = new Error("hostile cleanup inspection");
  const hostileCleanupError = new Proxy(Object.create(null), {
    get: () => {
      throw inspectionError;
    },
    getPrototypeOf: () => {
      throw inspectionError;
    },
  });

  denoRuntime.serve = (() => ({
    addr: { port: 3215 },
    shutdown: () => {
      events.push("server-shutdown");
    },
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = ((_signal: Deno.Signal, handler: () => void) => {
    signalHandler = handler;
  }) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {
    events.push("signal-remove");
  }) as typeof Deno.removeSignalListener;
  denoRuntime.exit = ((code?: number) => {
    events.push(`exit:${code ?? 0}`);
    exited.resolve();
  }) as typeof Deno.exit;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          runtimeStopCalls++;
          events.push("runtime-stop");
          if (runtimeStopCalls === 1) throw hostileCleanupError;
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: ["SIGTERM"],
      logger: {
        info: () => {
          infoCalls++;
          throw new Error("logger failed");
        },
      },
    });

    assertEquals(infoCalls, 1);
    if (!signalHandler) throw new Error("Expected a Deno signal handler");
    signalHandler();
    await exited.promise;

    assertEquals(infoCalls, 2);
    assertEquals(events, [
      "runtime-shutdown",
      "server-shutdown",
      "runtime-stop",
      "signal-remove",
      "exit:1",
    ]);

    await server.stop();
    assertEquals(events, [
      "runtime-shutdown",
      "server-shutdown",
      "runtime-stop",
      "signal-remove",
      "exit:1",
      "runtime-stop",
    ]);
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
    denoRuntime.exit = originalExit;
  }
});

Deno.test("Bun service shutdown runs runtime stop when transport stop rejects", async () => {
  const originalBun = Reflect.get(globalThis, "Bun");
  const stopError = new Error("bun stop failed");
  const events: string[] = [];
  Reflect.set(globalThis, "Bun", {
    serve: () => ({
      port: 3211,
      url: new URL("http://127.0.0.1:3211"),
      stop: () => {
        events.push("server-stop");
        return Promise.reject(stopError);
      },
    }),
  });

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });

    const rejected = await assertRejects(() => server.stop(), Error, "bun stop failed");

    assertStrictEquals(rejected, stopError);
    assertEquals(events, ["runtime-shutdown", "server-stop", "runtime-stop"]);
  } finally {
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, "Bun");
    } else {
      Reflect.set(globalThis, "Bun", originalBun);
    }
  }
});

Deno.test("Bun startup preserves a null serve failure after cleaning the runtime", async () => {
  const originalBun = Reflect.get(globalThis, "Bun");
  const events: string[] = [];
  Reflect.set(globalThis, "Bun", {
    serve: () => {
      throw null;
    },
  });

  try {
    let received: unknown = "not-thrown";
    try {
      await startVeryfrontServer({
        runtime: {
          fetch: () => new Response("unreachable"),
          setShuttingDown: () => events.push("runtime-shutdown"),
          stop: () => {
            events.push("runtime-stop");
            return Promise.resolve();
          },
        },
        port: 0,
        bindAddress: "127.0.0.1",
        signals: [],
      });
    } catch (error) {
      received = error;
    }

    assertStrictEquals(received, null);
    assertEquals(events, ["runtime-shutdown", "runtime-stop"]);
  } finally {
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, "Bun");
    } else {
      Reflect.set(globalThis, "Bun", originalBun);
    }
  }
});

Deno.test("Bun invalid listener cleanup owns stop before validating metadata", async () => {
  const originalBun = Reflect.get(globalThis, "Bun");
  const events: string[] = [];
  Reflect.set(globalThis, "Bun", {
    serve: () => ({
      port: "invalid",
      stop: () => events.push("server-stop"),
    }),
  });

  try {
    await assertRejects(
      () =>
        startVeryfrontServer({
          runtime: {
            fetch: () => new Response("unreachable"),
            setShuttingDown: () => events.push("runtime-shutdown"),
            stop: () => {
              events.push("runtime-stop");
              return Promise.resolve();
            },
          },
          port: 0,
          bindAddress: "127.0.0.1",
          signals: [],
        }),
      TypeError,
      "invalid listener port",
    );

    assertEquals(events, ["runtime-shutdown", "server-stop", "runtime-stop"]);
  } finally {
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, "Bun");
    } else {
      Reflect.set(globalThis, "Bun", originalBun);
    }
  }
});

Deno.test("Bun service shutdown preserves null runtime stop rejection", async () => {
  const originalBun = Reflect.get(globalThis, "Bun");
  const events: string[] = [];
  Reflect.set(globalThis, "Bun", {
    serve: () => ({
      port: 3213,
      url: new URL("http://127.0.0.1:3213"),
      stop: () => {
        events.push("server-stop");
      },
    }),
  });

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
          return Promise.reject(null);
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });

    let rejected: unknown = "not-thrown";
    try {
      await server.stop();
    } catch (error) {
      rejected = error;
    }

    assertStrictEquals(rejected, null);
    assertEquals(events, ["runtime-shutdown", "server-stop", "runtime-stop"]);
  } finally {
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, "Bun");
    } else {
      Reflect.set(globalThis, "Bun", originalBun);
    }
  }
});

Deno.test("Bun service startup survives a throwing injected logger", async () => {
  const originalBun = Reflect.get(globalThis, "Bun");
  const events: string[] = [];
  Reflect.set(globalThis, "Bun", {
    serve: () => ({
      port: 3216,
      url: new URL("http://127.0.0.1:3216"),
      stop: () => events.push("server-stop"),
    }),
  });

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        setShuttingDown: () => events.push("runtime-shutdown"),
        stop: () => {
          events.push("runtime-stop");
        },
      }],
    });
    const server = await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
      logger: {
        info: () => {
          throw new Error("logger failed");
        },
      },
    });

    await server.stop();
    assertEquals(events, ["runtime-shutdown", "server-stop", "runtime-stop"]);
  } finally {
    if (originalBun === undefined) {
      Reflect.deleteProperty(globalThis, "Bun");
    } else {
      Reflect.set(globalThis, "Bun", originalBun);
    }
  }
});

Deno.test("Node service shutdown runs runtime stop when server close fails", async () => {
  const closeError = new Error("node close failed");
  const events: string[] = [];
  const runtime = createVeryfrontServer({
    modules: [{
      name: "test",
      handle: () => new Response("served"),
      setShuttingDown: () => events.push("runtime-shutdown"),
      stop: () => {
        events.push("runtime-stop");
      },
    }],
  });
  const server = await startNodeVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });
  const originalClose = server.server.close;
  let closeCalls = 0;
  server.server.close = ((callback?: (error?: Error) => void) => {
    closeCalls++;
    events.push("server-close");
    if (closeCalls === 1) {
      queueMicrotask(() => callback?.(closeError));
      return server.server;
    }
    Reflect.apply(originalClose, server.server, [callback]);
    return server.server;
  }) as typeof server.server.close;

  try {
    const rejected = await assertRejects(() => server.stop(), Error, "node close failed");

    assertStrictEquals(rejected, closeError);
    assertEquals(events, ["runtime-shutdown", "server-close", "runtime-stop"]);
  } finally {
    server.server.close = originalClose;
    await server.stop();
  }
});
