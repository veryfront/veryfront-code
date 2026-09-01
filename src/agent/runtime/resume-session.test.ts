import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  RunAlreadyExistsError,
  RunCancelledError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "./resume-session.ts";

function createManualTimers(): {
  callbacks: Array<() => void>;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
} {
  const callbacks: Array<() => void> = [];
  const setTimeoutFn: typeof setTimeout = (callback, _delay, ...args) => {
    callbacks.push(() => {
      if (typeof callback !== "function") {
        throw new TypeError("String timer handlers are unsupported in resume-session tests");
      }
      callback(...args);
    });
    return globalThis.setTimeout(() => {}, 60_000);
  };
  return {
    callbacks,
    setTimeoutFn,
    clearTimeoutFn: globalThis.clearTimeout.bind(globalThis),
  };
}

describe("agent/runtime/resume-session", () => {
  it("accepts duplicate resume values and rejects conflicting ones", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      getConflictKey: (value) => JSON.stringify(value),
    });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = manager.waitForSignal("run_1", "tool_1");

    const first = manager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: { ok: true },
    });
    assertEquals(first, { accepted: true });
    assertEquals(await pending, { ok: true });

    const duplicate = manager.submitSignal("run_1", {
      waitKey: "tool_1",
      value: { ok: true },
    });
    assertEquals(duplicate, { accepted: true, duplicate: true });

    assertThrows(
      () => {
        manager.submitSignal("run_1", {
          waitKey: "tool_1",
          value: { ok: false },
        });
      },
      WaitConflictError,
    );
  });

  it("rejects a second startRun for a live runId and keeps the first session's signal", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const first = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = manager.waitForSignal("run_1", "tool_1");

    assertThrows(
      () => manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      RunAlreadyExistsError,
      "already active",
      "a live runId must not be admitted twice",
    );
    assertEquals(first.aborted, false, "the rejected duplicate must not disturb the live session");

    assertEquals(
      manager.cancelRun("run_1"),
      true,
      "the original session must still be cancellable",
    );
    assertEquals(first.aborted, true, "cancelRun must still reach the original AbortController");
    await assertRejects(
      () => pending,
      RunCancelledError,
      undefined,
      "the original parked waiter must still be settled by the cancel",
    );
  });

  it("rejects a start that arrives after cancellation and expires the cancellation tombstone", () => {
    using time = new FakeTime(1_000);
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      cancellationTtlMs: 1,
    });

    assertEquals(manager.cancelRun("run_1", { rememberIfMissing: true }), false);
    assertThrows(
      () => manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      RunCancelledError,
      "cancelled before start",
    );

    time.tick(2);

    const signal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(signal.aborted, false);
  });

  it("bounds remembered cancellations while preserving the newest tombstone", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      maxCancellationTombstones: 1,
    });

    assertEquals(manager.cancelRun("run_1", { rememberIfMissing: true }), false);
    assertEquals(manager.cancelRun("run_2", { rememberIfMissing: true }), false);

    const first = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(first.aborted, false);
    assertThrows(
      () => manager.startRun({ runId: "run_2", threadId: crypto.randomUUID() }),
      RunCancelledError,
      "cancelled before start",
    );
  });

  it("keeps an ordinary missing-run cancellation as a no-op", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();

    assertEquals(manager.cancelRun("run_1"), false);

    const signal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(signal.aborted, false);
  });

  it("does not remember an ordinary active-run cancellation", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    assertEquals(manager.cancelRun("run_1"), true);

    const signal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(signal.aborted, false);
  });

  it("rejects submissions for wait keys that are not currently pending", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    assertThrows(
      () => {
        manager.submitSignal("run_1", {
          waitKey: "tool_1",
          value: { ok: true },
        });
      },
      WaitNotPendingError,
    );
  });

  it("buffers submissions for wait keys that were prepared before waiting starts", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    manager.prepareForSignal("run_1", "tool_1");

    assertEquals(
      manager.submitSignal("run_1", {
        waitKey: "tool_1",
        value: { ok: true },
      }),
      { accepted: true },
    );

    assertEquals(await manager.waitForSignal("run_1", "tool_1"), { ok: true });
  });

  it("cancels waiting runs and rejects the parked wait promise", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = manager.waitForSignal("run_1", "tool_1");
    assertEquals(manager.cancelRun("run_1"), true);

    await assertRejects(
      async () => {
        await pending;
      },
      RunCancelledError,
    );
    assertEquals(manager.getRunStatus("run_1"), null);
  });

  it("rejects a second parked wait for a different wait key", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = manager.waitForSignal("run_1", "tool_1");

    // Race against settled microtasks instead of awaiting the second wait
    // directly: a displaced wait would never settle and hang the test.
    const collision = await Promise.race([
      manager.waitForSignal("run_1", "tool_2").then(() => "resolved", (error) => error),
      Promise.resolve().then(() => Promise.resolve()).then(() => "still pending"),
    ]);
    assertEquals(
      collision instanceof WaitNotPendingError,
      true,
      "a second wait key must not silently displace the parked wait",
    );

    assertEquals(
      manager.submitSignal("run_1", { waitKey: "tool_1", value: { ok: true } }),
      { accepted: true },
      "the original wait must still be resolvable",
    );
    assertEquals(await pending, { ok: true }, "the first parked caller must receive its signal");
  });

  it("expires waiting runs after the configured TTL", async () => {
    const timers = createManualTimers();
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      waitingTtlMs: 1,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = manager.waitForSignal("run_1", "tool_1");
    assertEquals(manager.getRunStatus("run_1"), "waiting");

    timers.callbacks[0]?.();

    await assertRejects(
      async () => {
        await pending;
      },
      RunCancelledError,
    );
    assertEquals(manager.getRunStatus("run_1"), null);
  });

  it("evicts stale running sessions after the configured session TTL", () => {
    const timers = createManualTimers();
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      sessionTtlMs: 1,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(manager.getRunStatus("run_1"), "running");

    timers.callbacks[0]?.();

    assertEquals(manager.getRunStatus("run_1"), null);
  });

  it("rejects runs that exceed the configured concurrency limit", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({ maxConcurrentSessions: 1 });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    assertThrows(
      () => manager.startRun({ runId: "run_2", threadId: crypto.randomUUID() }),
      Error,
      "Maximum concurrent sessions (1) reached",
    );
  });

  it("frees the session slot when a run completes", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({ maxConcurrentSessions: 1 });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    manager.completeRun("run_1");

    assertEquals(manager.getRunStatus("run_1"), null, "a completed run must leave the session map");
    manager.startRun({ runId: "run_2", threadId: crypto.randomUUID() });
    assertEquals(manager.getRunStatus("run_2"), "running", "the freed slot must admit a new run");
  });

  it("frees the session slot when a run fails", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({ maxConcurrentSessions: 1 });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    manager.failRun("run_1");

    assertEquals(manager.getRunStatus("run_1"), null, "a failed run must leave the session map");
    manager.startRun({ runId: "run_2", threadId: crypto.randomUUID() });
    assertEquals(manager.getRunStatus("run_2"), "running", "the freed slot must admit a new run");
  });

  it("does not leak session slots across repeated completed runs", () => {
    const maxConcurrentSessions = 2;
    const manager = new RunResumeSessionManager<{ ok: boolean }>({ maxConcurrentSessions });

    for (let index = 0; index <= maxConcurrentSessions; index += 1) {
      const runId = `run_${index}`;
      manager.startRun({ runId, threadId: crypto.randomUUID() });
      manager.completeRun(runId);
      assertEquals(manager.getRunStatus(runId), null, `${runId} must be released after completion`);
    }
  });

  it("aborts the run signal with a DOMException AbortError so downstream fetch consumers don't leak unhandled rejections", () => {
    // Regression: previously aborted with `new RunCancelledError()`, which
    // surfaced as a non-AbortError rejection inside provider SDK fetch
    // promises and crashed the host process via unhandledRejection.
    const manager = new RunResumeSessionManager<{ ok: boolean }>({});
    const signal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    manager.cancelRun("run_1");

    assertEquals(signal.aborted, true);
    assertEquals(signal.reason instanceof DOMException, true);
    assertEquals((signal.reason as DOMException).name, "AbortError");
  });

  it("still rejects in-flight waitForSignal callers with RunCancelledError after cancel", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({});
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const pending = manager.waitForSignal("run_1", "tool_1");

    manager.cancelRun("run_1");

    await assertRejects(() => pending, RunCancelledError);
  });

  it("aborts active work and rejects parked waiters when reset", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({});
    const runningSignal = manager.startRun({
      runId: "run_running",
      threadId: crypto.randomUUID(),
    });
    const waitingSignal = manager.startRun({
      runId: "run_waiting",
      threadId: crypto.randomUUID(),
    });
    const pending = manager.waitForSignal("run_waiting", "tool_1");

    manager.reset();

    assertEquals(runningSignal.aborted, true);
    assertEquals(waitingSignal.aborted, true);
    assertEquals((runningSignal.reason as DOMException).name, "AbortError");
    assertEquals((waitingSignal.reason as DOMException).name, "AbortError");
    await assertRejects(() => pending, RunCancelledError);
    assertEquals(manager.getRunStatus("run_running"), null);
    assertEquals(manager.getRunStatus("run_waiting"), null);
  });
});
