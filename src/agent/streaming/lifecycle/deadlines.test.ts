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
