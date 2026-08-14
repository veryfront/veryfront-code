import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
