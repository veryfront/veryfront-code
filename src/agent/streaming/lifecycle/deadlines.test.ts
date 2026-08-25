import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runStreamLifecycle } from "./runner.ts";
import { createControllableSignalProvider, ManualMonotonicClock } from "./testing.ts";

describe("stream lifecycle deadlines", () => {
  it("does not let five-second status telemetry extend tool-input idle", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        toolInputIdleTimeoutMs: 15_000,
        statusIntervalMs: 5_000,
        attemptTimeoutMs: 60_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
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
    await iterator.next();

    for (let heartbeat = 0; heartbeat < 2; heartbeat++) {
      const pending = iterator.next();
      clock.advanceBy(5_000);
      const frame = await pending;
      assertEquals(frame.value?.class, "telemetry");
    }
    const terminal = iterator.next();
    clock.advanceBy(5_000);
    await terminal;
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "TOOL_INPUT_TIMEOUT");
    }
    assertEquals(provider.nextCount, 2);
    assertEquals(clock.pendingWaitCount, 0);
  });

  it("pauses provider idle while a frame is held but keeps total attempt time", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        semanticIdleTimeoutMs: 15_000,
        statusIntervalMs: 5_000,
        attemptTimeoutMs: 30_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    const firstRead = iterator.next();
    provider.resolveNext({
      done: false,
      value: { kind: "protocol", event: { type: "text_start", id: "text-1" } },
    });
    const held = await firstRead;
    assertEquals(held.value?.class, "semantic");
    clock.advanceBy(20_000);
    assertEquals(
      await Promise.race([
        run.outcome.then(() => "settled"),
        Promise.resolve("pending"),
      ]),
      "pending",
    );

    const pending = iterator.next();
    clock.advanceBy(10_000);
    assertEquals((await pending).done, true);
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "STREAM_ATTEMPT_TIMEOUT");
    }
  });

  it("kills a provider that never starts after the first-progress budget", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        firstProgressTimeoutMs: 60_000,
        semanticIdleTimeoutMs: 15_000,
        statusIntervalMs: 60_000,
        attemptTimeoutMs: 300_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    const pending = iterator.next();

    clock.advanceBy(15_000);
    assertEquals(
      clock.pendingWaitCount,
      2,
      "the first-progress budget must outlast the semantic-idle budget for a provider that never starts",
    );

    clock.advanceBy(45_000);
    assertEquals((await pending).done, true, "the first-progress deadline must end the stream");
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed", "a provider that never starts must fail the stream");
    if (outcome.status === "failed") {
      assertEquals(
        outcome.error.code,
        "FIRST_PROGRESS_TIMEOUT",
        "a provider that never starts must fail with the first-progress code",
      );
    }
    assertEquals(
      outcome.elapsedMs,
      60_000,
      "first progress must be budgeted from firstProgressTimeoutMs",
    );
  });

  it("kills a provider that stalls mid-stream after the semantic-idle budget", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        firstProgressTimeoutMs: 60_000,
        semanticIdleTimeoutMs: 15_000,
        statusIntervalMs: 60_000,
        attemptTimeoutMs: 300_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
    const firstRead = iterator.next();
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: { type: "text_content", id: "text-1", delta: "hello" },
      },
    });
    assertEquals(
      (await firstRead).value?.class,
      "semantic",
      "the implicit text start must surface as a semantic frame",
    );
    assertEquals(
      (await iterator.next()).value?.class,
      "diagnostic",
      "the implicit text start must be reported as a protocol repair",
    );
    assertEquals(
      (await iterator.next()).value?.class,
      "semantic",
      "the text content must surface as a semantic frame",
    );

    const pending = iterator.next();
    clock.advanceBy(14_999);
    assertEquals(
      clock.pendingWaitCount,
      2,
      "the semantic-idle budget must still be armed just before it elapses",
    );

    clock.advanceBy(1);
    assertEquals(
      clock.pendingWaitCount,
      1,
      "semantic idle must elapse on the semantic-idle budget, not the first-progress budget",
    );
    assertEquals((await pending).done, true, "the semantic-idle deadline must end the stream");
    const outcome = await run.outcome;
    assertEquals(
      outcome.status,
      "failed",
      "a provider that stalls mid-stream must fail the stream",
    );
    if (outcome.status === "failed") {
      assertEquals(
        outcome.error.code,
        "SEMANTIC_IDLE_TIMEOUT",
        "a provider that stalls mid-stream must fail with the semantic-idle code",
      );
    }
    assertEquals(
      outcome.elapsedMs,
      15_000,
      "semantic idle must be budgeted from semanticIdleTimeoutMs",
    );
  });

  it("prefers the provider deadline over a read that settled after it", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        toolInputIdleTimeoutMs: 20_000,
        statusIntervalMs: 60_000,
        attemptTimeoutMs: 120_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
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
    await iterator.next();

    const pending = iterator.next();
    // The clock passes the armed idle deadline before the provider part lands,
    // so the tracked read settles strictly after the deadline it lost to.
    clock.advanceBy(21_000);
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

    assertEquals(
      (await pending).done,
      true,
      "a part that settles after the idle deadline must not defer the deadline",
    );
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed", "the late part must not rescue the stalled tool input");
    if (outcome.status === "failed") {
      assertEquals(
        outcome.error.code,
        "TOOL_INPUT_TIMEOUT",
        "the provider deadline must win over a late-settled cached read",
      );
    }
  });

  it("resumes the remaining provider-wait budget after consumer backpressure", async () => {
    const clock = new ManualMonotonicClock();
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        toolInputIdleTimeoutMs: 15_000,
        statusIntervalMs: 60_000,
        attemptTimeoutMs: 60_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
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
    await iterator.next();

    // Registered custom metadata yields one semantic frame, but it is not one
    // of the reducer-approved semantic-progress events and cannot reset tool
    // idle.
    const heldFrame = iterator.next();
    clock.advanceBy(5_000);
    provider.resolveNext({
      done: false,
      value: {
        kind: "protocol",
        event: { type: "custom", name: "provider-metadata", data: null },
      },
    });
    assertEquals((await heldFrame).value?.class, "semantic");

    clock.advanceBy(20_000);
    const pending = iterator.next();
    clock.advanceBy(9_999);
    assertEquals(
      await Promise.race([
        pending.then(() => "settled"),
        Promise.resolve("pending"),
      ]),
      "pending",
    );
    clock.advanceBy(1);
    assertEquals((await pending).done, true);
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "TOOL_INPUT_TIMEOUT");
      assertEquals(outcome.error.source, "tool");
    }
  });

  it("discards a cached provider result when the attempt deadline wins", async () => {
    const clock = new ManualMonotonicClock();
    clock.advanceBy(1_000);
    const provider = createControllableSignalProvider();
    const run = runStreamLifecycle({
      provider,
      policy: {
        clock,
        statusIntervalMs: 5_000,
        toolInputIdleTimeoutMs: 20_000,
        attemptTimeoutMs: 30_000,
      },
    });
    const iterator = run.frames[Symbol.asyncIterator]();
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
    await iterator.next();
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
    clock.advanceBy(25_000);
    const outcome = await run.outcome;
    assertEquals(outcome.status, "failed");
    if (outcome.status === "failed") {
      assertEquals(outcome.error.code, "STREAM_ATTEMPT_TIMEOUT");
      assertEquals(outcome.error.source, "runtime");
    }
    assertEquals(outcome.elapsedMs, 30_000);
    assertEquals((await iterator.next()).done, true);
  });
});
