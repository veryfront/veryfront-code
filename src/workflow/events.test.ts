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
): RunEventSnapshot {
  return { status, nodes };
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
      });
      expect(JSON.stringify(taken)).not.toContain("xxx");
    });

    it("tolerates a run with no node states", () => {
      const run = { status: "pending" } as unknown as Pick<WorkflowRun, "status" | "nodeStates">;

      expect(snapshotRun(run)).toEqual({ status: "pending", nodes: {} });
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
