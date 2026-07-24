import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { runStreamLifecycle } from "./runner.ts";
import {
  createControllableSignalProvider,
  createScriptedStreamProvider,
  ManualMonotonicClock,
} from "./testing.ts";
import type { StreamDiagnosticEvent } from "./types.ts";

describe("runStreamLifecycle", () => {
  it("opens lazily and rejects a second frame consumer", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    assertEquals(provider.openCount, 0);
    const first = run.frames[Symbol.asyncIterator]();
    assertEquals(provider.openCount, 0);
    assertThrows(
      () => run.frames[Symbol.asyncIterator](),
      StreamAlreadyConsumedError,
    );
    await first.next();
    assertEquals(provider.openCount, 1);
  });

  it("keeps outcome pending until frame iteration starts", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    let settled = false;
    void run.outcome.then(() => settled = true);
    await Promise.resolve();
    assertEquals(settled, false);
    await run.frames[Symbol.asyncIterator]().next();
    assertEquals((await run.outcome).status, "failed");
  });

  it("uses pre-aborted source precedence and records phase", async () => {
    const user = new AbortController();
    const parent = new AbortController();
    parent.abort("parent");
    user.abort("user");
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [
        { source: "parent", signal: parent.signal },
        { source: "user", signal: user.signal },
      ],
    });
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "user");
    assertEquals(outcome.phase, "cancelled");
    assertEquals(outcome.snapshot.phase, "cancelled");
  });

  it("turns consumer return into one cleanup request", async () => {
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.returnCount, 1);
  });

  it("records an abort after run creation but before first next without opening the provider", async () => {
    const controller = new AbortController();
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      cancellations: [{ source: "runtime", signal: controller.signal }],
    });

    controller.abort("runtime stop");
    assertEquals(provider.openCount, 0);
    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;

    assertEquals(provider.openCount, 0);
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") assertEquals(outcome.source, "runtime");
  });

  it("reports cancellation elapsed time relative to the attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const controller = new AbortController();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      cancellations: [{ source: "runtime", signal: controller.signal }],
      policy: {
        clock,
        attemptTimeoutMs: 30_000,
      },
    });

    const pending = run.frames[Symbol.asyncIterator]().next();
    clock.advanceBy(5);
    controller.abort("runtime stop");
    await pending;
    const outcome = await run.outcome;

    assertEquals(outcome.status, "cancelled");
    assertEquals(outcome.elapsedMs, 5);
  });

  it("reports cleanup failure without replacing the committed outcome", async () => {
    const cleanupError = new Error("cleanup sentinel");
    const reported: StreamDiagnosticEvent[] = [];
    const provider = createScriptedStreamProvider([
      { kind: "protocol", event: { type: "text_content", delta: "hello" } },
    ], { returnError: cleanupError });
    const run = runStreamLifecycle({
      provider,
      diagnosticSink: { report: (event) => reported.push(event) },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await Promise.resolve();

    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(reported.map((event) => event.type), [
      "provider_cleanup_failed",
    ]);
    assertEquals(
      JSON.stringify(reported).includes(cleanupError.message),
      false,
    );
  });

  it("reduces a cached provider result when the consumer resumes before the attempt limit", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        statusIntervalMs: 5_000,
        toolInputIdleTimeoutMs: 60_000,
        attemptTimeoutMs: 30_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    const firstRead = iterator.next();
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: {
          type: "tool_input_start",
          toolCallId: "t1",
          toolName: "create_file",
        },
      },
    });
    await firstRead;

    const status = iterator.next();
    clock.advanceBy(5_000);
    await status;
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: {
          type: "tool_input_content",
          toolCallId: "t1",
          delta: '{"path":"a.md"}',
        },
      },
    });
    clock.advanceBy(24_999);
    const cached = await iterator.next();
    assertEquals(cached.value?.class, "semantic");
    assertEquals(cached.value?.event.type, "tool_input_content");
    await iterator.return?.();
  });

  it("can stop before the first read without opening the provider", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    const iterator = run.frames[Symbol.asyncIterator]();
    await iterator.return?.();
    const outcome = await run.outcome;
    assertEquals(outcome.status, "cancelled");
    if (outcome.status === "cancelled") {
      assertEquals(outcome.source, "consumer_stopped");
    }
    assertEquals(provider.openCount, 0);
    assertEquals(provider.returnCount, 0);
  });

  it("reports early stream end elapsed time relative to a non-zero attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({
      provider,
      policy: { clock },
    });

    await run.frames[Symbol.asyncIterator]().next();
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    assertEquals(outcome.elapsedMs, 0);
  });

  it("reports provider error elapsed time relative to the attempt start", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: { clock, attemptTimeoutMs: 30_000 },
    });

    const pending = run.frames[Symbol.asyncIterator]().next();
    clock.advanceBy(37);
    provider.rejectNext(new Error("provider sentinel"));
    await pending;
    const outcome = await run.outcome;

    assertEquals(outcome.status, "failed");
    assertEquals(outcome.elapsedMs, 37);
  });
});
