import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  createVeryfrontServer,
  startNodeVeryfrontServer,
  startVeryfrontServer,
  type VeryfrontServiceServer,
} from "./service-server.ts";
import process from "node:process";

type FakeDenoServeOptions = {
  port: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (address: { port: number; hostname: string }) => void;
};

async function withGlobalProperty<T>(
  name: string,
  value: unknown,
  operation: () => Promise<T> | T,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
  try {
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
}

async function withDenoOverrides<T>(
  overrides: Readonly<Record<string, unknown>>,
  operation: () => Promise<T> | T,
): Promise<T> {
  const denoGlobal = Reflect.get(globalThis, "Deno");
  if (typeof denoGlobal !== "object" || denoGlobal === null) {
    throw new TypeError("Deno test runtime is unavailable");
  }

  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(denoGlobal, name));
    Object.defineProperty(denoGlobal, name, {
      configurable: true,
      value,
      writable: true,
    });
  }

  try {
    return await operation();
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(denoGlobal, name, descriptor);
      } else {
        Reflect.deleteProperty(denoGlobal, name);
      }
    }
  }
}

function createFakeDenoServer(port: number, onStop?: () => void) {
  let finish: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    addr: { port },
    finished,
    shutdown: () => {
      onStop?.();
      finish?.();
    },
  };
}

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

Deno.test("createVeryfrontServer rejects invalid handler responses with a sanitized failure", async () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const runtime = createVeryfrontServer({
    modules: [{
      name: "invalid",
      handle: () => "private response payload" as unknown as Response,
    }],
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  const response = await runtime.fetch(
    new Request("http://localhost/customer/private-record?token=secret"),
  );

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "Internal Server Error");
  assertEquals(errors, [{ method: "GET", errorType: "TypeError" }]);
});

Deno.test("createVeryfrontServer rejects an invalid custom error response", async () => {
  const runtime = createVeryfrontServer({
    modules: [{
      name: "failure",
      handle: () => {
        throw new Error("private failure");
      },
    }],
    onError: () => ({ status: 500 }) as unknown as Response,
  });

  await assertRejects(
    async () => await runtime.fetch(new Request("http://localhost/test")),
    TypeError,
    "error handler must return a Response",
  );
});

Deno.test("createVeryfrontServer does not let a failing logger replace the error response", async () => {
  const runtime = createVeryfrontServer({
    modules: [{
      name: "failure",
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

  const response = await runtime.fetch(new Request("http://localhost/test"));

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

Deno.test("createVeryfrontServer attempts every module stop and aggregates failures", async () => {
  const events: string[] = [];
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "first",
        handle: () => null,
        stop: () => {
          events.push("first");
          throw new Error("first failed");
        },
      },
      {
        name: "second",
        handle: () => null,
        stop: () => {
          events.push("second");
          throw new Error("second failed");
        },
      },
    ],
  });

  const error = await assertRejects(() => runtime.stop(), AggregateError);

  assertEquals(events, ["first", "second"]);
  assertEquals(error.errors.length, 2);
  await assertRejects(() => runtime.stop(), AggregateError);
  assertEquals(events, ["first", "second"]);
});

Deno.test("createVeryfrontServer attempts every shutdown hook before rejecting", () => {
  const events: string[] = [];
  const runtime = createVeryfrontServer({
    modules: [
      {
        name: "first",
        handle: () => null,
        setShuttingDown: () => {
          events.push("first");
          throw new Error("first failed");
        },
      },
      {
        name: "second",
        handle: () => null,
        setShuttingDown: () => events.push("second"),
      },
    ],
  });

  try {
    runtime.setShuttingDown();
  } catch (error) {
    assertEquals(error instanceof AggregateError, true);
  }
  assertEquals(events, ["first", "second"]);
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

Deno.test("startNodeVeryfrontServer reports the allocated port when configured with port zero", async () => {
  const server = await startNodeVeryfrontServer({
    runtime: createVeryfrontServer({
      modules: [{ name: "test", handle: () => new Response("ok") }],
    }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });

  try {
    await server.ready;
    const url = new URL(server.url);
    assert(server.port > 0);
    assertEquals(Number(url.port), server.port);
    assertEquals(await (await fetch(server.url)).text(), "ok");
  } finally {
    await server.stop();
  }
});

Deno.test("startNodeVeryfrontServer cleans up after an asynchronous listen failure", async () => {
  const occupied = await startNodeVeryfrontServer({
    runtime: createVeryfrontServer({ modules: [] }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });
  await occupied.ready;
  const events: string[] = [];
  const initialSignalListeners = process.listenerCount("SIGTERM");

  try {
    const failed = await startNodeVeryfrontServer({
      runtime: createVeryfrontServer({
        modules: [{
          name: "lifecycle",
          handle: () => null,
          setShuttingDown: () => events.push("shutdown"),
          stop: () => {
            events.push("stop");
          },
        }],
      }),
      port: occupied.port,
      bindAddress: "127.0.0.1",
      signals: ["SIGTERM"],
    });

    await assertRejects(() => failed.ready);
    assertEquals(events, ["shutdown", "stop"]);
    await failed.stop();
    assertEquals(events, ["shutdown", "stop"]);
    assertEquals(process.listenerCount("SIGTERM"), initialSignalListeners);
  } finally {
    await occupied.stop();
  }
});

Deno.test("startNodeVeryfrontServer can stop before listening without leaking lifecycle work", async () => {
  const events: string[] = [];
  const server = await startNodeVeryfrontServer({
    runtime: createVeryfrontServer({
      modules: [{
        name: "lifecycle",
        handle: () => null,
        setShuttingDown: () => events.push("shutdown"),
        stop: () => {
          events.push("stop");
        },
      }],
    }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });

  const stopping = server.stop();
  await assertRejects(
    () => server.ready,
    Error,
    "stopped before it became ready",
  );
  await stopping;
  assertEquals(events, ["shutdown", "stop"]);
  await server.stop();
  assertEquals(events, ["shutdown", "stop"]);
});

Deno.test("startNodeVeryfrontServer sanitizes errors emitted after startup", async () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const server = await startNodeVeryfrontServer({
    runtime: createVeryfrontServer({ modules: [] }),
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  try {
    await server.ready;
    server.server.emit("error", new Error("private runtime failure"));
    assertEquals(errors, [{ runtime: "node", errorType: "Error" }]);
  } finally {
    await server.stop();
  }
});

Deno.test("startVeryfrontServer rejects and cleans an invalid Bun server handle", async () => {
  const events: string[] = [];
  await withGlobalProperty("Bun", {
    serve: () => ({
      port: 0,
      stop: () => events.push("native-stop"),
    }),
  }, async () => {
    await assertRejects(
      () =>
        startVeryfrontServer({
          runtime: createVeryfrontServer({
            modules: [{
              name: "lifecycle",
              handle: () => null,
              setShuttingDown: () => events.push("shutdown"),
              stop: () => {
                events.push("runtime-stop");
              },
            }],
          }),
          port: 0,
          bindAddress: "127.0.0.1",
          signals: [],
        }),
      TypeError,
      "invalid server handle",
    );
  });

  assertEquals(events, ["shutdown", "native-stop", "runtime-stop"]);
});

Deno.test("startVeryfrontServer cleans runtime state when Bun startup throws", async () => {
  const events: string[] = [];
  await withGlobalProperty("Bun", {
    serve: () => {
      throw new Error("private Bun startup failure");
    },
  }, async () => {
    await assertRejects(() =>
      startVeryfrontServer({
        runtime: createVeryfrontServer({
          modules: [{
            name: "lifecycle",
            handle: () => null,
            setShuttingDown: () => events.push("shutdown"),
            stop: () => {
              events.push("runtime-stop");
            },
          }],
        }),
        port: 0,
        signals: [],
      })
    );
  });

  assertEquals(events, ["shutdown", "runtime-stop"]);
});

Deno.test("startVeryfrontServer rejects and cleans an invalid Deno server handle", async () => {
  const events: string[] = [];
  await withDenoOverrides({
    serve: () => ({
      addr: { port: 0 },
      finished: Promise.resolve(),
      shutdown: () => events.push("native-stop"),
    }),
  }, async () => {
    await assertRejects(
      () =>
        startVeryfrontServer({
          runtime: createVeryfrontServer({
            modules: [{
              name: "lifecycle",
              handle: () => null,
              setShuttingDown: () => events.push("shutdown"),
              stop: () => {
                events.push("runtime-stop");
              },
            }],
          }),
          port: 0,
          bindAddress: "127.0.0.1",
          signals: [],
        }),
      TypeError,
      "invalid server handle",
    );
  });

  assertEquals(events, ["shutdown", "native-stop", "runtime-stop"]);
});

Deno.test("startVeryfrontServer reports Bun's allocated port", async () => {
  let stopped = false;
  await withGlobalProperty("Bun", {
    serve: () => ({
      port: 43_123,
      stop: () => {
        stopped = true;
      },
    }),
  }, async () => {
    const server = await startVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
    });
    assertEquals(server.port, 43_123);
    assertEquals(server.url, "http://127.0.0.1:43123");
    await server.stop();
  });
  assertEquals(stopped, true);
});

Deno.test("startVeryfrontServer validates a custom runtime response at the native boundary", async () => {
  let nativeFetch: ((request: Request) => Response | Promise<Response>) | undefined;
  await withGlobalProperty("Bun", {
    serve: (options: { fetch: (request: Request) => Response | Promise<Response> }) => {
      nativeFetch = options.fetch;
      return { port: 43_126, stop: () => undefined };
    },
  }, async () => {
    const server = await startVeryfrontServer({
      runtime: {
        fetch: () => ({ status: 200 }) as unknown as Response,
        setShuttingDown: () => undefined,
        stop: () => Promise.resolve(),
      },
      port: 0,
      signals: [],
    });
    try {
      assert(nativeFetch);
      await assertRejects(
        async () => await nativeFetch?.(new Request("http://localhost/test")),
        TypeError,
        "runtime fetch handler must return a Response",
      );
    } finally {
      await server.stop();
    }
  });
});

Deno.test("startVeryfrontServer aborts a Deno server that has no shutdown method", async () => {
  let aborted = false;
  await withDenoOverrides({
    serve: (options: FakeDenoServeOptions) => {
      let finish: (() => void) | undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      options.signal?.addEventListener("abort", () => {
        aborted = true;
        finish?.();
      }, { once: true });
      return { addr: { port: 43_127 }, finished };
    },
  }, async () => {
    const server = await startVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      signals: [],
    });
    await server.stop();
  });
  assertEquals(aborted, true);
});

Deno.test("startVeryfrontServer still cleans runtime state when native shutdown fails", async () => {
  const events: string[] = [];
  await withDenoOverrides({
    serve: () =>
      createFakeDenoServer(43_128, () => {
        events.push("native-stop");
        throw new Error("native shutdown failed");
      }),
  }, async () => {
    const server = await startVeryfrontServer({
      runtime: createVeryfrontServer({
        modules: [{
          name: "lifecycle",
          handle: () => null,
          setShuttingDown: () => events.push("shutdown"),
          stop: () => {
            events.push("runtime-stop");
          },
        }],
      }),
      port: 0,
      signals: [],
    });
    const failure = await assertRejects(() => server.stop(), AggregateError);
    assertEquals(failure.errors.length, 1);
    await assertRejects(() => server.stop(), AggregateError);
  });
  assertEquals(events, ["shutdown", "native-stop", "runtime-stop"]);
});

Deno.test("startVeryfrontServer installs and removes each Deno signal once", async () => {
  const handlers = new Map<string, Set<() => void>>();
  const removals: string[] = [];
  await withDenoOverrides({
    serve: (options: FakeDenoServeOptions) => {
      options.onListen?.({ hostname: options.hostname ?? "0.0.0.0", port: 43_124 });
      return createFakeDenoServer(43_124);
    },
    addSignalListener: (signal: string, handler: () => void) => {
      const signalHandlers = handlers.get(signal) ?? new Set();
      signalHandlers.add(handler);
      handlers.set(signal, signalHandlers);
    },
    removeSignalListener: (signal: string, handler: () => void) => {
      removals.push(signal);
      handlers.get(signal)?.delete(handler);
    },
  }, async () => {
    const server = await startVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      signals: ["SIGTERM", "SIGTERM"],
    });

    assertEquals(handlers.get("SIGTERM")?.size, 1);
    await Promise.all([server.stop(), server.stop()]);
  });

  assertEquals(removals, ["SIGTERM"]);
  assertEquals(handlers.get("SIGTERM")?.size, 0);
});

Deno.test("startVeryfrontServer coordinates one signal across multiple server instances", async () => {
  const handlers = new Map<string, Set<() => void>>();
  const exitCodes: number[] = [];
  const stopped: number[] = [];
  let nextPort = 43_130;
  let resolveExit: ((code: number) => void) | undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  await withDenoOverrides({
    serve: () => {
      const id = nextPort++;
      return createFakeDenoServer(id, () => stopped.push(id));
    },
    addSignalListener: (signal: string, handler: () => void) => {
      const signalHandlers = handlers.get(signal) ?? new Set();
      signalHandlers.add(handler);
      handlers.set(signal, signalHandlers);
    },
    removeSignalListener: (signal: string, handler: () => void) => {
      handlers.get(signal)?.delete(handler);
    },
    exit: (code: number) => {
      exitCodes.push(code);
      resolveExit?.(code);
    },
  }, async () => {
    const first = await startVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      signals: ["SIGTERM"],
    });
    const second = await startVeryfrontServer({
      runtime: createVeryfrontServer({ modules: [] }),
      port: 0,
      signals: ["SIGTERM"],
    });

    assertEquals(handlers.get("SIGTERM")?.size, 1);
    const handler = handlers.get("SIGTERM")?.values().next().value;
    assert(handler);
    handler();
    assertEquals(await exited, 0);
    await Promise.all([first.stop(), second.stop()]);
  });

  assertEquals(stopped, [43_130, 43_131]);
  assertEquals(exitCodes, [0]);
  assertEquals(handlers.get("SIGTERM")?.size, 0);
});

Deno.test("startVeryfrontServer removes partial signal registration and sanitizes warnings", async () => {
  const handlers = new Map<string, Set<() => void>>();
  const events: string[] = [];
  const removals: string[] = [];
  const warnings: Array<Record<string, unknown> | undefined> = [];
  await withDenoOverrides({
    serve: () => createFakeDenoServer(43_132, () => events.push("native-stop")),
    addSignalListener: (signal: string, handler: () => void) => {
      if (signal === "SIGINT") throw new Error("private signal failure");
      const signalHandlers = handlers.get(signal) ?? new Set();
      signalHandlers.add(handler);
      handlers.set(signal, signalHandlers);
    },
    removeSignalListener: (signal: string, handler: () => void) => {
      removals.push(signal);
      handlers.get(signal)?.delete(handler);
    },
  }, async () => {
    await assertRejects(
      () =>
        startVeryfrontServer({
          runtime: createVeryfrontServer({
            modules: [{
              name: "lifecycle",
              handle: () => null,
              setShuttingDown: () => events.push("shutdown"),
              stop: () => {
                events.push("runtime-stop");
              },
            }],
          }),
          port: 0,
          signals: ["SIGTERM", "SIGINT"],
          logger: {
            warn: (_message, metadata) => warnings.push(metadata),
          },
        }),
      TypeError,
      "could not install shutdown signal handler",
    );
  });

  assertEquals(removals, ["SIGTERM"]);
  assertEquals(handlers.get("SIGTERM")?.size, 0);
  assertEquals(events, ["shutdown", "native-stop", "runtime-stop"]);
  assertEquals(warnings, [{ signal: "SIGINT", runtime: "deno", errorType: "Error" }]);
});

Deno.test("startVeryfrontServer validates shutdown timeout before opening a server", async () => {
  let serveCalls = 0;
  let server: VeryfrontServiceServer | undefined;
  let failure: unknown;
  await withGlobalProperty("Bun", {
    serve: () => {
      serveCalls++;
      return { port: 43_125, stop: () => undefined };
    },
  }, async () => {
    try {
      server = await startVeryfrontServer({
        runtime: createVeryfrontServer({ modules: [] }),
        port: 0,
        signals: [],
        hardShutdownTimeoutMs: Number.POSITIVE_INFINITY,
      });
    } catch (error) {
      failure = error;
    } finally {
      await server?.stop();
    }
  });

  assertEquals(failure instanceof TypeError, true);
  assertEquals(serveCalls, 0);
});
