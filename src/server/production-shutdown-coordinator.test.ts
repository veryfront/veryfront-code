import type { ProductionShutdownCoordinatorOptions } from "veryfront/server";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProductionShutdownCoordinator,
  runProductionProcessOwner,
} from "./production-shutdown-coordinator.ts";

describe("production shutdown coordinator", () => {
  it("bounds a stalled consumer shutdown and aborts pending startup at the deadline", async () => {
    const finishShutdown = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    let requestShutdown: (() => void) | undefined;
    const events: string[] = [];
    const run = runProductionProcessOwner({
      start: (options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
      shutdown: () => {
        events.push("shutdown");
        return finishShutdown.promise;
      },
      shutdownTimeoutMs: 0,
      registerSignals: (handler) => {
        requestShutdown = () => handler("SIGTERM");
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: () => {
        events.push("exit");
      },
    });
    requestShutdown?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        run.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 50);
        }),
      ]);
      assertEquals(completed, true);
      assertEquals(signal?.aborted, true);
      assertEquals(events, ["shutdown", "flush", "exit"]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      finishShutdown.resolve();
      await run;
    }
  });

  it("propagates readiness failure when cleanup cannot finish within its budget", async () => {
    const failure = new Error("readiness failed");
    const cleanupStarted = Promise.withResolvers<void>();
    const finishCleanup = Promise.withResolvers<void>();
    const run = runProductionProcessOwner({
      start: () =>
        Promise.resolve({
          ready: Promise.reject(failure),
          stop: () => {
            cleanupStarted.resolve();
            return finishCleanup.promise;
          },
        }),
      shutdown: () => Promise.resolve(),
      shutdownTimeoutMs: 0,
      registerSignals: () => {},
      flush: () => Promise.resolve(),
      exit: () => {},
    }).then(() => undefined, (error: unknown) => error);
    await cleanupStarted.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        run,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("still waiting"), 50);
        }),
      ]);
      assertEquals(outcome, failure);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      finishCleanup.resolve();
      await run;
    }
  });

  it("drains admitted work while the outer startup handle is still pending", async () => {
    const events: string[] = [];
    const startup = Promise.withResolvers<{ ready: Promise<void>; stop: () => Promise<void> }>();
    const draining = Promise.withResolvers<void>();
    const finishDrain = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    let requestShutdown: (() => void) | undefined;
    const run = runProductionProcessOwner({
      start: (options) => {
        signal = options.signal;
        return startup.promise;
      },
      shutdown: async (_reason, _server, abort) => {
        events.push(signal?.aborted ? "aborted-before-drain" : "drain-start");
        draining.resolve();
        await finishDrain.promise;
        events.push("drained");
        abort();
      },
      registerSignals: (handler) => {
        requestShutdown = () => handler("SIGTERM");
      },
      flush: () => Promise.resolve(),
      exit: () => {
        events.push("exit");
      },
    });
    requestShutdown?.();
    await draining.promise;
    startup.resolve({
      ready: Promise.resolve(),
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    try {
      assertEquals(events, ["drain-start"], "pending startup can already have active responses");
    } finally {
      finishDrain.resolve();
      await run;
    }
    assertEquals(events, ["drain-start", "drained", "stop", "exit"]);
  });

  it("exits after an exhausted shutdown budget even if error flushing hangs", async () => {
    const finishFlush = Promise.withResolvers<void>();
    let exited = false;
    let requestShutdown: (() => void) | undefined;
    const run = runProductionProcessOwner({
      start: () => new Promise(() => {}),
      shutdown: () => Promise.resolve(),
      shutdownTimeoutMs: 0,
      registerSignals: (handler) => {
        requestShutdown = () => handler("SIGTERM");
      },
      flush: () => finishFlush.promise,
      exit: () => {
        exited = true;
      },
    });
    requestShutdown?.();
    let observationTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        run.then(() => true),
        new Promise<boolean>((resolve) => {
          observationTimer = setTimeout(() => resolve(false), 50);
        }),
      ]);
      assertEquals(completed, true, "expired budget must not await the stuck reporter");
      assertEquals(exited, true);
    } finally {
      if (observationTimer !== undefined) clearTimeout(observationTimer);
      finishFlush.resolve();
      await run;
    }
  });

  it("runs shutdown, flush, and exit once when memory and signals race", async () => {
    const events: string[] = [];
    const coordinator = createProductionShutdownCoordinator(
      {
        shutdown: async (reason) => {
          events.push(`shutdown:${reason}`);
        },
        flush: async () => {
          events.push("flush");
        },
        exit: (code) => {
          events.push(`exit:${code}`);
        },
      } satisfies ProductionShutdownCoordinatorOptions,
    );

    coordinator.request("memory-pressure");
    coordinator.request("SIGTERM");
    coordinator.request("SIGINT");
    await coordinator.completed;

    assertEquals(events, ["shutdown:memory-pressure", "flush", "exit:0"]);
  });

  it("still flushes and exits once when shutdown rejects", async () => {
    const events: string[] = [];
    const coordinator = createProductionShutdownCoordinator({
      shutdown: (reason) => {
        events.push(`shutdown:${reason}`);
        return Promise.reject(new Error("drain failed"));
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
      onError: (_error, reason) => events.push(`error:${reason}`),
    });

    coordinator.request("SIGTERM");
    await coordinator.completed;

    assertEquals(events, ["shutdown:SIGTERM", "error:SIGTERM", "flush", "exit:0"]);
  });

  it("still exits once when flushing rejects", async () => {
    const events: string[] = [];
    const coordinator = createProductionShutdownCoordinator({
      shutdown: () => {
        events.push("shutdown");
        return Promise.resolve();
      },
      flush: () => {
        events.push("flush");
        return Promise.reject(new Error("flush failed"));
      },
      exit: (code) => events.push(`exit:${code}`),
      onError: (_error, reason) => events.push(`error:${reason}`),
    });

    coordinator.request("memory-pressure");
    await coordinator.completed;

    assertEquals(events, ["shutdown", "flush", "error:memory-pressure", "exit:0"]);
  });

  it("recycles when memory fires before readiness and readiness never settles", async () => {
    const events: string[] = [];
    let signalAborted = false;

    await runProductionProcessOwner({
      start: ({ signal, onMemoryRecycle }) => {
        signal.addEventListener("abort", () => {
          signalAborted = true;
          events.push("abort");
        });
        const server = {
          ready: new Promise<void>(() => {}),
          stop: () => Promise.resolve(),
        };
        queueMicrotask(onMemoryRecycle);
        return Promise.resolve(server);
      },
      shutdown: (_reason, server, abort) => {
        events.push(`shutdown:${server === undefined ? "missing" : "available"}`);
        abort();
        return server?.stop() ?? Promise.resolve();
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: () => {
        events.push("signals");
      },
    });

    assertEquals(signalAborted, true);
    assertEquals(events, [
      "signals",
      "shutdown:available",
      "abort",
      "flush",
      "exit:0",
    ]);
  });

  it("keeps the listener alive until the shutdown owner finishes draining", async () => {
    const events: string[] = [];
    let signal: AbortSignal | undefined;
    let recycle: (() => void) | undefined;
    await runProductionProcessOwner({
      start: (options) => {
        signal = options.signal;
        recycle = options.onMemoryRecycle;
        return Promise.resolve({ ready: Promise.resolve(), stop: () => Promise.resolve() });
      },
      onReady: () => recycle?.(),
      shutdown: async (_reason, _server, abort) => {
        assertEquals(signal?.aborted, false, "aborting the listener before drain breaks streams");
        events.push("drained");
        abort();
        assertEquals(signal?.aborted, true);
      },
      flush: () => Promise.resolve(),
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: () => {},
      onError: () => events.push("error"),
    });
    assertEquals(events, ["drained", "exit:0"]);
  });

  it("stops a server acquired after shutdown starts and before cleanup finishes", async () => {
    const events: string[] = [];
    let requestSignal: (() => void) | undefined;
    let resumeStartup: (() => void) | undefined;
    let startupSignal: AbortSignal | undefined;

    const run = runProductionProcessOwner({
      start: ({ signal }) => {
        startupSignal = signal;
        return new Promise((resolve) => {
          resumeStartup = () => {
            events.push(`startup-resumed:aborted=${signal.aborted}`);
            resolve({
              ready: Promise.resolve(),
              stop: () => {
                events.push("stop-late-server");
                return Promise.resolve();
              },
            });
          };
        });
      },
      shutdown: async (_reason, server, abort) => {
        events.push(`shutdown:server=${server ? "yes" : "no"}`);
        abort();
        resumeStartup?.();
        await Promise.resolve();
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
        return () => events.push("signals-disposed");
      },
    });

    requestSignal?.();
    await run;

    assertEquals(startupSignal?.aborted, true);
    assertEquals(events, [
      "shutdown:server=no",
      "startup-resumed:aborted=true",
      "stop-late-server",
      "flush",
      "exit:0",
      "signals-disposed",
    ]);
  });

  it("exits when a server acquired during shutdown does not stop before the deadline", async () => {
    const events: string[] = [];
    let requestSignal: (() => void) | undefined;
    let resumeStartup: (() => void) | undefined;

    const run = runProductionProcessOwner({
      start: () =>
        new Promise((resolve) => {
          resumeStartup = () =>
            resolve({
              ready: Promise.resolve(),
              stop: () => {
                events.push("stop-late-server");
                return new Promise<void>(() => {});
              },
            });
        }),
      shutdown: async (_reason, _server, abort) => {
        events.push("shutdown");
        abort();
        resumeStartup?.();
        await Promise.resolve();
      },
      shutdownTimeoutMs: 0,
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
    });

    requestSignal?.();
    await run;

    assertEquals(events, ["shutdown", "stop-late-server", "flush", "exit:0"]);
  });

  it("awaits a server acquired during flush before exiting", async () => {
    const events: string[] = [];
    let requestSignal: (() => void) | undefined;
    let resumeStartup: (() => void) | undefined;
    let releaseStop: (() => void) | undefined;

    const run = runProductionProcessOwner({
      start: ({ signal }) =>
        new Promise((resolve) => {
          resumeStartup = () => {
            events.push(`startup-resumed:aborted=${signal.aborted}`);
            resolve({
              ready: Promise.resolve(),
              stop: () => {
                events.push("stop-start");
                return new Promise<void>((resolveStop) => {
                  releaseStop = () => {
                    events.push("stop-done");
                    resolveStop();
                  };
                });
              },
            });
          };
        }),
      shutdown: (_reason, server, abort) => {
        events.push(`shutdown:server=${server ? "yes" : "no"}`);
        abort();
        return Promise.resolve();
      },
      flush: async () => {
        events.push("flush-start");
        resumeStartup?.();
        await Promise.resolve();
        await Promise.resolve();
        events.push("flush-done");
        queueMicrotask(() => releaseStop?.());
      },
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
        return () => events.push("signals-disposed");
      },
    });

    requestSignal?.();
    await run;

    assertEquals(events, [
      "shutdown:server=no",
      "flush-start",
      "startup-resumed:aborted=true",
      "stop-start",
      "flush-done",
      "stop-done",
      "exit:0",
      "signals-disposed",
    ]);
  });

  it("rechecks late server ownership after the pre-exit hook yields", async () => {
    const events: string[] = [];
    let requestSignal: (() => void) | undefined;
    let resumeStartup: (() => void) | undefined;

    const run = runProductionProcessOwner({
      start: ({ signal }) =>
        new Promise((resolve) => {
          resumeStartup = () => {
            events.push(`startup-resumed:aborted=${signal.aborted}`);
            resolve({
              ready: Promise.resolve(),
              stop: () => {
                events.push("stop-start");
                return new Promise<void>((resolveStop) => {
                  setTimeout(() => {
                    events.push("stop-done");
                    resolveStop();
                  }, 0);
                });
              },
            });
          };
        }),
      shutdown: (_reason, server, abort) => {
        events.push(`shutdown:server=${server ? "yes" : "no"}`);
        abort();
        return Promise.resolve();
      },
      flush: () => {
        events.push("flush-start");
        return new Promise<void>((resolveFlush) => {
          queueMicrotask(() => {
            events.push("flush-resolve");
            resolveFlush();
            resumeStartup?.();
          });
        });
      },
      beforeExit: () => Promise.resolve(),
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
    });

    requestSignal?.();
    await run;

    assertEquals(events, [
      "shutdown:server=no",
      "flush-start",
      "flush-resolve",
      "startup-resumed:aborted=true",
      "stop-start",
      "stop-done",
      "exit:0",
    ]);
  });

  it("does not re-await an initial server stop after bounded cleanup times out", async () => {
    const events: string[] = [];
    let requestSignal: (() => void) | undefined;
    let releaseStop: (() => void) | undefined;

    const run = runProductionProcessOwner({
      start: () =>
        Promise.resolve({
          ready: Promise.resolve(),
          stop: () => {
            events.push("stop-start");
            return new Promise<void>((resolve) => {
              releaseStop = resolve;
            });
          },
        }),
      shutdown: async (_reason, server) => {
        events.push(`shutdown:server=${server ? "yes" : "no"}`);
        void server?.stop();
        await Promise.resolve();
        events.push("cleanup-timeout");
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      beforeExit: () => {
        events.push("before-exit");
        return Promise.resolve();
      },
      exit: (code) => events.push(`exit:${code}`),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
      onReady: () => requestSignal?.(),
    });

    await run;
    assertEquals(events, [
      "shutdown:server=yes",
      "stop-start",
      "cleanup-timeout",
      "flush",
      "before-exit",
      "exit:0",
    ]);
    releaseStop?.();
  });

  it("stops an acquired server before propagating readiness failure", async () => {
    const events: string[] = [];
    const readinessError = new Error("readiness failed");
    let caught: unknown;

    try {
      await runProductionProcessOwner({
        start: () =>
          Promise.resolve({
            ready: Promise.reject(readinessError),
            stop: () => {
              events.push("stop");
              return Promise.resolve();
            },
          }),
        shutdown: () => Promise.resolve(),
        flush: () => Promise.resolve(),
        exit: () => events.push("exit"),
        registerSignals: () => () => events.push("signals-disposed"),
      });
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, readinessError);
    assertEquals(events, ["stop", "signals-disposed"]);
  });

  it("bounds a finalizer that always returns a completed promise", async () => {
    const events: string[] = [];
    let calls = 0;
    const coordinator = createProductionShutdownCoordinator({
      shutdown: () => Promise.resolve(),
      flush: () => Promise.resolve(),
      finalizeBeforeExit: () => {
        calls++;
        return Promise.resolve();
      },
      exit: (code) => events.push(`exit:${code}`),
    });

    coordinator.request("SIGTERM");
    await coordinator.completed;

    assertEquals(calls, 3);
    assertEquals(events, ["exit:0"]);
  });
});
