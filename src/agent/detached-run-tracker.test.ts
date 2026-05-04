import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";

function deferred(): { promise: Promise<void>; resolve: () => Promise<void> } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    async resolve() {
      resolvePromise();
      await promise;
    },
  };
}

describe("agent/detached-run-tracker", () => {
  it("tracks, cancels, and drains active run executions", async () => {
    const tracker = createDetachedRunTracker<{ result: unknown; isError: boolean }>({
      pollIntervalMs: 1,
    });
    const execution = deferred();

    tracker.sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    void tracker.sessionManager.waitForSignal("run_1", "tool_1").catch(() => undefined);
    tracker.registerExecution("run_1", execution.promise);

    assertEquals(tracker.cancelAllRuns(), ["run_1"]);
    const draining = tracker.waitForDrain({ timeoutMs: 50, pollIntervalMs: 1 });
    const beforeResolve = await tracker.waitForDrain({ timeoutMs: 1, pollIntervalMs: 1 });
    assertEquals(beforeResolve, { drained: false, pendingRunIds: ["run_1"] });

    await execution.resolve();
    assertEquals(await draining, { drained: true, pendingRunIds: [] });
  });

  it("keeps newer executions registered when an older execution settles", async () => {
    const tracker = createDetachedRunTracker();
    const oldExecution = deferred();
    const newExecution = deferred();

    tracker.registerExecution("run_1", oldExecution.promise);
    tracker.registerExecution("run_1", newExecution.promise);
    await oldExecution.resolve();

    const pending = await tracker.waitForDrain({ timeoutMs: 1, pollIntervalMs: 1 });
    assertEquals(pending, { drained: false, pendingRunIds: ["run_1"] });

    await newExecution.resolve();
    assertEquals(await tracker.waitForDrain({ timeoutMs: 50, pollIntervalMs: 1 }), {
      drained: true,
      pendingRunIds: [],
    });
  });

  it("resets run status and active tracking", async () => {
    const tracker = createDetachedRunTracker();
    tracker.sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    tracker.trackRun("run_1");

    tracker.reset();

    assertEquals(tracker.sessionManager.getRunStatus("run_1"), null);
    assertEquals(await tracker.waitForDrain({ timeoutMs: 1, pollIntervalMs: 1 }), {
      drained: true,
      pendingRunIds: [],
    });
  });
});
