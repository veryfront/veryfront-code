import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import {
  deriveRunEvents,
  deriveWorkflowRunEventObservation,
  isTerminalRunStatus,
  type RunEventSnapshot,
  snapshotRun,
} from "./events.ts";
import type { WorkflowRunObservation } from "./backends/types.ts";
import type { NodeState, WorkflowRun, WorkflowStatus } from "./types.ts";

function node(
  status: NodeState["status"],
  attempt = 1,
): { status: NodeState["status"]; attempt: number } {
  return { status, attempt };
}

function snapshot(
  status: WorkflowStatus,
  nodes: Record<string, { status: NodeState["status"]; attempt: number }> = {},
  approvals: Record<string, { nodeId: string; message?: string }> = {},
): RunEventSnapshot {
  return { status, nodes, approvals };
}

describe("workflow/events", () => {
  it("derives each observation from its own initial baseline", async () => {
    const initial = {
      id: "r1",
      status: "running",
      nodeStates: { a: { nodeId: "a", status: "completed", attempt: 1 } },
    } as unknown as WorkflowRun;
    const observation: WorkflowRunObservation = {
      initial,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield {
            revision: 1,
            status: "completed",
            nodes: { a: { status: "completed", attempt: 1 } },
          };
        },
      },
      close: () => Promise.resolve(),
    };

    const derived = deriveWorkflowRunEventObservation(observation);
    const events = [];
    for await (const event of derived.events) events.push(event);

    expect(events).toEqual([
      { type: "run.status", runId: "r1", status: "completed" },
    ]);
  });

  it("carries observed errors into events and closes the backend observation", async () => {
    const initial = {
      id: "r1",
      status: "running",
      nodeStates: { a: { nodeId: "a", status: "running", attempt: 1 } },
    } as unknown as WorkflowRun;
    let closeCalls = 0;
    const observation: WorkflowRunObservation = {
      initial,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield {
            revision: 1,
            status: "failed",
            runError: "boom",
            nodes: { a: { status: "failed", attempt: 1, error: "node boom" } },
          };
        },
      },
      close: () => {
        closeCalls++;
        return Promise.resolve();
      },
    };

    const derived = deriveWorkflowRunEventObservation(observation);
    const events = [];
    for await (const event of derived.events) events.push(event);

    expect(events).toEqual([
      { type: "step.failed", runId: "r1", nodeId: "a", attempt: 1, error: "node boom" },
      { type: "run.status", runId: "r1", status: "failed", error: "boom" },
    ]);

    // A derived observation that does not close its backing observation leaks
    // the underlying subscription for the lifetime of the process.
    await derived.close();
    expect(closeCalls).toBe(1);
  });

  it("derives reserved-name node failures and delegates close", async () => {
    const initialNodes = Object.create(null);
    Object.defineProperty(initialNodes, "__proto__", {
      enumerable: true,
      value: { nodeId: "__proto__", status: "running", attempt: 1 },
    });
    const changedNodes = Object.create(null);
    Object.defineProperty(changedNodes, "__proto__", {
      enumerable: true,
      value: { status: "failed", attempt: 1, error: "node failed" },
    });
    let closeCalls = 0;
    const observation: WorkflowRunObservation = {
      initial: {
        id: "reserved-run",
        status: "running",
        nodeStates: initialNodes,
      } as unknown as WorkflowRun,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield {
            revision: 1,
            status: "failed",
            runError: "run failed",
            nodes: changedNodes,
          };
        },
      },
      close: () => {
        closeCalls++;
        return Promise.resolve();
      },
    };

    const derived = deriveWorkflowRunEventObservation(observation);
    const events = [];
    for await (const event of derived.events) events.push(event);
    await derived.close();

    expect(events).toEqual([
      {
        type: "step.failed",
        runId: "reserved-run",
        nodeId: "__proto__",
        attempt: 1,
        error: "node failed",
      },
      {
        type: "run.status",
        runId: "reserved-run",
        status: "failed",
        error: "run failed",
      },
    ]);
    expect(closeCalls).toBe(1);
  });

  it("does not invoke accessors on observed node errors", async () => {
    let getterCalls = 0;
    const failedNode = Object.defineProperty(
      { status: "failed" as const, attempt: 1 },
      "error",
      {
        enumerable: true,
        get() {
          getterCalls++;
          return "must not run";
        },
      },
    );
    const observation: WorkflowRunObservation = {
      initial: {
        id: "accessor-run",
        status: "running",
        nodeStates: { a: { nodeId: "a", status: "running", attempt: 1 } },
      } as unknown as WorkflowRun,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield { revision: 1, status: "running", nodes: { a: failedNode } };
        },
      },
      close: () => Promise.resolve(),
    };

    const events = [];
    for await (const event of deriveWorkflowRunEventObservation(observation).events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "step.failed", runId: "accessor-run", nodeId: "a", attempt: 1 },
    ]);
    expect(getterCalls).toBe(0);
  });

  it("derives approval.pending once and carries the baseline across delta records", async () => {
    const initial = {
      id: "r1",
      status: "running",
      nodeStates: { review: { nodeId: "review", status: "running", attempt: 1 } },
      pendingApprovals: [],
    } as unknown as WorkflowRun;
    const observation: WorkflowRunObservation = {
      initial,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield {
            revision: 1,
            status: "waiting" as const,
            nodes: { review: { status: "running" as const, attempt: 1 } },
          };
          yield {
            revision: 2,
            status: "waiting" as const,
            nodes: { review: { status: "running" as const, attempt: 1 } },
            approvals: [{ id: "apr-1", nodeId: "review", message: "Please review" }],
          };
          // A record without the approvals field means "unchanged". The
          // baseline must survive it so the repeat below stays silent.
          yield {
            revision: 3,
            status: "running" as const,
            nodes: { review: { status: "running" as const, attempt: 1 } },
          };
          yield {
            revision: 4,
            status: "waiting" as const,
            nodes: { review: { status: "running" as const, attempt: 1 } },
            approvals: [{ id: "apr-1", nodeId: "review", message: "Please review" }],
          };
        },
      },
      close: () => Promise.resolve(),
    };

    const events = [];
    for await (const event of deriveWorkflowRunEventObservation(observation).events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.status", runId: "r1", status: "waiting" },
      {
        type: "approval.pending",
        runId: "r1",
        approvalId: "apr-1",
        nodeId: "review",
        message: "Please review",
      },
      { type: "run.status", runId: "r1", status: "running" },
      { type: "run.status", runId: "r1", status: "waiting" },
    ]);
  });

  it("does not re-report an approval already pending in the initial snapshot", async () => {
    const initial = {
      id: "r1",
      status: "waiting",
      nodeStates: { review: { nodeId: "review", status: "running", attempt: 1 } },
      pendingApprovals: [
        { id: "apr-1", nodeId: "review", message: "Please review", status: "pending" },
      ],
    } as unknown as WorkflowRun;
    const observation: WorkflowRunObservation = {
      initial,
      changes: {
        async *[Symbol.asyncIterator]() {
          yield {
            revision: 1,
            status: "waiting" as const,
            nodes: { review: { status: "running" as const, attempt: 1 } },
            approvals: [{ id: "apr-1", nodeId: "review", message: "Please review" }],
          };
        },
      },
      close: () => Promise.resolve(),
    };

    const events = [];
    for await (const event of deriveWorkflowRunEventObservation(observation).events) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  describe("deriveRunEvents", () => {
    it("reports a first observation as the run's current status", () => {
      const events = deriveRunEvents("r1", undefined, snapshot("running"));

      expect(events).toEqual([{ type: "run.status", runId: "r1", status: "running" }]);
    });

    it("says nothing when nothing changed", () => {
      // A backend write that does not move the run -- a heartbeat, say -- must
      // not produce an event, or a subscriber sees a stream of noise.
      const before = snapshot("running", { a: node("running") });

      expect(deriveRunEvents("r1", before, snapshot("running", { a: node("running") }))).toEqual(
        [],
      );
    });

    it("emits a step event per node that moved", () => {
      const before = snapshot("running", { a: node("running"), b: node("pending") });
      const after = snapshot("running", { a: node("completed"), b: node("running") });

      expect(deriveRunEvents("r1", before, after)).toEqual([
        { type: "step.completed", runId: "r1", nodeId: "a", attempt: 1 },
        { type: "step.started", runId: "r1", nodeId: "b", attempt: 1 },
      ]);
    });

    it("treats a retry as a transition even though the status repeats", () => {
      // failed -> running on a new attempt is the whole point of a retry.
      // Comparing status alone would swallow it and the caller would never
      // learn the step ran again.
      const before = snapshot("running", { a: node("running", 1) });
      const after = snapshot("running", { a: node("running", 2) });

      expect(deriveRunEvents("r1", before, after)).toEqual([
        { type: "step.started", runId: "r1", nodeId: "a", attempt: 2 },
      ]);
    });

    it("carries the persisted error on a failed step", () => {
      const before = snapshot("running", { a: node("running") });
      const after = snapshot("running", { a: node("failed") });

      expect(deriveRunEvents("r1", before, after, undefined, { a: "boom" })).toEqual([
        { type: "step.failed", runId: "r1", nodeId: "a", attempt: 1, error: "boom" },
      ]);
    });

    it("omits the error field when the step recorded none", () => {
      const after = snapshot("running", { a: node("failed") });

      expect(deriveRunEvents("r1", snapshot("running", { a: node("running") }), after)).toEqual([
        { type: "step.failed", runId: "r1", nodeId: "a", attempt: 1 },
      ]);
    });

    it("does not invoke node error accessors", () => {
      let getterCalls = 0;
      const nodeErrors = Object.defineProperty({}, "a", {
        enumerable: true,
        get() {
          getterCalls++;
          return "must not run";
        },
      });
      const after = snapshot("running", { a: node("failed") });

      expect(
        deriveRunEvents(
          "r1",
          snapshot("running", { a: node("running") }),
          after,
          undefined,
          nodeErrors,
        ),
      ).toEqual([
        { type: "step.failed", runId: "r1", nodeId: "a", attempt: 1 },
      ]);
      expect(getterCalls).toBe(0);
    });

    it("does not report a node's initial pending state as a transition", () => {
      const after = snapshot("running", { a: node("pending"), b: node("pending") });

      expect(deriveRunEvents("r1", snapshot("pending"), after)).toEqual([
        { type: "run.status", runId: "r1", status: "running" },
      ]);
    });

    it("orders step events before the run status they completed", () => {
      // A `completed` run whose last step still reads as running is a state no
      // consumer should have to render, so the step event has to land first.
      const before = snapshot("running", { a: node("running") });
      const after = snapshot("completed", { a: node("completed") });

      expect(deriveRunEvents("r1", before, after)).toEqual([
        { type: "step.completed", runId: "r1", nodeId: "a", attempt: 1 },
        { type: "run.status", runId: "r1", status: "completed" },
      ]);
    });

    it("carries the run error only on a failed run", () => {
      const failed = deriveRunEvents("r1", snapshot("running"), snapshot("failed"), "exploded");
      expect(failed).toEqual([
        { type: "run.status", runId: "r1", status: "failed", error: "exploded" },
      ]);

      const cancelled = deriveRunEvents(
        "r1",
        snapshot("running"),
        snapshot("cancelled"),
        "ignored",
      );
      expect(cancelled).toEqual([{ type: "run.status", runId: "r1", status: "cancelled" }]);
    });

    it("reports a skipped branch", () => {
      const after = snapshot("running", { a: node("skipped") });

      expect(deriveRunEvents("r1", snapshot("running", { a: node("pending") }), after)).toEqual([
        { type: "step.skipped", runId: "r1", nodeId: "a" },
      ]);
    });

    it("reports a new pending approval after the run status that parked on it", () => {
      // The engine persists `waiting` before the approval exists, so the live
      // stream always delivers the status first. A combined diff keeps that
      // order so consumers handle exactly one sequence.
      const before = snapshot("running", { review: node("running") });
      const after = snapshot("waiting", { review: node("running") }, {
        "apr-1": { nodeId: "review", message: "Please review" },
      });

      expect(deriveRunEvents("r1", before, after)).toEqual([
        { type: "run.status", runId: "r1", status: "waiting" },
        {
          type: "approval.pending",
          runId: "r1",
          approvalId: "apr-1",
          nodeId: "review",
          message: "Please review",
        },
      ]);
    });

    it("omits the approval message when none was persisted", () => {
      const before = snapshot("waiting");
      const after = snapshot("waiting", {}, { "apr-1": { nodeId: "review" } });

      expect(deriveRunEvents("r1", before, after)).toEqual([
        { type: "approval.pending", runId: "r1", approvalId: "apr-1", nodeId: "review" },
      ]);
    });

    it("does not repeat an approval already reported", () => {
      const before = snapshot("waiting", {}, { "apr-1": { nodeId: "review" } });
      const after = snapshot("waiting", {}, { "apr-1": { nodeId: "review" } });

      expect(deriveRunEvents("r1", before, after)).toEqual([]);
    });

    it("treats a snapshot without approvals as unchanged, not revoked", () => {
      const before = snapshot("waiting", {}, { "apr-1": { nodeId: "review" } });
      const after: RunEventSnapshot = { status: "waiting", nodes: {} };

      expect(deriveRunEvents("r1", before, after)).toEqual([]);
    });

    it("does not report approvals against a baseline that never observed them", () => {
      // An old-style snapshot has no approvals field at all. Emitting against
      // it could repeat an approval the caller already knew about.
      const before: RunEventSnapshot = { status: "waiting", nodes: {} };
      const after = snapshot("waiting", {}, { "apr-1": { nodeId: "review" } });

      expect(deriveRunEvents("r1", before, after)).toEqual([]);
    });

    it("reports current approvals on a first observation", () => {
      const events = deriveRunEvents(
        "r1",
        undefined,
        snapshot("waiting", {}, { "apr-1": { nodeId: "review" } }),
      );

      expect(events).toEqual([
        { type: "run.status", runId: "r1", status: "waiting" },
        { type: "approval.pending", runId: "r1", approvalId: "apr-1", nodeId: "review" },
      ]);
    });
  });

  describe("snapshotRun", () => {
    it("keeps only status and attempt, not step payloads", () => {
      // A snapshot is held per subscription for the life of a connection.
      // Retaining inputs and outputs would make an idle subscriber as
      // expensive as the data the workflow passes between its steps.
      const run = {
        status: "running",
        nodeStates: {
          a: {
            nodeId: "a",
            status: "completed",
            attempt: 2,
            input: { huge: "x".repeat(1000) },
            output: { alsoHuge: "y".repeat(1000) },
          },
        },
      } as unknown as Pick<WorkflowRun, "status" | "nodeStates">;

      const taken = snapshotRun(run);

      expect(taken).toEqual({
        status: "running",
        nodes: { a: { status: "completed", attempt: 2 } },
        approvals: {},
      });
      expect(JSON.stringify(taken)).not.toContain("xxx");
    });

    it("tolerates a run with no node states", () => {
      const run = { status: "pending" } as unknown as Pick<WorkflowRun, "status" | "nodeStates">;

      expect(snapshotRun(run)).toEqual({ status: "pending", nodes: {}, approvals: {} });
    });

    it("keeps only approval identifiers, not payloads or decided approvals", () => {
      const run = {
        status: "waiting",
        nodeStates: {},
        pendingApprovals: [
          {
            id: "apr-1",
            nodeId: "review",
            message: "Please review",
            payload: { secret: "approval-payload" },
            status: "pending",
          },
          { id: "apr-0", nodeId: "review", message: "Old", status: "approved" },
        ],
      } as unknown as Pick<WorkflowRun, "status" | "nodeStates" | "pendingApprovals">;

      const taken = snapshotRun(run);

      expect(taken).toEqual({
        status: "waiting",
        nodes: {},
        approvals: { "apr-1": { nodeId: "review", message: "Please review" } },
      });
      expect(JSON.stringify(taken)).not.toContain("approval-payload");
    });

    it("preserves a node whose id is a reserved object property", () => {
      const nodeStates = Object.create(null);
      Object.defineProperty(nodeStates, "__proto__", {
        enumerable: true,
        value: { nodeId: "__proto__", status: "completed", attempt: 2 },
      });

      const taken = snapshotRun({ status: "running", nodeStates } as never);

      expect(Object.prototype.hasOwnProperty.call(taken.nodes, "__proto__")).toBe(true);
      expect(taken.nodes["__proto__"]).toEqual({ status: "completed", attempt: 2 });
    });
  });

  describe("isTerminalRunStatus", () => {
    it("treats completed, failed and cancelled as terminal", () => {
      expect(isTerminalRunStatus("completed")).toBe(true);
      expect(isTerminalRunStatus("failed")).toBe(true);
      expect(isTerminalRunStatus("cancelled")).toBe(true);
      expect(isTerminalRunStatus("running")).toBe(false);
      expect(isTerminalRunStatus("waiting")).toBe(false);
      expect(isTerminalRunStatus("pending")).toBe(false);
    });
  });
});
