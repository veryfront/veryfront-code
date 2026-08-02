import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type { Checkpoint, WorkflowNode, WorkflowRun } from "../types.ts";

function checkpoint(id: string, nodeId: string, timestamp: Date): Checkpoint {
  return { id, nodeId, timestamp, context: { input: {} }, nodeStates: {} };
}

function run(id: string): WorkflowRun {
  return {
    id,
    workflowId: "checkpoint-manager",
    status: "pending",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

function stepNode(id: string): WorkflowNode {
  return { id, config: { type: "step", tool: "noop" } };
}

async function seed(runId: string, count: number): Promise<MemoryBackend> {
  const backend = new MemoryBackend();
  await backend.createRun(run(runId));
  for (let index = 0; index < count; index++) {
    await backend.saveCheckpoint(
      runId,
      checkpoint(`cp-${index}`, `node-${index}`, new Date(index)),
    );
  }
  return backend;
}

describe("CheckpointManager", () => {
  it("reads history from a class-based backend", async () => {
    const backend = await seed("history", 3);

    const all = await new CheckpointManager({ backend }).getAll("history");

    assertEquals(all.map(({ id }) => id), ["cp-0", "cp-1", "cp-2"]);
  });

  it("cleanup retains the requested number of checkpoints", async () => {
    const backend = await seed("cleanup", 5);

    await new CheckpointManager({ backend }).cleanup("cleanup", 2);

    assertEquals(
      (await backend.getCheckpoints("cleanup")).map(({ id }) => id),
      ["cp-3", "cp-4"],
    );
  });

  it("prepareResume resolves an explicitly requested checkpoint", async () => {
    const backend = await seed("resume", 3);

    const resume = await new CheckpointManager({ backend }).prepareResume(
      "resume",
      [stepNode("node-0"), stepNode("node-1"), stepNode("node-2")],
      "cp-0",
    );

    assertExists(resume);
    assertEquals(resume.checkpoint.id, "cp-0");
    assertEquals(resume.startFromNode, "node-1");
  });

  it("falls back to the latest checkpoint when the backend omits getCheckpoints", async () => {
    const inner = await seed("fallback", 2);
    const backend = {
      getLatestCheckpoint: (runId: string) => inner.getLatestCheckpoint(runId),
    } as unknown as WorkflowBackend;

    const all = await new CheckpointManager({ backend }).getAll("fallback");

    assertEquals(all.map(({ id }) => id), ["cp-1"]);
  });
});
