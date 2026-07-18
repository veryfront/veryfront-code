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

describe("workflow/worker/workflow-worker", () => {
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
