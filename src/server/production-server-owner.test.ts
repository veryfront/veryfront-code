import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runDirectProductionServer } from "./production-server.ts";

describe("direct production server owner", () => {
  it("handles a signal while startup initialization is still pending", async () => {
    const events: string[] = [];
    let signalHandler: ((signal: "SIGINT" | "SIGTERM") => void | Promise<void>) | undefined;

    await runDirectProductionServer({
      initializeErrorReporting: () => {
        events.push("initialize");
        return new Promise<void>(() => {});
      },
      registerSignals: (handler) => {
        events.push("signals");
        signalHandler = handler;
        queueMicrotask(() => handler("SIGTERM"));
        return () => events.push("dispose-signals");
      },
      gracefullyShutdown: (options) => {
        events.push(`shutdown:${options.signal}`);
        options.abort();
        return Promise.resolve(true);
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    await signalHandler?.("SIGINT");
    assertEquals(events, [
      "signals",
      "initialize",
      "shutdown:SIGTERM",
      "flush",
      "exit:0",
      "dispose-signals",
    ]);
  });
});
