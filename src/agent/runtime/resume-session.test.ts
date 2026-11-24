import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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
  const setTimeoutFn = Object.assign(
    (callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
      callbacks.push(() => {
        if (typeof callback !== "function") {
          throw new TypeError("String timer handlers are unsupported in resume-session tests");
        }
        callback(...args);
      });
      return globalThis.setTimeout(() => {}, 60_000);
    },
    globalThis.setTimeout,
  );
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

  it("remembers a fenced ordinary cancel only for starts before the fence", async () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const authority = await authorizeRunControl(() => true, {
      request: new Request("https://runtime.example.test/api/runs/run_1", { method: "DELETE" }),
      runId: "run_1",
      operation: "cancel",
    });
    if (!authority) throw new Error("Test authorizer must grant authority");

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 30 });
    assertEquals(manager.wasLatestStartBefore("run_1", 20), false);
    assertEquals(manager.wasLatestStartBefore("run_1", 31), true);
    assertEquals(manager.wasLatestStartBefore("missing", 20), false, "unknown is not before");
    assertEquals(
      manager.cancelRunWithAuthority(authority, { onlyIfStartedBeforeEventId: 20 }),
      false,
      "a newer start must not be cancelled",
    );
    assertEquals(manager.getRunStatus("run_1"), "running");
    manager.completeRun("run_1");

    assertThrows(
      () =>
        manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 10 }),
      RunCancelledError,
      "cancelled before start",
    );
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), startedFromEventId: 35 });
    assertEquals(manager.getRunStatus("run_1"), "running");
  });

  it("cancels a session of unknown generation for a park fence only", async () => {
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

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(
      manager.cancelRunWithAuthority(await grant(), {
        onlyIfStartedBeforeEventId: 20,
        cancelUnknownGeneration: false,
      }),
      false,
    );
    assertEquals(manager.getRunStatus("run_1"), "running");
    assertEquals(
      manager.cancelRunWithAuthority(await grant(), {
        rememberCancellation: false,
        onlyIfStartedBeforeEventId: 20,
      }),
      true,
      "a park fence keeps cancelling a session without generation metadata",
    );
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

  it("keeps a park-cancelled run superseded after the resumed run finished", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const parkedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    manager.cancelRun("run_1");
    const resumedSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    manager.completeRun("run_1", resumedSignal);

    assertEquals(manager.getRunStatus("run_1"), null);
    assertEquals(manager.isSupersededRun("run_1", parkedSignal), true);
    assertEquals(manager.isSupersededRun("run_1", resumedSignal), false);
  });

  it("does not supersede a cancelled run that settled before the next start", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    const firstSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    manager.cancelRun("run_1");
    manager.failRun("run_1", firstSignal);
    const secondSignal = manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    manager.completeRun("run_1", secondSignal);

    assertEquals(manager.isSupersededRun("run_1", firstSignal), false);
  });

  it("backpressures run-id reuse instead of evicting a still-settling cancellation", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    let overflowSignal: AbortSignal | undefined;

    for (let index = 0; index <= 1_000; index += 1) {
      const runId = `run_${index}`;
      const signal = manager.startRun({ runId, threadId: crypto.randomUUID() });
      manager.cancelRun(runId);
      if (index === 1_000) overflowSignal = signal;
    }

    assertExists(overflowSignal);
    assertEquals(manager.getRunStatus("run_1000"), "cancelled");
    assertThrows(
      () => manager.startRun({ runId: "run_1000", threadId: crypto.randomUUID() }),
      RunAlreadyExistsError,
    );

    manager.failRun("run_1000", overflowSignal);
    const replacement = manager.startRun({
      runId: "run_1000",
      threadId: crypto.randomUUID(),
    });
    manager.completeRun("run_1000", replacement);
    assertEquals(manager.isSupersededRun("run_1000", overflowSignal), false);
    manager.reset();
  });

  it("settles overflow cancellation bookkeeping without changing another producer", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    let overflowSignal: AbortSignal | undefined;

    for (let index = 0; index <= 1_000; index += 1) {
      const runId = `run_${index}`;
      const signal = manager.startRun({ runId, threadId: crypto.randomUUID() });
      manager.cancelRun(runId);
      if (index === 1_000) overflowSignal = signal;
    }

    assertExists(overflowSignal);
    assertEquals(manager.getRunStatus("run_1000"), "cancelled");
    assertThrows(
      () => manager.startRun({ runId: "run_1000", threadId: crypto.randomUUID() }),
      RunAlreadyExistsError,
    );

    const foreign = new AbortController();
    foreign.abort();
    manager.settleCancelledRun("run_1000", foreign.signal);
    assertEquals(manager.getRunStatus("run_1000"), "cancelled");
    manager.settleCancelledRun("run_1000", overflowSignal);
    assertEquals(manager.getRunStatus("run_1000"), null);
    const replacement = manager.startRun({
      runId: "run_1000",
      threadId: crypto.randomUUID(),
    });
    manager.settleCancelledRun("run_1000", overflowSignal);
    manager.settleCancelledRun("run_1000", replacement);
    assertEquals(manager.getRunStatus("run_1000"), "running");
    manager.cancelRun("run_1000");
    assertEquals(manager.getRunStatus("run_1000"), "cancelled");
    manager.settleCancelledRun("run_1000", overflowSignal);
    assertEquals(manager.getRunStatus("run_1000"), "cancelled");
    manager.settleCancelledRun("run_1000", replacement);
    assertEquals(manager.getRunStatus("run_1000"), null);
    assertEquals(manager.isSupersededRun("run_1000", overflowSignal), false);
    manager.reset();
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

describe("owned session cancellation", () => {
  it("ignores an old queued timeout after a newer session reuses the run id", () => {
    const timers = createManualTimers();
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      sessionTtlMs: 1,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    try {
      const old = manager.startRun({ runId: "reused", threadId: "old" });
      manager.completeRun("reused", old);
      const current = manager.startRun({ runId: "reused", threadId: "new" });
      timers.callbacks[0]?.();
      assertEquals(current.aborted, false);
      assertEquals(manager.getRunStatus("reused"), "running");
    } finally {
      manager.reset();
    }
  });
  it("does not let a retired signal cancel a newer session with the same run id", () => {
    const manager = new RunResumeSessionManager<{ ok: boolean }>();
    try {
      const old = manager.startRun({ runId: "reused", threadId: "old" });
      manager.completeRun("reused", old);
      const current = manager.startRun({ runId: "reused", threadId: "new" });
      assertEquals(manager.cancelRun("reused", old), false);
      assertEquals(current.aborted, false);
      assertEquals(manager.cancelRun("reused", current), true);
      assertEquals(current.aborted, true);
    } finally {
      manager.reset();
    }
  });
});

describe("bounded concurrent result waits", () => {
  it("routes out-of-order results by key and keeps the run waiting for remaining calls", async () => {
    const manager = new RunResumeSessionManager<number>({ maxPendingWaitsPerRun: 2 });
    manager.startRun({ runId: "parallel", threadId: "thread" });
    const first = manager.waitForSignal("parallel", "first");
    const second = manager.waitForSignal("parallel", "second");
    manager.submitSignal("parallel", { waitKey: "second", value: 2 });
    assertEquals(await second, 2);
    assertEquals(manager.getRunStatus("parallel"), "waiting");
    assertEquals(manager.submitSignal("parallel", { waitKey: "second", value: 2 }).duplicate, true);
    assertThrows(
      () => manager.submitSignal("parallel", { waitKey: "second", value: 3 }),
      WaitConflictError,
    );
    manager.submitSignal("parallel", { waitKey: "first", value: 1 });
    assertEquals(await first, 1);
    assertEquals(manager.getRunStatus("parallel"), "running");
    manager.completeRun("parallel");
  });
  it("retains the single-wait default and rejects excess waits without replacing active waiters", async () => {
    for (const maximum of [1, 2]) {
      const manager = new RunResumeSessionManager<number>(
        maximum === 1 ? {} : { maxPendingWaitsPerRun: maximum },
      );
      manager.startRun({ runId: "bounded", threadId: "thread" });
      const waits = Array.from(
        { length: maximum },
        (_, index) => manager.waitForSignal("bounded", String(index)),
      );
      await assertRejects(() => manager.waitForSignal("bounded", "excess"), WaitNotPendingError);
      for (let index = 0; index < maximum; index++) {
        manager.submitSignal("bounded", { waitKey: String(index), value: index });
      }
      assertEquals(await Promise.all(waits), Array.from({ length: maximum }, (_, index) => index));
      manager.completeRun("bounded");
    }
    for (const maximum of [0, 33, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new RunResumeSessionManager({ maxPendingWaitsPerRun: maximum }),
        TypeError,
      );
    }
  });
  it("shares duplicate waits without losing the first subscriber", async () => {
    const manager = new RunResumeSessionManager<number>();
    manager.startRun({ runId: "shared", threadId: "thread" });
    const first = manager.waitForSignal("shared", "key"),
      duplicate = manager.waitForSignal("shared", "key");
    manager.submitSignal("shared", { waitKey: "key", value: 7 });
    assertEquals(await Promise.all([first, duplicate]), [7, 7]);
    manager.completeRun("shared");
  });
  it("allows prepared early results while another key waits", async () => {
    const manager = new RunResumeSessionManager<number>({ maxPendingWaitsPerRun: 2 });
    manager.startRun({ runId: "early", threadId: "thread" });
    const first = manager.waitForSignal("early", "first");
    manager.prepareForSignal("early", "second");
    manager.submitSignal("early", { waitKey: "second", value: 2 });
    assertEquals(await manager.waitForSignal("early", "second"), 2);
    assertEquals(manager.getRunStatus("early"), "waiting");
    manager.submitSignal("early", { waitKey: "first", value: 1 });
    assertEquals(await first, 1);
    manager.completeRun("early");
  });
  for (const terminal of ["cancel", "complete", "fail"] as const) {
    it(`settles every pending waiter on ${terminal}`, async () => {
      const manager = new RunResumeSessionManager<number>({ maxPendingWaitsPerRun: 2 });
      const signal = manager.startRun({ runId: "terminal", threadId: "thread" });
      const results = Promise.allSettled([
        manager.waitForSignal("terminal", "a"),
        manager.waitForSignal("terminal", "b"),
      ]);
      if (terminal === "cancel") manager.cancelRun("terminal", signal);
      else if (terminal === "complete") manager.completeRun("terminal", signal);
      else manager.failRun("terminal", signal);
      assertEquals((await results).map((result) => result.status), ["rejected", "rejected"]);
    });
  }
  it("keeps independent wait deadlines and cancels all calls when the earliest expires", async () => {
    using time = new FakeTime(1000);
    const manager = new RunResumeSessionManager<number>({
      maxPendingWaitsPerRun: 2,
      waitingTtlMs: 10,
    });
    const signal = manager.startRun({ runId: "ttl", threadId: "thread" });
    const first = manager.waitForSignal("ttl", "first");
    time.tick(5);
    const second = manager.waitForSignal("ttl", "second");
    const results = Promise.allSettled([first, second]);
    time.tick(6);
    assertEquals(signal.aborted, true);
    assertEquals((await results).map((result) => result.status), ["rejected", "rejected"]);
    manager.settleCancelledRun("ttl", signal);
  });
  it("ignores a queued timeout for a resolved key while another call is pending", async () => {
    const timers = createManualTimers();
    const manager = new RunResumeSessionManager<number>({ maxPendingWaitsPerRun: 2, ...timers });
    const signal = manager.startRun({ runId: "stale", threadId: "thread" });
    const first = manager.waitForSignal("stale", "first"),
      second = manager.waitForSignal("stale", "second");
    manager.submitSignal("stale", { waitKey: "first", value: 1 });
    assertEquals(await first, 1);
    timers.callbacks[0]!();
    assertEquals(signal.aborted, false);
    manager.submitSignal("stale", { waitKey: "second", value: 2 });
    assertEquals(await second, 2);
    manager.completeRun("stale");
  });
});

it("rejects every waiter and preserves a timer failure during result delivery", async () => {
  const timers = createManualTimers();
  const diagnostic = new Error("Synthetic timer failure");
  let calls = 0;
  const failingTimer = new Proxy(timers.setTimeoutFn, {
    apply(target, receiver, args) {
      if (++calls === 6) throw diagnostic;
      return Reflect.apply(target, receiver, args);
    },
  });
  const manager = new RunResumeSessionManager<number>({
    maxPendingWaitsPerRun: 2,
    sessionTtlMs: 1000,
    setTimeoutFn: failingTimer,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const signal = manager.startRun({ runId: "timer-failure", threadId: "thread" });
  const results = Promise.allSettled([
    manager.waitForSignal("timer-failure", "first"),
    manager.waitForSignal("timer-failure", "second"),
  ]);
  assertThrows(
    () => manager.submitSignal("timer-failure", { waitKey: "first", value: 1 }),
    Error,
    "Synthetic timer failure",
  );
  const settled = await results;
  assertEquals(settled.map((result) => result.status), ["rejected", "rejected"]);
  if (settled[0]?.status === "rejected") assertEquals(settled[0].reason, diagnostic);
  assertEquals(signal.aborted, true);
  manager.settleCancelledRun("timer-failure", signal);
});

Deno.test("operation cancellation retires only its keyed waiter", async () => {
  const manager = new RunResumeSessionManager<string>({ maxPendingWaitsPerRun: 2 });
  const owner = manager.startRun({ runId: "operation-cancel", threadId: "thread" });
  const operation = new AbortController();
  const first = manager.waitForSignal("operation-cancel", "first", operation.signal);
  const rejected = assertRejects(() => first, DOMException, "cancelled operation");
  const second = manager.waitForSignal("operation-cancel", "second");
  operation.abort(new DOMException("cancelled operation", "AbortError"));
  await rejected;
  assertEquals(owner.aborted, false);
  assertThrows(
    () => manager.submitSignal("operation-cancel", { waitKey: "first", value: "late" }),
    WaitNotPendingError,
  );
  manager.submitSignal("operation-cancel", { waitKey: "second", value: "sibling" });
  assertEquals(await second, "sibling");
  manager.completeRun("operation-cancel");
  manager.reset();
});

Deno.test("duplicate keyed subscriptions cancel independently and retire the final abandoned key", async () => {
  for (const cancelledIndex of [0, 1]) {
    const manager = new RunResumeSessionManager<number>();
    const owner = manager.startRun({ runId: "subscriptions", threadId: "thread" });
    const controllers = [new AbortController(), new AbortController()];
    const waits = controllers.map((controller) =>
      manager.waitForSignal("subscriptions", "shared", controller.signal)
    );
    const cancelled = assertRejects(
      () => waits[cancelledIndex]!,
      DOMException,
      "subscriber stopped",
    );
    controllers[cancelledIndex]!.abort(new DOMException("subscriber stopped", "AbortError"));
    await cancelled;
    assertEquals(owner.aborted, false);
    assertEquals(manager.getRunStatus("subscriptions"), "waiting");
    manager.submitSignal("subscriptions", { waitKey: "shared", value: 42 });
    assertEquals(await waits[1 - cancelledIndex], 42);
    manager.completeRun("subscriptions");
  }
  const manager = new RunResumeSessionManager<number>();
  manager.startRun({ runId: "abandoned", threadId: "thread" });
  const controllers = [new AbortController(), new AbortController()];
  const waits = controllers.map((controller) =>
    manager.waitForSignal("abandoned", "shared", controller.signal)
  );
  const outcomes = Promise.allSettled(waits);
  controllers.forEach((controller) => controller.abort());
  assertEquals((await outcomes).map((outcome) => outcome.status), ["rejected", "rejected"]);
  assertThrows(
    () => manager.submitSignal("abandoned", { waitKey: "shared", value: 42 }),
    WaitNotPendingError,
  );
  assertEquals(manager.getRunStatus("abandoned"), "running");
  manager.completeRun("abandoned");
});
