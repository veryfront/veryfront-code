import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { Server as NativeHttpServer } from "node:http";
import {
  createVeryfrontServer,
  startNodeVeryfrontServer,
  startVeryfrontServer,
} from "./service-server.ts";

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
  server.server.close = ((callback?: (error?: Error) => void) => {
    events.push("server-close");
    callback?.(closeError);
    // Release the real listener after exposing the injected failure. A native
    // close event is terminal and must not be reinterpreted as a late callback
    // failure by the hardened transport lifecycle.
    originalClose.call(server.server);
    return server.server;
  }) as typeof server.server.close;

  const rejected = await assertRejects(() => server.stop(), Error, "node close failed");
  await server.stop();

  assertStrictEquals(rejected, closeError);
  assertEquals(events, ["runtime-shutdown", "server-close", "runtime-stop"]);
});

Deno.test("Node service startup preserves transport error when lifecycle rollback fails", async () => {
  const transportError = new Error("node listen failed");
  const cleanupError = new Error("lifecycle cleanup failed");
  const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const events: string[] = [];
  const listenDescriptor = Object.getOwnPropertyDescriptor(
    NativeHttpServer.prototype,
    "listen",
  );
  const originalListen = NativeHttpServer.prototype.listen;
  const runtime = createVeryfrontServer({
    modules: [{
      name: "test",
      handle: () => new Response("served"),
      setShuttingDown: () => events.push("runtime-shutdown"),
      stop: () => {
        events.push("runtime-stop");
        throw cleanupError;
      },
    }],
  });

  NativeHttpServer.prototype.listen = function (): NativeHttpServer {
    throw transportError;
  } as typeof originalListen;

  try {
    const server = await startNodeVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      signals: [],
      logger: {
        warn: (message, metadata) => warnings.push({ message, metadata }),
      },
    });

    const rejected = await assertRejects(() => server.ready, Error, "node listen failed");
    const startupErrorMessage = rejected instanceof Error ? rejected.message : String(rejected);

    assertStrictEquals(rejected, transportError);
    assertEquals(events, ["runtime-shutdown", "runtime-stop"]);
    assertEquals(warnings, [{
      message: "Veryfront service server cleanup failed during startup rollback",
      metadata: {
        startupError: startupErrorMessage,
        cleanupError: cleanupError.message,
      },
    }]);
  } finally {
    if (listenDescriptor !== undefined) {
      Object.defineProperty(NativeHttpServer.prototype, "listen", listenDescriptor);
    } else {
      Reflect.deleteProperty(NativeHttpServer.prototype, "listen");
    }
  }
});

it("createVeryfrontServer answers 500 and logs when a module throws", async () => {
  const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const runtime = createVeryfrontServer({
    modules: [{
      name: "boom",
      handle: () => {
        throw new Error("module exploded");
      },
    }],
    logger: {
      error: (message, metadata) => errors.push({ message, metadata }),
    },
  });

  const response = await runtime.fetch(new Request("http://localhost/boom"));

  assertEquals(
    response.status,
    500,
    "a throwing module must be converted to a 500, not a rejected fetch",
  );
  assertEquals(
    await response.text(),
    "Internal Server Error",
    "the default error boundary must answer with the generic error body",
  );
  assertEquals(
    errors,
    [{
      message: "Veryfront service request failed",
      metadata: { url: "http://localhost/boom", error: "module exploded" },
    }],
    "the error boundary must log the failing request url",
  );
});

it("createVeryfrontServer honours custom notFound and onError overrides", async () => {
  const runtime = createVeryfrontServer({
    modules: [{
      name: "boom",
      handle: (request) => {
        if (new URL(request.url).pathname === "/boom") {
          throw new Error("module exploded");
        }
        return null;
      },
    }],
    notFound: () => new Response("gone", { status: 410 }),
    onError: () => new Response("custom", { status: 503 }),
  });

  const unhandled = await runtime.fetch(new Request("http://localhost/missing"));
  assertEquals(
    unhandled.status,
    410,
    "a custom notFound must replace the default 404 response",
  );
  assertEquals(await unhandled.text(), "gone", "the custom notFound body must be served as-is");

  const failed = await runtime.fetch(new Request("http://localhost/boom"));
  assertEquals(
    failed.status,
    503,
    "a custom onError must replace the default 500 response",
  );
  assertEquals(await failed.text(), "custom", "the custom onError body must be served as-is");
});

it("Deno service shutdown reports the transport failure when runtime stop also fails", async () => {
  const denoRuntime = Deno as unknown as {
    serve: typeof Deno.serve;
    addSignalListener: typeof Deno.addSignalListener;
    removeSignalListener: typeof Deno.removeSignalListener;
  };
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const transportError = new Error("deno shutdown failed");
  const cleanupError = new Error("runtime stop failed");
  const events: string[] = [];

  denoRuntime.serve = (() => ({
    addr: { port: 3214 },
    shutdown: () => {
      events.push("server-shutdown");
      return Promise.reject(transportError);
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
          throw cleanupError;
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

    assertStrictEquals(
      rejected,
      transportError,
      "a shutdown failing in both stages must surface the transport root cause, not the later cleanup error",
    );
    assertEquals(
      events,
      ["runtime-shutdown", "server-shutdown", "runtime-stop"],
      "both shutdown stages must still run when the first one fails",
    );
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
  }
});

it("Node service start reports the actually bound ephemeral port", async () => {
  const runtime = createVeryfrontServer({
    modules: [{ name: "test", handle: () => new Response("served") }],
  });
  const server = await startNodeVeryfrontServer({
    runtime,
    port: 0,
    bindAddress: "127.0.0.1",
    signals: [],
  });

  try {
    await server.ready;

    assert(
      server.port > 0,
      "onListen must rewrite the reported port from the actually bound ephemeral port, not echo the requested 0",
    );
    assertEquals(
      server.url,
      `http://127.0.0.1:${server.port}`,
      "the reported url must name the bound port",
    );
    assertEquals(
      await (await fetch(server.url)).text(),
      "served",
      "the reported url must be fetchable",
    );
  } finally {
    await server.stop();
  }
});

type DenoSignalTestRuntime = {
  serve: typeof Deno.serve;
  addSignalListener: typeof Deno.addSignalListener;
  removeSignalListener: typeof Deno.removeSignalListener;
  exit: typeof Deno.exit;
};

it("Deno shutdown signal handler stops once and exits nonzero when stop fails", async () => {
  using _time = new FakeTime();
  const denoRuntime = Deno as unknown as DenoSignalTestRuntime;
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const originalExit = denoRuntime.exit;
  const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const exitCodes: number[] = [];
  let capturedHandler: (() => void) | undefined;
  let stopCalls = 0;
  let resolveExitObserved!: () => void;
  const exitObserved = new Promise<void>((resolve) => {
    resolveExitObserved = resolve;
  });

  denoRuntime.serve = (() => ({
    addr: { port: 3215 },
    shutdown: () => {},
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = ((_signal: unknown, handler: () => void) => {
    capturedHandler = handler;
  }) as unknown as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {}) as typeof Deno.removeSignalListener;
  denoRuntime.exit = ((code?: number) => {
    exitCodes.push(code ?? 0);
    resolveExitObserved();
  }) as unknown as typeof Deno.exit;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        stop: () => {
          stopCalls += 1;
          throw new Error("module stop failed");
        },
      }],
    });
    await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      logger: {
        error: (message, metadata) => errors.push({ message, metadata }),
      },
    });

    assertExists(capturedHandler, "the default SIGTERM handler must be installed");
    capturedHandler();
    capturedHandler();
    await exitObserved;

    assertEquals(
      stopCalls,
      1,
      "a repeated shutdown signal must not run the graceful stop a second time",
    );
    assertEquals(
      exitCodes,
      [1],
      "a graceful shutdown that fails must exit with a failure code exactly once",
    );
    assertEquals(
      errors,
      [{
        message: "Veryfront service server shutdown failed",
        metadata: {
          signal: "SIGTERM",
          runtime: "deno",
          error: "module stop failed",
        },
      }],
      "a failed shutdown must be logged with the signal that triggered it",
    );
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
    denoRuntime.exit = originalExit;
  }
});

it("Deno shutdown signal handler exits nonzero when graceful shutdown times out", async () => {
  using time = new FakeTime();
  const denoRuntime = Deno as unknown as DenoSignalTestRuntime;
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const originalExit = denoRuntime.exit;
  const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const exitCodes: number[] = [];
  let capturedHandler: (() => void) | undefined;
  let releaseStop!: () => void;
  const blockedStop = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });

  denoRuntime.serve = (() => ({
    addr: { port: 3216 },
    shutdown: () => {},
  })) as unknown as typeof Deno.serve;
  denoRuntime.addSignalListener = ((_signal: unknown, handler: () => void) => {
    capturedHandler = handler;
  }) as unknown as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = (() => {}) as typeof Deno.removeSignalListener;
  denoRuntime.exit = ((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as unknown as typeof Deno.exit;

  try {
    const runtime = createVeryfrontServer({
      modules: [{
        name: "test",
        handle: () => new Response("served"),
        stop: () => blockedStop,
      }],
    });
    await startVeryfrontServer({
      runtime,
      port: 0,
      bindAddress: "127.0.0.1",
      hardShutdownTimeoutMs: 10,
      logger: {
        error: (message, metadata) => errors.push({ message, metadata }),
      },
    });

    assertExists(capturedHandler, "the default SIGTERM handler must be installed");
    capturedHandler();
    await time.tickAsync(10);

    assertEquals(
      exitCodes,
      [1],
      "a graceful shutdown that exceeds the hard timeout must exit with a failure code",
    );
    assertEquals(
      errors,
      [{
        message: "Veryfront service server graceful shutdown timed out",
        metadata: { signal: "SIGTERM", runtime: "deno" },
      }],
      "the hard shutdown timeout must be logged with the signal that triggered it",
    );
  } finally {
    releaseStop();
    await time.runMicrotasks();
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
    denoRuntime.exit = originalExit;
  }
});
