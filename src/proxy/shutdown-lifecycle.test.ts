import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProxyDrainAdmission } from "./request-drain.ts";
import { parseProxyShutdownCleanupTimeoutMs, runProxyShutdownSteps } from "./shutdown-lifecycle.ts";

describe("proxy shutdown lifecycle", () => {
  it("attempts every owner in order and preserves each failure", async () => {
    const events: string[] = [];
    const reported: string[] = [];
    const failures = await runProxyShutdownSteps([
      {
        name: "routing bus",
        run: () => {
          events.push("routing bus");
          throw new Error("routing close failed");
        },
      },
      {
        name: "handler",
        run: async () => {
          events.push("handler");
          throw new Error("handler close failed");
        },
      },
      {
        name: "extension owners",
        run: () => {
          events.push("extension owners");
        },
      },
      {
        name: "telemetry",
        run: () => {
          events.push("telemetry");
        },
      },
    ], {
      timeoutMs: 100,
      onFailure: ({ step }) => reported.push(step),
    });

    assertEquals(events, ["routing bus", "handler", "extension owners", "telemetry"]);
    assertEquals(reported, ["routing bus", "handler"]);
    assertEquals(
      failures.map(({ step, timedOut, error }) => ({
        step,
        timedOut,
        message: error instanceof Error ? error.message : String(error),
      })),
      [
        { step: "routing bus", timedOut: false, message: "routing close failed" },
        { step: "handler", timedOut: false, message: "handler close failed" },
      ],
    );
  });

  it("skips a dependent owner after its borrower stalls but runs independent cleanup", async () => {
    const events: string[] = [];
    const failures = await runProxyShutdownSteps([
      {
        name: "stalled handler",
        run: () => {
          events.push("stalled handler");
          return new Promise<void>(() => {});
        },
      },
      {
        name: "extension owners",
        requires: ["stalled handler"],
        run: () => {
          events.push("extension owners");
        },
      },
      {
        name: "telemetry",
        run: () => {
          events.push("telemetry");
        },
      },
    ], { timeoutMs: 0 });

    assertEquals(events, ["stalled handler", "telemetry"]);
    assertEquals(failures.length, 2);
    assertEquals(failures[0]?.step, "stalled handler");
    assertEquals(failures[0]?.timedOut, true);
    assertEquals(failures[0]?.error instanceof DOMException, true);
    assertEquals(failures[1]?.step, "extension owners");
    assertEquals(
      failures[1]?.error instanceof Error ? failures[1].error.message : "",
      "Skipped extension owners: prerequisite stalled handler did not complete",
    );
  });

  it("keeps failure reporting from blocking later owners", async () => {
    let finalizerCalls = 0;
    const failures = await runProxyShutdownSteps([
      { name: "failed", run: () => Promise.reject("primitive failure") },
      {
        name: "finalizer",
        run: () => {
          finalizerCalls++;
        },
      },
    ], {
      timeoutMs: 100,
      onFailure: () => {
        throw new Error("reporter failed");
      },
    });

    assertEquals(finalizerCalls, 1);
    assertEquals(failures.length, 1);
    assertEquals(failures[0]?.error, "primitive failure");
  });

  it("observes a failure that arrives after the cleanup deadline", async () => {
    const operation = Promise.withResolvers<void>();
    const reports: Array<{ timedOut: boolean; error: unknown }> = [];
    const failures = await runProxyShutdownSteps([
      { name: "late owner", run: () => operation.promise },
    ], {
      timeoutMs: 0,
      onFailure: ({ timedOut, error }) => reports.push({ timedOut, error }),
    });

    assertEquals(failures.length, 1);
    assertEquals(reports.map(({ timedOut }) => timedOut), [true]);
    operation.reject(new Error("late teardown failure"));
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(
      reports.map(({ timedOut, error }) => ({
        timedOut,
        message: error instanceof Error ? error.message : String(error),
      })),
      [
        {
          timedOut: true,
          message: "Proxy shutdown cleanup deadline exceeded during late owner",
        },
        { timedOut: false, message: "late teardown failure" },
      ],
    );
  });

  it("uses host intrinsics captured before extension code mutates them", async () => {
    const resolveDescriptor = Object.getOwnPropertyDescriptor(Promise, "resolve")!;
    const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
    const timerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
    let settlement: Promise<readonly unknown[]> | undefined;

    try {
      Object.defineProperty(Promise, "resolve", {
        ...resolveDescriptor,
        value: () => {
          throw new Error("poisoned Promise.resolve");
        },
      });
      Object.defineProperty(Promise.prototype, "then", {
        ...thenDescriptor,
        value: () => {
          throw new Error("poisoned Promise.prototype.then");
        },
      });
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: timerDescriptor.configurable,
        enumerable: timerDescriptor.enumerable,
        writable: true,
        value: () => {
          throw new Error("poisoned setTimeout");
        },
      });

      settlement = runProxyShutdownSteps([
        { name: "async owner", run: async () => {} },
      ], { timeoutMs: 100 });
    } finally {
      Object.defineProperty(Promise, "resolve", resolveDescriptor);
      Object.defineProperty(Promise.prototype, "then", thenDescriptor);
      Object.defineProperty(globalThis, "setTimeout", timerDescriptor);
    }

    assertEquals(await settlement, []);
  });

  it("waits out the admission grace window on the timer captured before extensions load", async () => {
    const admission = new ProxyDrainAdmission(5, () => 0);
    admission.begin("SIGTERM");
    const timerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
    let wait: Promise<void> | undefined;
    try {
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: timerDescriptor.configurable,
        enumerable: timerDescriptor.enumerable,
        writable: true,
        value: () => {
          throw new Error("poisoned setTimeout");
        },
      });
      wait = admission.waitForWindow();
    } finally {
      Object.defineProperty(globalThis, "setTimeout", timerDescriptor);
    }

    assertEquals(await wait, undefined);
  });

  it("starts and waits out the admission grace on the clock captured before extensions load", async () => {
    const admission = new ProxyDrainAdmission(1);
    // Deno defines `now` on Performance.prototype; Bun on the instance.
    const nowOwner: object = Object.hasOwn(performance, "now")
      ? performance
      : Performance.prototype;
    const nowDescriptor = Object.getOwnPropertyDescriptor(nowOwner, "now")!;
    let wait: Promise<void> | undefined;
    let admitsStream: boolean | undefined;
    try {
      Object.defineProperty(nowOwner, "now", {
        ...nowDescriptor,
        value: () => {
          throw new Error("poisoned performance.now");
        },
      });
      admission.begin("SIGTERM");
      admitsStream = admission.admits(
        new Request("http://proxy.test/events", { headers: { accept: "text/event-stream" } }),
        "/events",
      );
      wait = admission.waitForWindow();
    } finally {
      Object.defineProperty(nowOwner, "now", nowDescriptor);
    }

    assertEquals(admitsStream, false);
    assertEquals(await wait, undefined);
    assertEquals(admission.getGrantedMs(), 1);
  });

  it("computes the grace wait and drain budget with math captured before extensions load", async () => {
    const admission = new ProxyDrainAdmission(1, () => 0);
    admission.begin("SIGTERM");
    const maxDescriptor = Object.getOwnPropertyDescriptor(Math, "max")!;
    const ceilDescriptor = Object.getOwnPropertyDescriptor(Math, "ceil")!;
    const floorDescriptor = Object.getOwnPropertyDescriptor(Math, "floor")!;
    const poisoned = () => {
      throw new Error("poisoned Math");
    };
    let wait: Promise<void> | undefined;
    let budget: number | undefined;
    try {
      Object.defineProperty(Math, "max", { ...maxDescriptor, value: poisoned });
      Object.defineProperty(Math, "ceil", { ...ceilDescriptor, value: poisoned });
      Object.defineProperty(Math, "floor", { ...floorDescriptor, value: poisoned });
      wait = admission.waitForWindow();
      budget = admission.remainingDrainBudgetMs(25);
    } finally {
      Object.defineProperty(Math, "max", maxDescriptor);
      Object.defineProperty(Math, "ceil", ceilDescriptor);
      Object.defineProperty(Math, "floor", floorDescriptor);
    }

    assertEquals(await wait, undefined);
    assertEquals(budget, 25);
  });

  it("rejects malformed shutdown step configurations", async () => {
    const ran: string[] = [];
    const record = (name: string) => ({
      name,
      run: () => {
        ran.push(name);
      },
    });

    await assertRejects(
      () =>
        runProxyShutdownSteps([record("http_server"), record("http_server")], {
          timeoutMs: 100,
        }),
      TypeError,
      "Duplicate proxy shutdown step: http_server",
    );

    await assertRejects(
      () =>
        runProxyShutdownSteps([
          { ...record("a"), requires: ["b"] },
          record("b"),
        ], { timeoutMs: 100 }),
      TypeError,
      "prerequisite must name an earlier step",
    );

    await assertRejects(
      () =>
        runProxyShutdownSteps([
          { name: "a", run: "not-a-function" as never },
          record("b"),
        ], { timeoutMs: 100 }),
      TypeError,
      "must have a name and run function",
    );

    await assertRejects(
      () =>
        runProxyShutdownSteps([
          { ...record("a"), requires: "b" as never },
          record("b"),
        ], { timeoutMs: 100 }),
      TypeError,
      "prerequisites must be an array",
    );

    assertEquals(ran, [], "a malformed step list must be rejected before any owner runs");
  });

  it("parses strict cleanup policy and rejects malformed values", () => {
    assertEquals(parseProxyShutdownCleanupTimeoutMs("3500"), 3_500);
    assertEquals(parseProxyShutdownCleanupTimeoutMs(undefined), 4_000);
    assertEquals(parseProxyShutdownCleanupTimeoutMs(""), 4_000);
    assertThrows(
      () => parseProxyShutdownCleanupTimeoutMs("invalid"),
      TypeError,
      "decimal integer",
    );
    assertThrows(
      () => parseProxyShutdownCleanupTimeoutMs("-1"),
      TypeError,
      "decimal integer",
    );
    // A numerically valid but oversized delay overflows the 32-bit timer and
    // fires immediately, starving every step of its cleanup window.
    assertEquals(parseProxyShutdownCleanupTimeoutMs("2147483647"), 2_147_483_647);
    assertThrows(
      () => parseProxyShutdownCleanupTimeoutMs("2147483648"),
      RangeError,
      "must be between 0 and 2147483647",
    );
    assertThrows(
      () => parseProxyShutdownCleanupTimeoutMs(undefined, -1),
      RangeError,
      "Default proxy shutdown cleanup timeout",
    );
  });
});
