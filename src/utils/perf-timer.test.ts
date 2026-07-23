import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { endRequest, isEnabled, startRequest, startTimer, timeAsync } from "./perf-timer.ts";
import { __resetLoggerConfigForTests, type LogEntry } from "./logger/index.ts";

async function withEnabledPerfTimer(
  fn: (
    perf: typeof import("./perf-timer.ts"),
    output: string[],
  ) => Promise<void>,
): Promise<void> {
  const previousPerf = Deno.env.get("VERYFRONT_PERF");
  const previousLevel = Deno.env.get("LOG_LEVEL");
  const previousFormat = Deno.env.get("LOG_FORMAT");
  const originalDebug = console.debug;
  const output: string[] = [];

  try {
    Deno.env.set("VERYFRONT_PERF", "1");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    Deno.env.set("LOG_FORMAT", "json");
    __resetLoggerConfigForTests();
    console.debug = (line: string) => output.push(line);
    const perf = await import("./perf-timer.ts?enabled-tests");
    await fn(perf, output);
  } finally {
    console.debug = originalDebug;
    if (previousPerf === undefined) Deno.env.delete("VERYFRONT_PERF");
    else Deno.env.set("VERYFRONT_PERF", previousPerf);
    if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", previousLevel);
    if (previousFormat === undefined) Deno.env.delete("LOG_FORMAT");
    else Deno.env.set("LOG_FORMAT", previousFormat);
    __resetLoggerConfigForTests();
  }
}

describe("perf-timer", () => {
  describe("isEnabled", () => {
    it("should return a boolean", () => {
      assertEquals(typeof isEnabled(), "boolean");
    });
  });

  describe("startRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      startRequest("test-request-1");
    });
  });

  describe("endRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      endRequest("test-request-1");
    });

    it("should not throw for unknown request ID", () => {
      endRequest("nonexistent-request");
    });
  });

  describe("startTimer (disabled mode)", () => {
    it("should return a no-op function", () => {
      const stop = startTimer("test-label");
      assertEquals(typeof stop, "function");
      stop();
    });

    it("should accept optional parent parameter", () => {
      const stop = startTimer("child-label", "parent-label");
      assertEquals(typeof stop, "function");
      stop();
    });
  });

  describe("timeAsync", () => {
    it("should execute and return the result of the async function", async () => {
      assertEquals(await timeAsync("test", () => Promise.resolve(42)), 42);
    });

    it("should propagate errors from the async function", async () => {
      try {
        await timeAsync("test", () => {
          throw new Error("test error");
        });
        assertEquals(true, false);
      } catch (e) {
        assertEquals((e as Error).message, "test error");
      }
    });

    it("should accept optional parent parameter", async () => {
      assertEquals(await timeAsync("child", () => Promise.resolve("ok"), "parent"), "ok");
    });

    it("should handle promises that resolve after delay", async () => {
      const result = await timeAsync("delayed", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "delayed-result";
      });
      assertEquals(result, "delayed-result");
    });

    it("should keep overlapping request timings isolated", async () => {
      await withEnabledPerfTimer(async (perf, output) => {
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        let firstEnded: (() => void) | undefined;
        const firstDone = new Promise<void>((resolve) => {
          firstEnded = resolve;
        });

        perf.startRequest("request-a");
        const first = (async () => {
          await firstGate;
          await perf.timeAsync("only-a", () => Promise.resolve());
          perf.endRequest("request-a");
          firstEnded?.();
        })();

        perf.startRequest("request-b");
        const second = (async () => {
          releaseFirst?.();
          await firstDone;
          await perf.timeAsync("only-b", () => Promise.resolve());
          perf.endRequest("request-b");
        })();

        await Promise.all([first, second]);

        const entries = output
          .map((line) => JSON.parse(line) as LogEntry)
          .filter((entry) => entry.component === "perf");
        assertEquals(entries.length, 2);

        const byRequest = new Map(entries.map((entry) => [entry.requestId, entry]));
        const labels = (entry: LogEntry | undefined): string[] =>
          ((entry?.context?.breakdown ?? []) as Array<{ label: string }>).map((item) => item.label);
        assertEquals(labels(byRequest.get("request-a")), ["only-a"]);
        assertEquals(labels(byRequest.get("request-b")), ["only-b"]);
      });
    });

    it("does not attach an unscoped legacy timer to another active request", async () => {
      await withEnabledPerfTimer(async (perf, output) => {
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        let firstDone: (() => void) | undefined;
        const firstFinished = new Promise<void>((resolve) => {
          firstDone = resolve;
        });

        perf.startRequest("legacy-a");
        const first = (async () => {
          await firstGate;
          perf.endRequest("legacy-a");
          const stop = perf.startTimer("must-not-cross-associate");
          stop();
          firstDone?.();
        })();

        perf.startRequest("legacy-b");
        const stopB = perf.startTimer("only-b");
        stopB();
        releaseFirst?.();
        await firstFinished;
        perf.endRequest("legacy-b");
        await first;

        const entry = output
          .map((line) => JSON.parse(line) as LogEntry)
          .find((candidate) => candidate.requestId === "legacy-b");
        const labels = (entry?.context?.breakdown ?? []) as Array<{ label: string }>;
        assertEquals(labels.map((item) => item.label), ["only-b"]);
      });
    });

    it("should finish a timing when the operation rejects", async () => {
      await withEnabledPerfTimer(async (perf, output) => {
        perf.startRequest("request-error");
        await assertRejects(
          () => perf.timeAsync("failing-operation", () => Promise.reject(new Error("boom"))),
          Error,
          "boom",
        );
        perf.endRequest("request-error");

        const entry = output
          .map((line) => JSON.parse(line) as LogEntry)
          .find((candidate) => candidate.requestId === "request-error");
        const breakdown = (entry?.context?.breakdown ?? []) as Array<{ label: string }>;
        assertEquals(breakdown.map((item) => item.label), ["failing-operation"]);
      });
    });

    it("should end a scoped request when its operation rejects", async () => {
      await withEnabledPerfTimer(async (perf, output) => {
        await assertRejects(
          () =>
            perf.runWithRequestTiming("request-scoped-error", async () => {
              await perf.timeAsync("scoped-operation", () => Promise.reject(new Error("boom")));
            }),
          Error,
          "boom",
        );

        const stopAfterEnd = perf.startTimer("must-not-attach");
        stopAfterEnd();
        const entry = output
          .map((line) => JSON.parse(line) as LogEntry)
          .find((candidate) => candidate.requestId === "request-scoped-error");
        const breakdown = (entry?.context?.breakdown ?? []) as Array<{ label: string }>;
        assertEquals(breakdown.map((item) => item.label), ["scoped-operation"]);
      });
    });
  });
});
