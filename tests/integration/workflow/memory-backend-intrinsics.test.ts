import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "#veryfront/workflow/backends/memory.ts";
import type { WorkflowRun } from "#veryfront/workflow/types.ts";

describe("MemoryBackend with hostile ambient intrinsics", () => {
  const unrestrictedSourceIntegrationPolicy = normalizeSourceIntegrationPolicy(undefined);

  function createTestRun(
    id: string,
    overrides: Partial<WorkflowRun> = {},
  ): WorkflowRun {
    return {
      id,
      workflowId: "test-workflow",
      status: "pending",
      input: { topic: "test" },
      nodeStates: {},
      currentNodes: [],
      context: { runId: id, workflowId: "test-workflow", input: { topic: "test" } },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      ...overrides,
    };
  }

  it("uses the admitted JSON parser after workflow code replaces JSON.parse", async () => {
    const backend = new MemoryBackend();
    const originalParse = JSON.parse;
    try {
      JSON.parse = (() => ({ input: {}, injected: true })) as typeof JSON.parse;
      await backend.createRun(createTestRun("run-json-parse-intrinsic", {
        context: { input: {}, value: 1 },
      }));
    } finally {
      JSON.parse = originalParse;
    }

    assertEquals((await backend.getRun("run-json-parse-intrinsic"))?.context, {
      input: {},
      value: 1,
    });
  });
});
