import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Checkpoint, WorkflowRun } from "../types.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  appendRetainedCheckpoint,
  deleteOldestCheckpointOccurrences,
} from "./checkpoint-retention.ts";
import { MemoryBackend } from "./memory.ts";

function checkpoint(id: string, nodeId = id, timestamp = new Date(0)): Checkpoint {
  return { id, nodeId, timestamp, context: { input: {} }, nodeStates: {} };
}

function run(id: string, workerId?: string): WorkflowRun {
  return {
    id,
    workflowId: "checkpoint-retention",
    status: workerId ? "running" : "pending",
    ...(workerId ? { workerId } : {}),
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

function identify(checkpoints: readonly Checkpoint[]): Array<{ id: string; nodeId: string }> {
  return checkpoints.map(({ id, nodeId }) => ({ id, nodeId }));
}

describe("workflow checkpoint retention", () => {
  it("appends a detached snapshot below the shared bound", () => {
    const history = [checkpoint("first")];
    const second = checkpoint("second");

    appendRetainedCheckpoint(history, second);

    assertEquals(history.map(({ id }) => id), ["first", "second"]);
    second.id = "mutated-source";
    assertEquals(history.at(-1)?.id, "second");
  });

  it("evicts the oldest entries once the bound is reached", () => {
    const history = Array.from(
      { length: MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES + 7 },
      (_, index) => checkpoint(`old-${index}`),
    );

    appendRetainedCheckpoint(history, checkpoint("newest"));

    assertEquals(history.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(history[0]?.id, "old-8");
    assertEquals(history.at(-1)?.id, "newest");
  });

  it("leaves existing history unchanged when checkpoint capture fails", () => {
    const history = [checkpoint("stable")];
    const invalid = checkpoint("invalid");
    invalid.context.uncloneable = () => undefined;

    assertThrows(() => appendRetainedCheckpoint(history, invalid));
    assertEquals(history.map(({ id }) => id), ["stable"]);
  });

  it("deletes duplicate IDs by oldest occurrence rather than Set membership", () => {
    const history = [
      checkpoint("same", "old"),
      checkpoint("keep", "middle"),
      checkpoint("same", "new"),
    ];

    assertEquals(identify(deleteOldestCheckpointOccurrences(history, ["same"])), [
      { id: "keep", nodeId: "middle" },
      { id: "same", nodeId: "new" },
    ]);
  });

  it("deletes one occurrence per requested ID", () => {
    const history = [
      checkpoint("same", "old"),
      checkpoint("same", "middle"),
      checkpoint("same", "new"),
    ];

    assertEquals(identify(deleteOldestCheckpointOccurrences(history, ["same", "same"])), [
      { id: "same", nodeId: "new" },
    ]);
  });

  it("bounds unconditional MemoryBackend appends at the shared limit", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("unconditional"));
    for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
      await backend.saveCheckpoint("unconditional", checkpoint(`cp-${index}`));
    }

    const retained = await backend.getCheckpoints("unconditional");
    assertEquals(retained.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(retained[0]?.id, "cp-1");
    assertEquals(retained.at(-1)?.id, `cp-${MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES}`);
    assertEquals((await backend.getLatestCheckpoint("unconditional"))?.id, retained.at(-1)?.id);
  });

  it("bounds owned MemoryBackend appends and leaves failed fences unchanged", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:retention-owner";
    await backend.createRun(run("owned", workerId));
    for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "owned",
          "owned",
          ["running"],
          workerId,
          checkpoint(`owned-${index}`),
        ),
        true,
      );
    }
    const beforeFailedFence = await backend.getCheckpoints("owned");

    assertEquals(
      await backend.saveCheckpointIfStatusAndWorker(
        "owned",
        "owned",
        ["running"],
        "run-execution:stale-owner",
        checkpoint("must-not-append"),
      ),
      false,
    );
    assertEquals(await backend.getCheckpoints("owned"), beforeFailedFence);
    assertEquals(beforeFailedFence.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(beforeFailedFence[0]?.id, "owned-1");
  });

  it("removes only the older twin when a duplicate ID is deleted once", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("duplicate-id"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("same", "old"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("keep", "middle"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("same", "new"));

    await backend.deleteCheckpoints("duplicate-id", ["same"]);

    assertEquals(identify(await backend.getCheckpoints("duplicate-id")), [
      { id: "keep", nodeId: "middle" },
      { id: "same", nodeId: "new" },
    ]);
  });
});
