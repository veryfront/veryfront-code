import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  RunCancelledError,
  RunResumeSessionManager,
  WaitConflictError,
  WaitNotPendingError,
} from "./resume-session.ts";

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

  it("expires waiting runs after the configured TTL", async () => {
    const timerCallbacks: Array<() => void> = [];
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      waitingTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });
    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = manager.waitForSignal("run_1", "tool_1");
    assertEquals(manager.getRunStatus("run_1"), "waiting");

    timerCallbacks[0]?.();

    await assertRejects(
      async () => {
        await pending;
      },
      RunCancelledError,
    );
    assertEquals(manager.getRunStatus("run_1"), null);
  });

  it("evicts stale running sessions after the configured session TTL", () => {
    const timerCallbacks: Array<() => void> = [];
    const manager = new RunResumeSessionManager<{ ok: boolean }>({
      sessionTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });

    manager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(manager.getRunStatus("run_1"), "running");

    timerCallbacks[0]?.();

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
});
