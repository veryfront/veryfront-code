import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WorkflowRun } from "#veryfront/workflow/types.ts";

import { projectWorkflowRunSummary } from "./run-summary.ts";

describe("projectWorkflowRunSummary", () => {
  it("allowlists operational fields without reading or mutating run payloads", () => {
    const privateMarker = "workflow-run-private-marker";
    const nodeStates: WorkflowRun["nodeStates"] = {};
    Object.defineProperty(nodeStates, "__proto__", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        nodeId: "__proto__",
        status: "completed",
        attempt: 1,
        input: { privateMarker },
        output: { privateMarker },
      },
    });
    const run = {
      id: "run-1",
      workflowId: "workflow-1",
      status: "completed",
      input: {
        toJSON: () => {
          throw new Error(privateMarker);
        },
      },
      output: 1n,
      context: { input: {}, privateMarker },
      checkpoints: [{ privateMarker }],
      currentNodes: [],
      nodeStates,
      pendingApprovals: [],
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      completedAt: new Date("2026-08-30T10:01:00.000Z"),
      sourceIntegrationPolicy: { privateMarker },
    } as unknown as WorkflowRun;

    const summary = projectWorkflowRunSummary(run);

    assertEquals(summary, {
      id: "run-1",
      workflowId: "workflow-1",
      status: "completed",
      currentNodes: [],
      nodeStates: {
        ["__proto__"]: {
          nodeId: "__proto__",
          status: "completed",
          attempt: 1,
        },
      },
      pendingApprovals: [],
      createdAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:01:00.000Z",
    });
    assertEquals(Object.hasOwn(summary.nodeStates, "__proto__"), true);
    assertEquals(run.nodeStates.__proto__?.output, { privateMarker });
  });
});
