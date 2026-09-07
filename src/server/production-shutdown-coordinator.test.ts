import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProductionShutdownCoordinator,
  runProductionProcessOwner,
} from "./production-shutdown-coordinator.ts";

describe("production shutdown coordinator", () => {
  it("runs shutdown, flush, and exit once when memory and signals race", async () => {
    const events: string[] = [];
    const coordinator = createProductionShutdownCoordinator({
      shutdown: async (reason) => {
        events.push(`shutdown:${reason}`);
      },
      flush: async () => {
        events.push("flush");
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });

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
});
