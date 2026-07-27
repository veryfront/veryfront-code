import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runProxyShutdownSteps } from "./shutdown.ts";

describe("proxy shutdown cleanup", () => {
  it("runs cleanup steps in order when they complete", async () => {
    const events: string[] = [];

    const failures = await runProxyShutdownSteps([
      {
        name: "first",
        run: () => {
          events.push("first");
        },
      },
      {
        name: "second",
        run: async () => {
          await Promise.resolve();
          events.push("second");
        },
      },
    ], 100);

    assertEquals(events, ["first", "second"]);
    assertEquals(failures, []);
    assertEquals(Object.isFrozen(failures), true);
  });

  it("records failures and still starts every later step", async () => {
    const events: string[] = [];
    const expected = new Error("first failed");

    const failures = await runProxyShutdownSteps([
      {
        name: "first",
        run: () => {
          events.push("first");
          throw expected;
        },
      },
      {
        name: "second",
        run: () => {
          events.push("second");
          return Promise.reject(new Error("second failed"));
        },
      },
      {
        name: "third",
        run: () => {
          events.push("third");
        },
      },
    ], 100);

    assertEquals(events, ["first", "second", "third"]);
    assertEquals(failures.map(({ step, status }) => ({ step, status })), [
      { step: "first", status: "failed" },
      { step: "second", status: "failed" },
    ]);
    assertEquals(failures[0]?.status === "failed" && failures[0].error, expected);
  });

  it("isolates an unreadable thenable returned across the step boundary", async () => {
    const events: string[] = [];
    const unreadable = Object.defineProperty({}, "then", {
      get() {
        throw new Error("then is unreadable");
      },
    });

    const failures = await runProxyShutdownSteps([
      {
        name: "unreadable",
        run: () => unreadable as Promise<void>,
      },
      {
        name: "later",
        run: () => {
          events.push("later");
        },
      },
    ], 100);

    assertEquals(events, ["later"]);
    assertEquals(failures.map(({ step, status }) => ({ step, status })), [
      { step: "unreadable", status: "failed" },
    ]);
  });

  it("bounds a stalled step and still starts every later step", async () => {
    const events: string[] = [];
    const startedAt = performance.now();

    const failures = await runProxyShutdownSteps([
      {
        name: "stalled",
        run: () => {
          events.push("stalled");
          return new Promise<void>(() => {});
        },
      },
      {
        name: "after-deadline",
        run: () => {
          events.push("after-deadline");
          return new Promise<void>(() => {});
        },
      },
      {
        name: "synchronous-finalizer",
        run: () => {
          events.push("synchronous-finalizer");
        },
      },
    ], 5);

    assertEquals(performance.now() - startedAt < 500, true);
    assertEquals(events, [
      "stalled",
      "after-deadline",
      "synchronous-finalizer",
    ]);
    assertEquals(failures, [
      { step: "stalled", status: "timeout" },
      { step: "after-deadline", status: "timeout" },
    ]);
  });

  it("rejects malformed cleanup policy before starting work", async () => {
    let calls = 0;
    await assertRejects(
      () =>
        runProxyShutdownSteps([{
          name: "cleanup",
          run: () => {
            calls++;
          },
        }], Number.NaN),
      RangeError,
      "cleanup timeout",
    );
    await assertRejects(
      () =>
        runProxyShutdownSteps([{
          name: " cleanup ",
          run: () => {
            calls++;
          },
        }], 100),
      TypeError,
      "canonical name",
    );
    assertEquals(calls, 0);
  });
});
