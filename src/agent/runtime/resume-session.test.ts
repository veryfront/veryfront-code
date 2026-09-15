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
import { authorizeRunControl } from "./run-control-authority.ts";

/**
 * The cancel-and-tombstone path takes verified authority rather than a run id,
 * so a test that wants a tombstone has to go through the same authorizer a
 * remote caller does.
 */
async function cancelWithAuthority(
  manager: RunResumeSessionManager<{ ok: boolean }>,
  runId: string,
): Promise<boolean> {
  const authority = await authorizeRunControl(() => true, {
    request: new Request(`https://runtime.example.test/api/runs/${runId}`, { method: "DELETE" }),
    runId,
    operation: "cancel",
  });
  if (!authority) throw new Error("Test authorizer must grant authority");
  return manager.cancelRunWithAuthority(authority);
}

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

  it("rejects a start that arrives after cancellation and expires the cancellation tombstone", async () => {
    using time = new FakeTime(1_000);
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      cancellationTtlMs: 1,
    });

    assertEquals(await cancelWithAuthority(manager, "run_1"), false);
    assertThrows(
      () => manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      RunCancelledError,
      "cancelled before start",
    );

    time.tick(2);

    const signal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(signal.aborted, false);
  });

  it("bounds remembered cancellations while preserving the newest tombstone", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      maxCancellationTombstones: 1,
    });

    assertEquals(await cancelWithAuthority(manager, "run_1"), false);
    assertEquals(await cancelWithAuthority(manager, "run_2"), false);

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

  /**
   * A run parked on an integration auth wall is cancelled without a tombstone and
   * resumed under the same run id. The cancelled execution can still settle after
   * the resume starts, and finalizing by run id alone would end the resumed
   * session instead of its own.
   */
  it("finalizes only the session that owns the given signal", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const parkedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    manager.cancelRun("run_1");
    const resumedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    manager.completeRun("run_1", parkedSignal);
    manager.failRun("run_1", parkedSignal);
    assertEquals(
      manager.getRunStatus("run_1"),
      "running",
      "a stale execution must not finalize the resumed session",
    );

    manager.completeRun("run_1", resumedSignal);
    assertEquals(
      manager.getRunStatus("run_1"),
      null,
      "the owning execution still finalizes its session",
    );
  });

  /**
   * An integration-auth park cancels the in-flight turn and later resumes the
   * same run. Its authorized cancellation must not leave the tombstone that
   * refuses a delayed start, or the resume start is refused too.
   */
  it("keeps a run startable after an authorized cancellation that is not remembered", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    const authority = await authorizeRunControl(() => true, {
      request: new Request("https://runtime.example.test/api/runs/run_1", { method: "DELETE" }),
      runId: "run_1",
      operation: "cancel",
    });
    if (!authority) throw new Error("Test authorizer must grant authority");

    assertEquals(manager.cancelRunWithAuthority(authority, { rememberCancellation: false }), true);
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(manager.getRunStatus("run_1"), "running");

    manager.completeRun("run_1");
    assertEquals(await cancelWithAuthority(manager, "run_1"), false);
    assertThrows(
      () => manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      RunCancelledError,
      "cancelled before start",
    );
  });

  /**
   * A park cancellation names the event the park settled at. It must stop the
   * turn that started before the park, and leave alone a resumed start that
   * reused the run id after it, even when the park cancel arrives late.
   */
  it("cancels for a park only a session that started before the parked event", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const grant = async () => {
      const authority = await authorizeRunControl(() => true, {
        request: new Request("https://runtime.example.test/api/runs/run_1", { method: "DELETE" }),
        runId: "run_1",
        operation: "cancel",
      });
      if (!authority) throw new Error("Test authorizer must grant authority");
      return authority;
    };

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 10 });
    assertEquals(
      manager.cancelRunWithAuthority(await grant(), {
        rememberCancellation: false,
        onlyIfStartedBeforeEventId: 20,
      }),
      true,
      "the parked turn started before the park and is cancelled",
    );

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 20 });
    assertEquals(
      manager.cancelRunWithAuthority(await grant(), {
        rememberCancellation: false,
        onlyIfStartedBeforeEventId: 20,
      }),
      false,
      "a late park cancel must not cancel the resumed start",
    );
    assertEquals(manager.getRunStatus("run_1"), "running");
  });

  /**
   * A park cancel can find no session: the parked execution already ended while
   * a retry of its original start is still on its way. That retry must not run
   * the parked turn again, but the resume, dispatched from the parked event or
   * later, must still start.
   */
  it("refuses a delayed start of the parked generation after a park cancel and starts the resume", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const authority = await authorizeRunControl(() => true, {
      request: new Request("https://runtime.example.test/api/runs/run_1", { method: "DELETE" }),
      runId: "run_1",
      operation: "cancel",
    });
    if (!authority) throw new Error("Test authorizer must grant authority");

    assertEquals(
      manager.cancelRunWithAuthority(authority, {
        rememberCancellation: false,
        onlyIfStartedBeforeEventId: 20,
      }),
      false,
    );

    assertThrows(
      () =>
        manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 10 }),
      RunCancelledError,
      "cancelled before start",
    );
    assertThrows(
      () => manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() }),
      RunCancelledError,
      "cancelled before start",
    );
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 20 });
    assertEquals(manager.getRunStatus("run_1"), "running");
  });

  it("keeps the strictest remembered cancellation when park cancels follow", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const grant = async (runId: string) => {
      const authority = await authorizeRunControl(() => true, {
        request: new Request(`https://runtime.example.test/api/runs/${runId}`, {
          method: "DELETE",
        }),
        runId,
        operation: "cancel",
      });
      if (!authority) throw new Error("Test authorizer must grant authority");
      return authority;
    };
    const parkCancel = async (runId: string, parkedAfterEventId: number) =>
      manager.cancelRunWithAuthority(await grant(runId), {
        rememberCancellation: false,
        onlyIfStartedBeforeEventId: parkedAfterEventId,
      });

    assertEquals(await cancelWithAuthority(manager, "run_cancelled"), false);
    await parkCancel("run_cancelled", 20);
    assertThrows(
      () =>
        manager.startRun({
          runId: "run_cancelled",
          threadId: crypto.randomUUID(),
          startedFromEventId: 30,
        }),
      RunCancelledError,
      "cancelled before start",
    );

    await parkCancel("run_parked_twice", 40);
    await parkCancel("run_parked_twice", 20);
    assertThrows(
      () =>
        manager.startRun({
          runId: "run_parked_twice",
          threadId: crypto.randomUUID(),
          startedFromEventId: 30,
        }),
      RunCancelledError,
      "cancelled before start",
    );
    manager.startRun({
      runId: "run_parked_twice",
      threadId: crypto.randomUUID(),
      startedFromEventId: 40,
    });
    assertEquals(manager.getRunStatus("run_parked_twice"), "running");
  });

  it("reports a run superseded only when another session owns its run id", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const parkedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(
      manager.isSupersededRun("run_1", parkedSignal),
      false,
      "an owner is not superseded",
    );

    manager.cancelRun("run_1");
    assertEquals(
      manager.isSupersededRun("run_1", parkedSignal),
      false,
      "a cancelled run with no newer session is not superseded",
    );

    const resumedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(manager.isSupersededRun("run_1", parkedSignal), true);
    assertEquals(manager.isSupersededRun("run_1", resumedSignal), false);
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
