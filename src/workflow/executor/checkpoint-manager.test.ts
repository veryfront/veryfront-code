import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type {
  Checkpoint,
  NodeState,
  WorkflowContext,
  WorkflowNode,
  WorkflowRun,
} from "../types.ts";

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

function nodeState(nodeId: string, status: NodeState["status"]): NodeState {
  return {
    nodeId,
    status,
    attempt: 1,
    startedAt: new Date(0),
    ...(status === "completed" ? { completedAt: new Date(1) } : {}),
  };
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

  it("cleanup retains the newest appended duplicate IDs regardless of timestamp order", async () => {
    const runId = "cleanup-duplicate";
    const backend = new MemoryBackend();
    await backend.createRun(run(runId));
    await backend.saveCheckpoint(
      runId,
      checkpoint("first", "first-appended", new Date(3_000)),
    );
    await backend.saveCheckpoint(
      runId,
      checkpoint("same", "middle-appended", new Date(2_000)),
    );
    await backend.saveCheckpoint(
      runId,
      checkpoint("same", "last-appended", new Date(1_000)),
    );

    await new CheckpointManager({ backend }).cleanup(runId, 2);

    assertEquals(
      (await backend.getCheckpoints(runId)).map(({ id, nodeId }) => ({
        id,
        nodeId,
      })),
      [
        { id: "same", nodeId: "middle-appended" },
        { id: "same", nodeId: "last-appended" },
      ],
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

  it("refuses a checkpoint from a worker that no longer owns the run", async () => {
    const runId = "ownership-stale";
    const backend = new MemoryBackend();
    await backend.createRun({ ...run(runId), status: "running", workerId: "worker-new" });

    assertEquals(
      await new CheckpointManager({ backend }).save(
        runId,
        checkpoint("cp-stale", "node-0", new Date(0)),
        { runId, workerId: "worker-old" },
      ),
      false,
      "a stale worker must not write checkpoints",
    );
    assertEquals(
      (await backend.getCheckpoints(runId)).length,
      0,
      "nothing is persisted for a stale worker",
    );
  });

  it("accepts a checkpoint from the worker that still owns the run", async () => {
    const runId = "ownership-current";
    const backend = new MemoryBackend();
    await backend.createRun({ ...run(runId), status: "running", workerId: "worker-current" });

    assertEquals(
      await new CheckpointManager({ backend }).save(
        runId,
        checkpoint("cp-owned", "node-0", new Date(0)),
        { runId, workerId: "worker-current" },
      ),
      true,
      "the owning worker must be allowed to write checkpoints",
    );
    assertEquals(
      (await backend.getCheckpoints(runId)).map(({ id }) => id),
      ["cp-owned"],
      "the owning worker's checkpoint is persisted",
    );
  });

  it("refuses ownership-fenced saves on a backend that cannot fence them", async () => {
    const runId = "ownership-unfenceable";
    const inner = new MemoryBackend();
    let unfencedSaves = 0;
    const backend = {
      saveCheckpoint: (id: string, value: Checkpoint) => {
        unfencedSaves++;
        return inner.saveCheckpoint(id, value);
      },
      getLatestCheckpoint: (id: string) => inner.getLatestCheckpoint(id),
    } as unknown as WorkflowBackend;

    assertEquals(
      await new CheckpointManager({ backend }).save(
        runId,
        checkpoint("cp-unfenceable", "node-0", new Date(0)),
        { runId, workerId: "worker-current" },
      ),
      false,
      "an unfenceable backend must refuse an ownership-bound checkpoint",
    );
    assertEquals(unfencedSaves, 0, "the checkpoint must not fall back to an unfenced write");
  });

  it("falls back to the latest checkpoint when the backend omits getCheckpoints", async () => {
    const inner = await seed("fallback", 2);
    const backend = {
      getLatestCheckpoint: (runId: string) => inner.getLatestCheckpoint(runId),
    } as unknown as WorkflowBackend;

    const all = await new CheckpointManager({ backend }).getAll("fallback");

    assertEquals(all.map(({ id }) => id), ["cp-1"]);
  });

  it("resumes at a dependency-ready node instead of an earlier blocked declaration", async () => {
    const runId = "dependency-resume";
    const backend = new MemoryBackend();
    await backend.createRun(run(runId));
    await backend.saveCheckpoint(runId, {
      id: "after-first",
      nodeId: "first",
      timestamp: new Date(0),
      context: { input: {} },
      nodeStates: {
        first: nodeState("first", "completed"),
        blocked: nodeState("blocked", "pending"),
        prerequisite: nodeState("prerequisite", "pending"),
      },
    });
    const nodes: WorkflowNode[] = [
      { ...stepNode("first"), dependsOn: [] },
      { ...stepNode("blocked"), dependsOn: ["prerequisite"] },
      { ...stepNode("prerequisite"), dependsOn: ["first"] },
    ];

    const resume = await new CheckpointManager({ backend }).prepareResume(runId, nodes);

    assertExists(resume);
    assertEquals(resume.startFromNode, "prerequisite");
  });

  it("rejects invalid cleanup counts without deleting checkpoint history", async () => {
    const backend = await seed("invalid-cleanup", 2);
    const manager = new CheckpointManager({ backend });

    for (const keepCount of [-1, 1.5, Number.NaN]) {
      await assertRejects(
        () => manager.cleanup("invalid-cleanup", keepCount),
        VeryfrontError,
        "keepCount must be a non-negative safe integer",
      );
    }

    assertEquals(
      (await backend.getCheckpoints("invalid-cleanup")).map(({ id }) => id),
      ["cp-0", "cp-1"],
    );
  });

  it("creates detached checkpoints and persists the same snapshot", async () => {
    const backend = await seed("create-checkpoint", 0);
    const manager = new CheckpointManager({ backend });
    const context: WorkflowContext = { input: { topic: "original" } };
    const nodeStates = { first: nodeState("first", "completed") };

    const created = await manager.createCheckpoint(
      "create-checkpoint",
      "first",
      context,
      nodeStates,
    );
    (context.input as { topic: string }).topic = "changed";
    nodeStates.first.status = "failed";

    assertEquals(created.context.input, { topic: "original" });
    assertEquals(created.nodeStates.first?.status, "completed");
    const persisted = await manager.getLatest("create-checkpoint");
    assertExists(persisted);
    assertEquals(persisted.context.input, { topic: "original" });
    assertEquals(persisted.nodeStates.first?.status, "completed");
  });

  it("forwards owned saves through the fenced backend method with its receiver", async () => {
    let receiver: unknown;
    let received: unknown[] | undefined;
    let unfencedCalls = 0;
    const backend = {
      saveCheckpoint() {
        unfencedCalls++;
        return Promise.resolve();
      },
      saveCheckpointIfStatusAndWorker(
        storageRunId: string,
        ownershipRunId: string,
        expectedStatuses: string[],
        expectedWorkerId: string,
        savedCheckpoint: Checkpoint,
      ) {
        receiver = this;
        received = [
          storageRunId,
          ownershipRunId,
          expectedStatuses,
          expectedWorkerId,
          savedCheckpoint.id,
        ];
        return Promise.resolve(true);
      },
    } as unknown as WorkflowBackend;
    const manager = new CheckpointManager({ backend });
    const saved = checkpoint("owned", "first", new Date(0));

    const result = await manager.save("storage-run", saved, {
      runId: "canonical-run",
      workerId: "worker-1",
    });

    assertEquals(result, true);
    assertEquals(receiver, backend);
    assertEquals(received, [
      "storage-run",
      "canonical-run",
      ["running"],
      "worker-1",
      "owned",
    ]);
    assertEquals(unfencedCalls, 0);
  });

  it("uses explicit checkpoint policy and ignores inherited agent fields", () => {
    const backend = {} as WorkflowBackend;
    const manager = new CheckpointManager({ backend });
    let accessorCalls = 0;
    const inheritedAgentConfig = Object.assign(
      Object.create({ agent: "inherited-agent" }),
      { type: "step", tool: "noop" },
    );
    const accessorConfig = Object.defineProperty(
      { type: "step", tool: "noop" },
      "checkpoint",
      {
        get() {
          accessorCalls++;
          return true;
        },
      },
    );

    assertEquals(
      manager.shouldCheckpoint({
        id: "inherited-agent",
        config: inheritedAgentConfig,
      } as WorkflowNode),
      false,
    );
    assertEquals(
      manager.shouldCheckpoint({
        id: "explicit",
        config: { type: "step", tool: "noop", checkpoint: true },
      }),
      true,
    );
    assertEquals(
      manager.shouldCheckpoint({
        id: "accessor",
        config: accessorConfig,
      } as WorkflowNode),
      false,
    );
    assertEquals(accessorCalls, 0);
    assertEquals(
      manager.shouldCheckpoint({
        id: "wait",
        config: { type: "wait", waitType: "approval" },
      }),
      true,
    );
    assertEquals(
      manager.shouldCheckpoint({
        id: "branch",
        config: { type: "branch", condition: () => true, then: [] },
      }),
      false,
    );
  });
});
