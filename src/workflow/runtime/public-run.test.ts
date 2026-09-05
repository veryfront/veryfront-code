import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type {
  CheckpointResumeEnvelope,
  NodeState,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import {
  FRAMEWORK_CONTEXT_PROJECTION_KIND,
  INTERNAL_RUNTIME_PROJECTION_KIND,
  INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD,
  SUBWORKFLOW_INPUT_KIND,
  WORKFLOW_RUNTIME_STATE_VERSION,
} from "../runtime-state.ts";
import { toPublicWorkflowRun } from "./public-run.ts";

const SOURCE_POLICY = normalizeSourceIntegrationPolicy(undefined);

function completedState(nodeId: string, output: unknown): NodeState {
  return {
    nodeId,
    status: "completed",
    output,
    attempt: 1,
    completedAt: new Date(1),
  };
}

describe("workflow/runtime/public-run", () => {
  it("detaches framework state while preserving versioned context-shaped user output", () => {
    const frameworkEnv = { PROJECT_SECRET: "current-secret" };
    const frameworkTenant = {
      projectSlug: "private-project",
      token: "tenant-secret",
      productionMode: false,
    };
    const nestedUserOutput = {
      env: { visible: "user-owned" },
      _tenant: { visible: "user-owned" },
    };
    const contextShapedUserOutput = {
      input: { userOwned: true },
      env: structuredClone(frameworkEnv),
      _tenant: structuredClone(frameworkTenant),
      payload: "keep",
    };
    const leakedContext = {
      input: { request: true },
      env: structuredClone(frameworkEnv),
      _tenant: structuredClone(frameworkTenant),
      child: nestedUserOutput,
    };
    const nodeStates: Record<string, NodeState> = {
      step: {
        ...completedState("step", nestedUserOutput),
        _subWorkflowOwnerPath: "internal-owner",
        _activeCompositeChildIds: ["waiting-child"],
        _completedCompositeChildIds: ["finished-child"],
      },
      parent: completedState("parent", contextShapedUserOutput),
      "parent/child": completedState("parent/child", "unrelated ordinary step"),
      mapLike: completedState("mapLike", [contextShapedUserOutput]),
      mapLike_0: completedState("mapLike_0", nestedUserOutput),
      parallel: completedState("parallel", {
        child: nestedUserOutput,
        "parallel/child": nestedUserOutput,
      }),
      "parallel/child": completedState("parallel/child", nestedUserOutput),
      branch: completedState("branch", {
        branch: "then",
        result: { child: nestedUserOutput, "branch/then/child": nestedUserOutput },
      }),
      "branch/then/child": completedState("branch/then/child", nestedUserOutput),
      loop: completedState("loop", {
        exitReason: "condition",
        iterations: 1,
        previousResults: [
          { child: nestedUserOutput, "loop/child": nestedUserOutput },
        ],
      }),
      "loop/child": completedState("loop/child", nestedUserOutput),
      subworkflow: {
        ...completedState("subworkflow", {
          ...leakedContext,
          child: nestedUserOutput,
        }),
        _workflowOutputKind: "subWorkflowContext",
        [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: [{
          kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
          path: [],
        }],
      } as NodeState,
      mapped: completedState("mapped", [contextShapedUserOutput, nestedUserOutput]),
      mapped_0: completedState("mapped_0", contextShapedUserOutput),
      mapped_1: completedState("mapped_1", nestedUserOutput),
    };
    const run: WorkflowRun = {
      id: "versioned-run",
      workflowId: "versioned-workflow",
      status: "completed",
      input: { request: true },
      output: {
        input: "schema-owned-input",
        env: { schemaOwned: true },
        _tenant: { schemaOwned: true },
        step: nestedUserOutput,
        parent: contextShapedUserOutput,
        mapLike: [contextShapedUserOutput],
        parallel: nodeStates.parallel!.output,
        branch: nodeStates.branch!.output,
        loop: nodeStates.loop!.output,
        subworkflow: { child: nestedUserOutput },
        mapped: nodeStates.mapped!.output,
      },
      nodeStates,
      currentNodes: [],
      context: {
        input: { request: true },
        env: frameworkEnv,
        _tenant: frameworkTenant,
        parent: contextShapedUserOutput,
        mapLike: [contextShapedUserOutput],
        parallel: nodeStates.parallel!.output,
        branch: nodeStates.branch!.output,
        loop: nodeStates.loop!.output,
        subworkflow: nodeStates.subworkflow!.output,
        mapped: nodeStates.mapped!.output,
        loop_loop_state: {
          iteration: 1,
          previousResults: [{ child: nestedUserOutput, "loop/child": nestedUserOutput }],
          iterationNodeStates: { "loop/child": nodeStates["loop/child"] },
        },
      },
      _workflowProjection: {
        context: {
          subworkflow: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
          loop_loop_state: [{ kind: INTERNAL_RUNTIME_PROJECTION_KIND, path: [] }],
        },
      },
      checkpoints: [{
        id: "historical-checkpoint",
        nodeId: "step",
        timestamp: new Date(2),
        context: {
          input: { request: true },
          env: frameworkEnv,
          _tenant: frameworkTenant,
          parallel: nodeStates.parallel!.output,
          subworkflow: nodeStates.subworkflow!.output,
          parent: contextShapedUserOutput,
          mapLike: [contextShapedUserOutput],
        },
        _workflowProjection: {
          context: {
            subworkflow: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
          },
        },
        nodeStates,
      }],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(3),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _tenant: frameworkTenant,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _traceContext: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    };

    const projected = toPublicWorkflowRun(run);
    const output = projected.output as Record<string, unknown>;

    assertEquals(projected._tenant, undefined);
    assertEquals(projected._runtimeStateVersion, undefined);
    // Trace identity is telemetry infrastructure, not run data.
    assertEquals(projected._traceContext, undefined);
    assertEquals(projected.context.env, undefined);
    assertEquals(projected.context._tenant, undefined);
    assertEquals(projected.context.parallel, {
      child: nestedUserOutput,
      "parallel/child": nestedUserOutput,
    });
    assertEquals(output.input, "schema-owned-input");
    assertEquals(output.env, { schemaOwned: true });
    assertEquals(output._tenant, { schemaOwned: true });
    assertEquals(output.step, nestedUserOutput);
    assertEquals(output.parent, contextShapedUserOutput);
    assertEquals(output.mapLike, [contextShapedUserOutput]);
    assertEquals(projected.nodeStates.step?.output, nestedUserOutput);
    assertEquals(projected.nodeStates.parent?.output, contextShapedUserOutput);
    assertEquals(projected.nodeStates.mapLike?.output, [contextShapedUserOutput]);
    assertEquals(projected.nodeStates.parallel?.output, {
      child: nestedUserOutput,
      "parallel/child": nestedUserOutput,
    });
    assertEquals(projected.nodeStates.branch?.output, {
      branch: "then",
      result: { child: nestedUserOutput, "branch/then/child": nestedUserOutput },
    });
    assertEquals(projected.nodeStates.loop?.output, {
      exitReason: "condition",
      iterations: 1,
      previousResults: [{ child: nestedUserOutput, "loop/child": nestedUserOutput }],
    });
    assertEquals(projected.nodeStates.subworkflow?.output, {
      child: nestedUserOutput,
    });
    assertEquals(
      (projected.nodeStates.subworkflow as Record<string, unknown>)._workflowOutputKind,
      undefined,
    );
    assertEquals(projected.nodeStates.mapped?.output, [
      contextShapedUserOutput,
      nestedUserOutput,
    ]);
    assertEquals(projected.checkpoints[0]?.context.env, undefined);
    for (const states of [projected.nodeStates, projected.checkpoints[0]!.nodeStates]) {
      assertEquals(states.step?._subWorkflowOwnerPath, undefined);
      assertEquals(states.step?._activeCompositeChildIds, undefined);
      assertEquals(states.step?._completedCompositeChildIds, undefined);
    }
    assertEquals(projected.checkpoints[0]?.context._tenant, undefined);
    assertEquals(projected.checkpoints[0]?.context.parallel, {
      child: nestedUserOutput,
      "parallel/child": nestedUserOutput,
    });
    assertEquals(projected.checkpoints[0]?.context.parent, contextShapedUserOutput);
    assertEquals(projected.checkpoints[0]?.context.mapLike, [contextShapedUserOutput]);
    assertEquals(projected.checkpoints[0]?.nodeStates.parent?.output, contextShapedUserOutput);
    assertEquals(projected.checkpoints[0]?.nodeStates.mapLike?.output, [contextShapedUserOutput]);
    assertEquals(projected.checkpoints[0]?.nodeStates.parallel?.output, {
      child: nestedUserOutput,
      "parallel/child": nestedUserOutput,
    });
    assertEquals(projected.context.loop_loop_state, undefined);

    const projectedOutput = projected.output as Record<string, unknown>;
    projectedOutput.step = "mutated";
    projected.nodeStates.step!.output = "mutated";
    projected.checkpoints[0]!.nodeStates.step!.output = "mutated";

    const rawOutput = run.output as Record<string, unknown>;
    assertEquals(rawOutput.step, nestedUserOutput);
    assertEquals(run.nodeStates.step?.output, nestedUserOutput);
    assertExists(run.checkpoints[0]);
    assertEquals(run.checkpoints[0].nodeStates.step?.output, nestedUserOutput);
  });

  it("rejects an unversioned legacy public read as migration-required", () => {
    const leakedContext = {
      input: { PROJECT_SECRET: "input-secret" },
      env: { PROJECT_SECRET: "rotated-old-secret" },
      payload: "keep",
    };
    const run: WorkflowRun = {
      id: "legacy-rotated-run",
      workflowId: "legacy-workflow",
      status: "completed",
      input: {},
      output: { nested: leakedContext },
      nodeStates: {
        nested: completedState("nested", leakedContext),
      },
      currentNodes: [],
      context: {
        input: {},
        env: { PROJECT_SECRET: "rotated-new-secret" },
        nested: leakedContext,
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(1),
      sourceIntegrationPolicy: SOURCE_POLICY,
    };

    assertThrows(
      () => toPublicWorkflowRun(run),
      Error,
      "ambiguous public-data provenance; migration is required",
    );
  });

  it("projects cyclic provenance values without recursion failure", () => {
    const childState: Record<string, unknown> = { value: "keep" };
    childState.self = childState;
    const makeContext = () => ({
      input: { secret: true },
      child: structuredClone(childState),
    });
    const run: WorkflowRun = {
      id: "cyclic-provenance",
      workflowId: "cyclic-workflow",
      status: "completed",
      input: {},
      output: { nested: { child: structuredClone(childState) } },
      nodeStates: {
        nested: {
          ...completedState("nested", makeContext()),
          _workflowOutputKind: "subWorkflowContext",
          [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: [{
            kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
            path: [],
          }],
        } as NodeState,
      },
      currentNodes: [],
      context: {
        input: {},
        nested: makeContext(),
      },
      _workflowProjection: {
        context: {
          nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
        },
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(1),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    };

    const projected = toPublicWorkflowRun(run);
    const nested = projected.context.nested as Record<string, unknown>;
    const child = nested.child as Record<string, unknown>;
    assertEquals(nested.input, undefined);
    assertStrictEquals(child.self, child);
    child.value = "mutated";
    assertEquals(
      ((run.context.nested as WorkflowContext).child as Record<string, unknown>).value,
      "keep",
    );
  });

  it("uses current input provenance to scrub descendant checkpoints", () => {
    const childInput = { PROJECT_SECRET: "checkpoint-secret" };
    const currentChild = {
      ...completedState("nested/child", "done"),
      input: childInput,
      _workflowInputKind: "subWorkflowInput",
    } as NodeState;
    const checkpointChild = {
      ...completedState("nested/child", "done"),
      input: structuredClone(childInput),
    };
    const run: WorkflowRun = {
      id: "checkpoint-input-provenance",
      workflowId: "checkpoint-input-provenance",
      status: "completed",
      input: {},
      output: {},
      nodeStates: { "nested/child": currentChild },
      currentNodes: [],
      context: { input: {} },
      checkpoints: [{
        id: "child-checkpoint",
        nodeId: "nested/child",
        timestamp: new Date(1),
        context: { input: structuredClone(childInput), child: "done" },
        nodeStates: { "nested/child": checkpointChild },
      }],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(2),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    };

    const projected = toPublicWorkflowRun(run);
    assertEquals(projected.nodeStates["nested/child"]?.input, undefined);
    assertEquals(projected.checkpoints[0]?.nodeStates["nested/child"]?.input, undefined);
    assertEquals(projected.checkpoints[0]?.context.input, undefined);
  });

  it("uses checkpoint execution provenance in the descendant crash window", () => {
    const childInput = { PROJECT_SECRET: "checkpoint-only-secret" };
    const run: WorkflowRun = {
      id: "checkpoint-sidecar-input-provenance",
      workflowId: "checkpoint-sidecar-input-provenance",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [{
        id: "child-checkpoint-before-run-patch",
        nodeId: "nested/child",
        timestamp: new Date(1),
        context: { input: structuredClone(childInput), child: "done" },
        nodeStates: {},
        _workflowProjection: {
          context: {},
          inputKind: SUBWORKFLOW_INPUT_KIND,
        },
        _resumeEnvelope: {
          schemaVersion: 2,
          ownerNodeId: "nested",
          context: {
            input: {},
            env: { PROJECT_SECRET: "envelope-secret" },
            _tenant: {
              projectSlug: "acme",
              token: "tenant-token",
              projectId: "p-1",
              productionMode: true,
            },
          },
          nodeStates: {},
          workflowProjection: { context: {} },
        } as unknown as CheckpointResumeEnvelope,
      }],
      pendingApprovals: [],
      createdAt: new Date(0),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };

    const projected = toPublicWorkflowRun(run);
    assertEquals(projected.checkpoints[0]?.context.input, undefined);
    assertEquals(projected.checkpoints[0]?._workflowProjection, undefined);
    assertEquals(
      projected.checkpoints[0]?._resumeEnvelope,
      undefined,
      "the framework resume envelope must never reach a public run",
    );
  });

  it("projects owned slots after downstream mutation without touching equal unowned values", () => {
    const raw = {
      input: { PROJECT_SECRET: "owned-secret" },
      child: "ok",
      downstream: true,
    };
    const duplicateUserValue = structuredClone(raw);
    const state = {
      ...completedState("nested", raw),
      [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: [{
        kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
        path: [],
      }],
    } as NodeState;
    const run: WorkflowRun = {
      id: "mutated-owned-slot",
      workflowId: "mutated-owned-slot",
      status: "completed",
      input: {},
      output: [{ child: "ok", downstream: true }],
      nodeStates: { nested: state },
      currentNodes: [],
      context: {
        input: {},
        nested: structuredClone(raw),
        duplicateUserValue,
      },
      _workflowProjection: {
        context: {
          nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
        },
      },
      checkpoints: [{
        id: "mutated-checkpoint",
        nodeId: "after",
        timestamp: new Date(1),
        context: {
          input: {},
          nested: structuredClone(raw),
          duplicateUserValue: structuredClone(duplicateUserValue),
        },
        _workflowProjection: {
          context: {
            nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
          },
        },
        nodeStates: { nested: structuredClone(state) },
      }],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(2),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    };

    const projected = toPublicWorkflowRun(run);
    assertEquals(projected.nodeStates.nested?.output, { child: "ok", downstream: true });
    assertEquals(projected.context.nested, { child: "ok", downstream: true });
    assertEquals(projected.context.duplicateUserValue, duplicateUserValue);
    assertEquals(projected.output, [{ child: "ok", downstream: true }]);
    assertEquals(projected.checkpoints[0]?.context.nested, {
      child: "ok",
      downstream: true,
    });
    assertEquals(projected.checkpoints[0]?.context.duplicateUserValue, duplicateUserValue);
  });

  it("preserves a full user replacement and user-owned loop-shaped output", () => {
    const userReplacement = {
      input: { visible: true },
      env: { visible: "user" },
      report_loop_state: {
        iteration: 1,
        previousResults: [],
        iterationNodeStates: { user: true },
      },
    };
    const run: WorkflowRun = {
      id: "user-replacement",
      workflowId: "user-replacement",
      status: "completed",
      input: {},
      output: structuredClone(userReplacement),
      nodeStates: {
        nested: {
          ...completedState("nested", {
            input: { secret: true },
            child: "raw",
          }),
          [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: [{
            kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
            path: [],
          }],
        } as NodeState,
        report: completedState("report", structuredClone(userReplacement)),
      },
      currentNodes: [],
      context: { input: {}, nested: structuredClone(userReplacement) },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(0),
      completedAt: new Date(1),
      sourceIntegrationPolicy: SOURCE_POLICY,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    };

    const projected = toPublicWorkflowRun(run);
    assertEquals(projected.context.nested, userReplacement);
    assertEquals(projected.nodeStates.report?.output, userReplacement);
    assertEquals(projected.output, userReplacement);
  });
});
