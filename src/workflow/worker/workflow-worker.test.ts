import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRun } from "../types.ts";
import { WorkflowWorker } from "./workflow-worker.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createRun(sourceIntegrationPolicy = UNRESTRICTED_SOURCE_INTEGRATION_POLICY): WorkflowRun {
  return {
    id: "run-worker-policy",
    workflowId: "workflow-1",
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy,
  };
}

function resumeInBackground(worker: WorkflowWorker, run: WorkflowRun): void {
  (worker as unknown as { resumeInBackground(run: WorkflowRun): void })
    .resumeInBackground(run);
}

/** Drive one poll cycle without starting the timer loop. */
function pollOnce(worker: WorkflowWorker): Promise<void> {
  (worker as unknown as { status: string }).status = "running";
  return (worker as unknown as { poll(): Promise<void> }).poll();
}

/**
 * Reports a fixed set of stalled runs and lets `claimable` decide which of them
 * this worker wins, standing in for another pod claiming a run first. The
 * overrides are prototype methods that read `this`, like every real backend.
 */
class StalledRunsBackend extends MemoryBackend {
  readonly claimAttempts: string[] = [];

  constructor(
    private readonly stalledRuns: WorkflowRun[],
    private readonly claimable: (runId: string) => boolean,
  ) {
    super();
  }

  override findStalledRuns(_stalledThreshold: number): Promise<WorkflowRun[]> {
    return Promise.resolve(this.stalledRuns);
  }

  override claimStalledRun(runId: string): Promise<boolean> {
    this.claimAttempts.push(runId);
    return Promise.resolve(this.claimable(runId));
  }
}

/** Let the background resumes started by a poll cycle run to completion. */
function settleResumes(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("workflow/worker/workflow-worker", () => {
  for (const concurrency of [0, -1]) {
    it(`rejects concurrency ${concurrency}`, () => {
      assertThrows(
        () =>
          new WorkflowWorker({
            backend: new MemoryBackend(),
            concurrency,
            resumeFn: () => Promise.resolve(),
          }),
        Error,
        "concurrency",
      );
    });
  }

  it("rejects backends that cannot fence owner-bound persistence", () => {
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "saveCheckpointIfStatusAndWorker", {
      value: undefined,
    });

    assertThrows(
      () =>
        new WorkflowWorker({
          backend,
          resumeFn: () => Promise.resolve(),
        }),
      Error,
      "saveCheckpointIfStatusAndWorker",
    );
  });

  it("restores a stalled run source policy around the resume callback", async () => {
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["search_content"] } },
    });
    const resumed = Promise.withResolvers<void>();
    let observedPolicy: unknown;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: () => {
        observedPolicy = getActiveSourceIntegrationPolicy();
        resumed.resolve();
        return Promise.resolve();
      },
    });

    resumeInBackground(worker, createRun(sourceIntegrationPolicy));
    await resumed.promise;

    assertEquals(observedPolicy, sourceIntegrationPolicy);
  });

  it("passes the claiming worker ID to the resume callback", async () => {
    const resumed = Promise.withResolvers<void>();
    let observed: { runId: string; workerId?: string } | undefined;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      workerId: "worker-current-owner",
      resumeFn: (runId, workerId) => {
        observed = { runId, workerId };
        resumed.resolve();
        return Promise.resolve();
      },
    });

    resumeInBackground(worker, createRun());
    await resumed.promise;

    assertEquals(observed, {
      runId: "run-worker-policy",
      workerId: "worker-current-owner",
    });
  });

  it("resumes only the stalled runs it claims", async () => {
    const backend = new StalledRunsBackend(
      [{ ...createRun(), id: "run-a" }, { ...createRun(), id: "run-b" }],
      (runId) => runId === "run-b",
    );
    const resumed: string[] = [];
    const worker = new WorkflowWorker({
      backend,
      pollInterval: 60_000,
      resumeFn: (runId) => {
        resumed.push(runId);
        return Promise.resolve();
      },
    });

    await pollOnce(worker);
    await settleResumes();

    assertEquals(resumed, ["run-b"], "a run claimed by another worker must not be resumed here");
    assertEquals(worker.getStats().errorCount, 0, "a poll cycle must not record an error");
  });

  it("resumes no more stalled runs than the concurrency cap allows", async () => {
    const backend = new StalledRunsBackend(
      [
        { ...createRun(), id: "run-a" },
        { ...createRun(), id: "run-b" },
        { ...createRun(), id: "run-c" },
      ],
      () => true,
    );
    const resumed: string[] = [];
    const worker = new WorkflowWorker({
      backend,
      pollInterval: 60_000,
      concurrency: 1,
      resumeFn: (runId) => {
        resumed.push(runId);
        return Promise.resolve();
      },
    });

    await pollOnce(worker);
    await settleResumes();

    assertEquals(resumed.length, 1, "poll must not exceed the concurrency cap");
    assertEquals(
      backend.claimAttempts.length,
      1,
      "poll must not claim runs it has no slot for",
    );
    assertEquals(worker.getStats().errorCount, 0, "a poll cycle must not record an error");
  });

  it("does not invoke the resume callback when a stalled run has no snapshot", async () => {
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = createRun();

    resumeInBackground(worker, missingSnapshot as unknown as WorkflowRun);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(resumeCalls, 0);
    assertEquals(worker.getStats().errorCount, 1);
  });
});
