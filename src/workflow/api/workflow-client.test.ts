import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createWorkflowClient, WorkflowClient } from "./workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type {
  PersistedPendingApproval,
  PersistedPendingEventWait,
  RunEventDeliveryClaim,
  RunEventEnvelope,
  WorkflowBackend,
} from "../backends/types.ts";
import {
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
} from "../limits.ts";
import { branch } from "../dsl/branch.ts";
import { dependsOn, workflow } from "../dsl/workflow.ts";
import { loop } from "../dsl/loop.ts";
import { map } from "../dsl/map.ts";
import { parallel } from "../dsl/parallel.ts";
import { step } from "../dsl/step.ts";
import { subWorkflow } from "../dsl/sub-workflow.ts";
import { delay as delayNode, waitForApproval, waitForEvent } from "../dsl/wait.ts";
import { waitFor } from "#veryfront/testing/index.ts";
import { delay } from "#veryfront/testing/deno-compat.ts";
import {
  getPendingApprovalResponseSchemaId,
  projectPendingApproval,
} from "../runtime/pending-approval-metadata.ts";
import { EventWaitManager } from "../runtime/event-wait-manager.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { PendingApproval, WaitNodeConfig, WorkflowDefinition, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { captureWorkflowDefinition } from "../executor/workflow-definition-snapshot.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

class RejectingApprovalPersistenceBackend extends MemoryBackend {
  override savePendingApprovalIfStatusAndWorker(
    _runId: string,
    _expectedStatuses: WorkflowRun["status"][],
    _expectedWorkerId: string,
    _approval: PendingApproval,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class CountingApprovalReadsBackend extends MemoryBackend {
  approvalReads = 0;

  override getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    this.approvalReads++;
    return super.getPendingApprovals(runId);
  }
}

class NormalizingApprovalBackend extends MemoryBackend {
  override savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    approval: PersistedPendingApproval,
  ): Promise<boolean> {
    const normalized: PersistedPendingApproval = {
      ...projectPendingApproval(approval),
      ...(approval.responseSchemaId === undefined
        ? {}
        : { responseSchemaId: approval.responseSchemaId }),
    };
    return super.savePendingApprovalIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      normalized,
    );
  }
}

function createMockTool(name: string, output: unknown): Tool {
  return {
    id: name,
    type: "function",
    description: `Mock tool: ${name}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => Promise.resolve(output),
  };
}

describe("WorkflowClient", () => {
  let client: WorkflowClient;
  let backend: MemoryBackend;

  const testWorkflow = workflow({
    id: "test-workflow",
    description: "A test workflow",
    steps: [
      step("step1", { agent: "test-agent" }),
      step("step2", { tool: "test-tool" }),
    ],
  });

  const approvalWorkflow = workflow({
    id: "approval-workflow",
    steps: [
      step("prepare", { agent: "preparer" }),
      waitForApproval("review", { message: "Please review" }),
      step("finalize", { agent: "finalizer" }),
    ],
  });

  beforeEach(() => {
    backend = new MemoryBackend();
    client = createWorkflowClient({ backend });
    client.register(testWorkflow);
    client.register(approvalWorkflow);
  });

  afterEach(async () => {
    await client.destroy();
  });

  it("rejects dot-only custom run IDs", async () => {
    for (const runId of [".", ".."] as const) {
      await assertRejects(
        () => client.start("test-workflow", {}, { runId }),
        VeryfrontError,
        "path segment",
      );
    }
  });

  describe("typed approval payload", () => {
    const schemaWorkflow = workflow({
      id: "typed-approval-workflow",
      steps: [
        waitForApproval("review", {
          message: "Confirm the extracted values",
          responseSchema: defineSchema((v) =>
            v.object({ correctedName: v.string(), confirmed: v.boolean() })
          )(),
        }),
      ],
    });

    it("surfaces a schema-conformant payload in workflow context", async () => {
      client.register(schemaWorkflow);
      const handle = await client.start("typed-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await client.approve(handle.runId, approval.id, "reviewer", undefined, {
        correctedName: "Ada",
        confirmed: true,
      });

      const run = await backend.getRun(handle.runId);
      assertExists(run);
      const decision = run.nodeStates["review"]?.output as { data?: unknown } | undefined;
      assertEquals(decision?.data, { correctedName: "Ada", confirmed: true });
    });

    it("rejects a non-conformant payload without persisting the decision", async () => {
      client.register(schemaWorkflow);
      const handle = await client.start("typed-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await assertRejects(() =>
        client.approve(handle.runId, approval.id, "reviewer", undefined, {
          correctedName: 42,
        })
      );

      // Still pending: a bad payload must not consume the approval.
      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(stillPending.length, 1);
      assertEquals(stillPending[0]!.status, "pending");
    });

    it("rejects omitted data without persisting a decision when the schema requires it", async () => {
      client.register(schemaWorkflow);
      const handle = await client.start("typed-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await assertRejects(() => client.approve(handle.runId, approval.id, "reviewer"));

      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(stillPending.length, 1);
      assertEquals(stillPending[0]!.status, "pending");
    });

    it("validates a schema declared on a wait nested in a branch arm", async () => {
      client.register(workflow({
        id: "typed-branch-approval-workflow",
        steps: [
          branch("review-gate", {
            condition: () => true,
            then: [
              waitForApproval("nested-review", {
                message: "Review the branch arm",
                responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
              }),
            ],
          }),
        ],
      }));

      const handle = await client.start("typed-branch-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "review-gate/then/nested-review");

      await assertRejects(
        () =>
          client.approve(handle.runId, approval.id, "reviewer", undefined, {
            confirmed: "yes",
          }),
        Error,
        undefined,
        "a branch-nested responseSchema must reject a non-conformant payload",
      );

      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(
        stillPending.length,
        1,
        "a rejected payload must not consume the branch-nested approval",
      );
      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(
        run.context["review-gate/then/nested-review"],
        undefined,
        "a non-conformant branch-nested payload must never reach workflow context",
      );
    });

    it("validates a schema declared on a wait nested in a parallel node", async () => {
      client.register(workflow({
        id: "typed-parallel-approval-workflow",
        steps: [
          parallel("review-group", [
            waitForApproval("nested-review", {
              message: "Review the parallel arm",
              responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
            }),
          ]),
        ],
      }));

      const handle = await client.start("typed-parallel-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "review-group/nested-review");

      await assertRejects(
        () =>
          client.approve(handle.runId, approval.id, "reviewer", undefined, {
            confirmed: "yes",
          }),
        Error,
        undefined,
        "a parallel-nested responseSchema must reject a non-conformant payload",
      );

      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(
        stillPending.length,
        1,
        "a rejected payload must not consume the parallel-nested approval",
      );
      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(
        run.context["review-group/nested-review"],
        undefined,
        "a non-conformant parallel-nested payload must never reach workflow context",
      );
    });

    it("validates statically declared loop approval steps", async () => {
      const loopWorkflow = workflow({
        id: "typed-loop-approval-workflow",
        steps: [
          loop("review-loop", {
            while: () => false,
            maxIterations: 1,
            steps: [
              waitForApproval("review", {
                message: "Review loop item",
                responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
              }),
            ],
          }),
        ],
      });
      client.register(loopWorkflow);
      const runId = "run-static-loop-approval";
      await backend.createRun({
        id: runId,
        workflowId: loopWorkflow.id,
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review-loop/review"],
        context: { input: {}, runId, workflowId: loopWorkflow.id },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "apr-static-loop",
        nodeId: "review-loop/review",
        message: "Review loop item",
        payload: undefined,
        requestedAt: new Date(),
        status: "pending",
      });

      await assertRejects(() =>
        client.approve(runId, "apr-static-loop", "reviewer", undefined, {
          confirmed: "yes",
        })
      );

      const stillPending = await backend.getPendingApprovals(runId);
      assertEquals(stillPending.length, 1);
      assertEquals(stillPending[0]?.status, "pending");
    });

    it("cannot recover a function-generated response schema after a process restart", async () => {
      const dynamicLoopWorkflow = workflow({
        id: "dynamic-loop-approval-workflow",
        steps: [
          loop("review-loop", {
            while: () => false,
            maxIterations: 1,
            steps: () => [
              waitForApproval("review", {
                message: "Review loop item",
                responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
              }),
            ],
          }),
        ],
      });
      client.register(dynamicLoopWorkflow);
      const runId = "run-dynamic-loop-approval";
      await backend.createRun({
        id: runId,
        workflowId: dynamicLoopWorkflow.id,
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {}, runId, workflowId: dynamicLoopWorkflow.id },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "apr-dynamic-loop",
        nodeId: "review",
        message: "Review loop item",
        payload: undefined,
        requestedAt: new Date(),
        status: "pending",
      });

      await client.approve(runId, "apr-dynamic-loop", "reviewer", undefined, {
        confirmed: "yes",
      });

      assertEquals(await backend.getPendingApprovals(runId), []);
    });

    it("falls back to the configured internal response schema resolver", async () => {
      const workflowId = "custom-internal-schema-workflow";
      const responseSchemaId = "custom-backend-schema";
      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({
        backend,
        approval: {
          internalResponseSchemaResolver: ({ approval }) => {
            assertEquals(getPendingApprovalResponseSchemaId(approval), responseSchemaId);
            return defineSchema((v) => v.object({ confirmed: v.boolean() }))();
          },
        },
      });
      const runId = "run-custom-internal-schema";
      await backend.createRun({
        id: runId,
        workflowId,
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {}, runId, workflowId },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "apr-custom-internal-schema",
        nodeId: "review",
        message: "Review item",
        payload: undefined,
        requestedAt: new Date(),
        status: "pending",
        responseSchemaId,
      });

      await assertRejects(() =>
        client.approve(runId, "apr-custom-internal-schema", "reviewer", undefined, {
          confirmed: "yes",
        })
      );

      const [approval] = await backend.getPendingApprovals(runId);
      assertEquals(approval?.status, "pending");
    });

    it("drops stale approval schemas when a workflow id is re-registered", async () => {
      const workflowId = "re-registered-approval-workflow";
      client.register(workflow({
        id: workflowId,
        steps: [
          waitForApproval("review", {
            message: "Initial typed review",
            responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
          }),
        ],
      }));
      client.register(workflow({
        id: workflowId,
        steps: [
          waitForApproval("review", { message: "Replacement untyped review" }),
        ],
      }));

      const runId = "run-re-registered-approval";
      await backend.createRun({
        id: runId,
        workflowId,
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {}, runId, workflowId },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "apr-re-registered",
        nodeId: "review",
        message: "Replacement untyped review",
        payload: undefined,
        requestedAt: new Date(),
        status: "pending",
      });

      await client.approve(runId, "apr-re-registered", "reviewer", undefined, {
        confirmed: "yes",
      });

      assertEquals(await backend.getPendingApprovals(runId), []);
    });

    it("leaves comment-only approvals working when no schema is declared", async () => {
      client.register(workflow({
        id: "untyped-approval-workflow",
        steps: [waitForApproval("review", { message: "Confirm" })],
      }));

      const handle = await client.start("untyped-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await client.approve(handle.runId, approval.id, "reviewer", "looks good");
      assertEquals(await backend.getPendingApprovals(handle.runId), []);
    });

    it("recovers a parent schema when a sub-workflow reuses its node id", async () => {
      await client.destroy();
      backend = new NormalizingApprovalBackend();
      client = createWorkflowClient({ backend });
      const collidingSchemaWorkflow = workflow({
        id: "colliding-persisted-schema-workflow",
        steps: [
          waitForApproval("shared-review", {
            message: "Parent review",
            responseSchema: defineSchema((v) => v.object({ parent: v.string() }))(),
          }),
          dependsOn(
            subWorkflow("child-workflow", {
              workflow: workflow({
                id: "colliding-persisted-schema-child",
                steps: [
                  waitForApproval("shared-review", {
                    message: "Child review",
                    responseSchema: defineSchema((v) => v.object({ child: v.boolean() }))(),
                  }),
                ],
              }).definition,
            }),
            "shared-review",
          ),
        ],
      });
      client.register(collidingSchemaWorkflow);

      const handle = await client.start(collidingSchemaWorkflow.id, {});
      await handle.settled();
      const [parentApproval] = await backend.getPendingApprovals(handle.runId);
      assertExists(parentApproval);
      assertEquals(parentApproval.message, "Parent review");
      assertExists(getPendingApprovalResponseSchemaId(parentApproval));

      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({ backend });
      client.register(collidingSchemaWorkflow);

      await assertRejects(() =>
        client.approve(
          handle.runId,
          parentApproval.id,
          "reviewer",
          undefined,
          { child: true },
        )
      );

      await client.approve(
        handle.runId,
        parentApproval.id,
        "reviewer",
        undefined,
        { parent: "approved" },
      );
      assertEquals(await backend.getPendingApprovals(handle.runId), []);
    });

    it("persists the active wait path when two waits share one schema object", async () => {
      const workflowId = "shared-schema-path-workflow";
      const sharedSchema = defineSchema((v) => v.object({ first: v.string() }))();
      client.register(workflow({
        id: workflowId,
        steps: [
          waitForApproval("first-review", {
            message: "First review",
            responseSchema: sharedSchema,
          }),
          dependsOn(
            waitForApproval("second-review", {
              message: "Second review",
              responseSchema: sharedSchema,
            }),
            "first-review",
          ),
        ],
      }));

      const handle = await client.start(workflowId, {});
      await handle.settled();
      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "first-review");

      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({ backend });
      client.register(workflow({
        id: workflowId,
        steps: [
          waitForApproval("first-review", {
            message: "First review",
            responseSchema: defineSchema((v) => v.object({ first: v.string() }))(),
          }),
          dependsOn(
            waitForApproval("second-review", {
              message: "Second review",
              responseSchema: defineSchema((v) => v.object({ second: v.boolean() }))(),
            }),
            "first-review",
          ),
        ],
      }));

      await assertRejects(() =>
        client.approve(handle.runId, approval.id, "reviewer", undefined, {
          second: true,
        })
      );
      await client.approve(handle.runId, approval.id, "reviewer", undefined, {
        first: "approved",
      });
    });

    it("persists the active composite wait path when one wait config is reused", async () => {
      const workflowId = "reused-composite-wait-path-workflow";
      const reusedReview = waitForApproval("review", {
        message: "Review the selected branch",
        responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
      });
      client.register(workflow({
        id: workflowId,
        steps: [
          branch("route", {
            condition: () => true,
            then: [reusedReview],
            else: [reusedReview],
          }),
        ],
      }));

      const handle = await client.start(workflowId, {});
      await handle.settled();
      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "route/then/review");
      assertExists(getPendingApprovalResponseSchemaId(approval));

      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({ backend });
      client.register(workflow({
        id: workflowId,
        steps: [
          branch("route", {
            condition: () => true,
            then: [
              waitForApproval("review", {
                message: "Review the selected branch",
                responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
              }),
            ],
          }),
        ],
      }));

      await assertRejects(() =>
        client.approve(handle.runId, approval.id, "reviewer", undefined, {
          confirmed: "yes",
        })
      );
      assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
    });

    it("recovers a response schema from a static map node processor", async () => {
      const mappedApprovalWorkflow = workflow({
        id: "mapped-node-persisted-schema-workflow",
        steps: [
          map("reviews", {
            items: [{ change: "one" }],
            processor: waitForApproval("review", {
              message: "Review the mapped change",
              responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
            }),
          }),
        ],
      });
      client.register(mappedApprovalWorkflow);

      const handle = await client.start(mappedApprovalWorkflow.id, {});
      await handle.settled();
      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({ backend });
      client.register(mappedApprovalWorkflow);

      await assertRejects(() =>
        client.approve(
          handle.runId,
          approval.id,
          "reviewer",
          undefined,
          { confirmed: "yes" },
        )
      );
      assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
    });

    it("recovers a response schema from a static map workflow processor", async () => {
      const processor = workflow({
        id: "mapped-persisted-schema-processor",
        steps: [
          waitForApproval("review", {
            message: "Review the mapped workflow",
            responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
          }),
        ],
      }).definition;
      const mappedApprovalWorkflow = workflow({
        id: "mapped-workflow-persisted-schema-workflow",
        steps: [map("reviews", { items: [{ change: "one" }], processor })],
      });
      client.register(mappedApprovalWorkflow);

      const handle = await client.start(mappedApprovalWorkflow.id, {});
      await handle.settled();
      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      client.getApprovalManager().stop();
      client.getEventWaitManager().stop();
      client = createWorkflowClient({ backend });
      client.register(mappedApprovalWorkflow);

      await assertRejects(() =>
        client.approve(
          handle.runId,
          approval.id,
          "reviewer",
          undefined,
          { confirmed: "yes" },
        )
      );
      assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
    });
  });

  describe("definition-resolved wait config", () => {
    it("sets expiresAt on an approval created for a wait node with a timeout", async () => {
      client.register(workflow({
        id: "timeout-approval-workflow",
        steps: [
          waitForApproval("review", { message: "Confirm within the hour", timeout: "1h" }),
        ],
      }));

      const before = Date.now();
      const handle = await client.start("timeout-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertExists(
        approval.expiresAt,
        "a wait node timeout must produce an approval expiry",
      );

      const hourMs = 60 * 60 * 1000;
      const expiresAtMs = new Date(approval.expiresAt).getTime();
      assert(
        expiresAtMs >= before + hourMs && expiresAtMs <= Date.now() + hourMs,
        `expiresAt must be roughly one hour out, got ${approval.expiresAt}`,
      );
    });

    it("rejects a decision from an approver outside the allow-list", async () => {
      client.register(workflow({
        id: "allow-list-approval-workflow",
        steps: [
          waitForApproval("review", { message: "Restricted review", approvers: ["alice"] }),
        ],
      }));

      const handle = await client.start("allow-list-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await assertRejects(
        () => client.approve(handle.runId, approval.id, "bob"),
        VeryfrontError,
        "Not authorized to approve this request",
      );

      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(stillPending.length, 1);
      assertEquals(
        stillPending[0]!.status,
        "pending",
        "an unauthorized decision must not consume the approval",
      );
    });

    it("accepts a decision from an allow-listed approver and resumes the run", async () => {
      client.register(workflow({
        id: "allow-list-resume-workflow",
        steps: [
          waitForApproval("review", { message: "Restricted review", approvers: ["alice"] }),
        ],
      }));

      const handle = await client.start("allow-list-resume-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await client.approve(handle.runId, approval.id, "alice", "approved");

      assertEquals(await backend.getPendingApprovals(handle.runId), []);
      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "completed");
    });

    it("resolves timeout and approvers for a wait nested in a static sub-workflow", async () => {
      client.register(workflow({
        id: "sub-workflow-guarded-approval-workflow",
        steps: [
          subWorkflow("child-workflow", {
            workflow: workflow({
              id: "guarded-child-approval-workflow",
              steps: [
                waitForApproval("child-review", {
                  message: "Restricted child review",
                  timeout: "1h",
                  approvers: ["alice"],
                }),
              ],
            }).definition,
          }),
        ],
      }));

      const before = Date.now();
      const handle = await client.start("sub-workflow-guarded-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "child-review");

      assertExists(
        approval.expiresAt,
        "a sub-workflow wait node timeout must produce an approval expiry",
      );
      const hourMs = 60 * 60 * 1000;
      const expiresAtMs = new Date(approval.expiresAt).getTime();
      assert(
        expiresAtMs >= before + hourMs && expiresAtMs <= Date.now() + hourMs,
        `expiresAt must be roughly one hour out, got ${approval.expiresAt}`,
      );

      await assertRejects(
        () => client.approve(handle.runId, approval.id, "bob"),
        VeryfrontError,
        "Not authorized to approve this request",
      );
      const stillPending = await backend.getPendingApprovals(handle.runId);
      assertEquals(stillPending.length, 1);
      assertEquals(stillPending[0]!.status, "pending");

      await client.approve(handle.runId, approval.id, "alice");
      assertEquals(await backend.getPendingApprovals(handle.runId), []);
      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "completed");
    });

    it("uses the active wait config when nested node ids collide", async () => {
      client.register(workflow({
        id: "colliding-wait-config-workflow",
        steps: [
          waitForApproval("shared-review", {
            message: "Parent review",
            approvers: ["alice"],
          }),
          dependsOn(
            subWorkflow("child-workflow", {
              workflow: workflow({
                id: "colliding-child-workflow",
                steps: [
                  waitForApproval("shared-review", {
                    message: "Child review",
                    approvers: ["bob"],
                  }),
                ],
              }).definition,
            }),
            "shared-review",
          ),
        ],
      }));

      const handle = await client.start("colliding-wait-config-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.message, "Parent review");

      await assertRejects(
        () => client.approve(handle.runId, approval.id, "bob"),
        VeryfrontError,
        "Not authorized to approve this request",
      );
      assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
    });

    it("uses timeout, approvers, and response schema from a function-generated wait", async () => {
      client.register(workflow({
        id: "dynamic-wait-config-workflow",
        steps: [
          loop("review-loop", {
            while: (_context, loopContext) => loopContext.isFirstIteration,
            maxIterations: 1,
            steps: () => [
              waitForApproval("dynamic-review", {
                message: "Dynamic review",
                timeout: "1h",
                approvers: ["alice"],
                responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
              }),
            ],
          }),
        ],
      }));

      const before = Date.now();
      const handle = await client.start("dynamic-wait-config-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.message, "Dynamic review");
      assertExists(approval.expiresAt);
      const hourMs = 60 * 60 * 1000;
      const expiresAtMs = new Date(approval.expiresAt).getTime();
      assert(
        expiresAtMs >= before + hourMs && expiresAtMs <= Date.now() + hourMs,
        `expiresAt must be roughly one hour out, got ${approval.expiresAt}`,
      );

      await assertRejects(
        () => client.approve(handle.runId, approval.id, "bob"),
        VeryfrontError,
        "Not authorized to approve this request",
      );
      await assertRejects(() =>
        client.approve(handle.runId, approval.id, "alice", undefined, {
          confirmed: "yes",
        })
      );
      assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
    });

    it("forwards the active wait config to the user callback", async () => {
      const callbackBackend = new MemoryBackend();
      let observedConfig: WaitNodeConfig | undefined;
      const callbackClient = createWorkflowClient({
        backend: callbackBackend,
        executor: {
          onWaiting: (_run, _nodeId, waitConfig) => {
            observedConfig = waitConfig;
          },
        },
      });

      try {
        callbackClient.register(workflow({
          id: "wait-config-callback-workflow",
          steps: [
            waitForApproval("review", {
              message: "Inspect this policy",
              timeout: "1h",
              approvers: ["alice"],
            }),
          ],
        }));

        const handle = await callbackClient.start("wait-config-callback-workflow", {});
        await handle.settled();

        assertEquals(observedConfig?.timeout, "1h");
        assertEquals(observedConfig?.approvers, ["alice"]);
      } finally {
        await callbackClient.destroy();
      }
    });
  });

  describe("nested approval", () => {
    // The module docstring on veryfront/workflow documents exactly this shape:
    // a waitForApproval inside a branch.
    const nestedApprovalWorkflow = workflow({
      id: "nested-approval-workflow",
      steps: [
        branch("review-gate", {
          condition: () => true,
          then: [waitForApproval("nested-review", { message: "Please review" })],
        }),
        dependsOn(
          step("publish", {
            tool: createMockTool("publish-after-nested-approval", { published: true }),
          }),
          "review-gate",
        ),
      ],
    });

    const subWorkflowApprovalWorkflow = workflow({
      id: "sub-workflow-nested-approval-workflow",
      steps: [
        subWorkflow("child-workflow", {
          workflow: workflow({
            id: "child-approval-workflow",
            steps: [
              waitForApproval("child-review", { message: "Review child workflow" }),
            ],
          }).definition,
        }),
        dependsOn(
          step("publish-child", {
            tool: createMockTool("publish-after-sub-workflow-approval", { published: "child" }),
          }),
          "child-workflow",
        ),
      ],
    });

    it("creates a pending approval for a wait nested in a branch", async () => {
      client.register(nestedApprovalWorkflow);

      const handle = await client.start("nested-approval-workflow", {});
      await handle.settled();

      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(run.status, "waiting");

      // Branch children are qualified with their arm, and the approval is keyed
      // by that same id. Reporting the enclosing branch instead produced no
      // approval at all.
      const approvals = await backend.getPendingApprovals(handle.runId);
      assertEquals(approvals.length, 1);
      assertEquals(approvals[0]!.nodeId, "review-gate/then/nested-review");
      assertEquals(approvals[0]!.message, "Please review");
      assertEquals(run.currentNodes, ["review-gate/then/nested-review"]);
    });

    it("resolves a nested approval and lets the run continue", async () => {
      client.register(nestedApprovalWorkflow);

      const handle = await client.start("nested-approval-workflow", {});
      await handle.settled();

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);

      await client.approve(handle.runId, approval.id, "reviewer");

      assertEquals(await backend.getPendingApprovals(handle.runId), []);
      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(run.status, "completed");
      assertEquals(run.nodeStates["review-gate"]!.status, "completed");
      assertEquals(run.nodeStates["publish"]!.status, "completed");
      const output = run.output as Record<string, unknown>;
      assertEquals(output.publish, { published: true });
      assertEquals(
        (output["review-gate/then/nested-review"] as { approved?: boolean }).approved,
        true,
      );
    });

    it("creates and resolves a pending approval nested in a sub-workflow", async () => {
      client.register(subWorkflowApprovalWorkflow);

      const handle = await client.start("sub-workflow-nested-approval-workflow", {});
      await handle.settled();

      const waitingRun = await backend.getRun(handle.runId);
      assertExists(waitingRun);
      assertEquals(waitingRun.status, "waiting");
      assertEquals(waitingRun.currentNodes, ["child-review"]);

      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertEquals(approval.nodeId, "child-review");
      assertEquals(approval.message, "Review child workflow");

      await client.approve(handle.runId, approval.id, "reviewer");

      assertEquals(await backend.getPendingApprovals(handle.runId), []);
      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(run.status, "completed");
      assertEquals(run.nodeStates["child-workflow"]!.status, "completed");
      assertEquals(run.nodeStates["publish-child"]!.status, "completed");
      const output = run.output as Record<string, unknown>;
      assertEquals(output["publish-child"], { published: "child" });
    });
  });

  describe("register()", () => {
    async function withNewClient(
      register: (client: WorkflowClient) => void,
    ): Promise<void> {
      const client = createWorkflowClient({ backend: new MemoryBackend() });
      register(client);
      await client.destroy();
    }

    it("should register a workflow", async () => {
      await withNewClient((client) => client.register(testWorkflow));
    });

    it("should register workflow definition directly", async () => {
      await withNewClient((client) => client.register(testWorkflow.definition));
    });

    it("rejects raw event waits that forge the reserved delay name", async () => {
      await withNewClient((client) => {
        const definition = {
          id: "forged-delay-name-static",
          steps: [{
            id: "forged",
            config: {
              type: "wait",
              waitType: "event",
              eventName: "__delay__",
            },
          }],
        } as WorkflowDefinition;

        assertThrows(
          () => client.register(definition),
          VeryfrontError,
          "reserved delay event name",
        );
      });
    });

    it("rejects forged event waits returned by a steps builder at admission", async () => {
      const dynamicClient = createWorkflowClient({ backend: new MemoryBackend() });
      try {
        dynamicClient.register({
          id: "forged-delay-name-dynamic",
          steps: () => [{
            id: "forged",
            config: {
              type: "wait",
              waitType: "event",
              eventName: "__delay__",
            },
          }],
        } as WorkflowDefinition);

        const handle = await dynamicClient.start("forged-delay-name-dynamic", {});
        await handle.settled();

        assertEquals((await dynamicClient.getRun(handle.runId))?.status, "failed");
        assertEquals(await dynamicClient.getPendingEventWaits(handle.runId), []);
      } finally {
        await dynamicClient.destroy();
      }
    });

    it("registers a captured workflow without mutating its frozen wait config", async () => {
      const definition = captureWorkflowDefinition(
        workflow({
          id: "captured-response-schema-workflow",
          steps: [
            waitForApproval("review", {
              message: "Review the captured workflow",
              responseSchema: defineSchema((v) => v.object({ approved: v.boolean() }))(),
            }),
          ],
        }).definition,
      );
      if (!Array.isArray(definition.steps)) {
        throw new Error("Expected captured static workflow steps");
      }
      const [waitNode] = definition.steps;
      assertExists(waitNode);
      assert(Object.isFrozen(waitNode));
      assert(Object.isFrozen(waitNode.config));

      const capturedConfig = waitNode.config;
      client.register(definition);

      assertEquals(waitNode.config, capturedConfig);
      const handle = await client.start(definition.id, {});
      await handle.settled();
      const [approval] = await backend.getPendingApprovals(handle.runId);
      assertExists(approval);
      assertExists(getPendingApprovalResponseSchemaId(approval));
    });
  });

  describe("observeRunEvents()", () => {
    it("observes mutations made through a separate client sharing the backend", async () => {
      const run = {
        id: "shared-run",
        workflowId: "test-workflow",
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      } satisfies WorkflowRun;
      await backend.createRun(run);
      await backend.savePendingApproval(
        run.id,
        {
          id: "approval-with-internal-schema-identity",
          nodeId: "review",
          message: "Review",
          payload: undefined,
          requestedAt: new Date(),
          status: "pending",
          responseSchemaId: '["steps","review"]',
        } satisfies PersistedPendingApproval,
      );
      const observation = await client.observeRunEvents(run.id);
      assertExists(observation);
      assertEquals(observation.supported, true);
      if (!observation.supported) throw new Error("expected observation support");
      assertEquals(
        Object.hasOwn(observation.initial.pendingApprovals[0]!, "responseSchemaId"),
        false,
      );
      const iterator = observation.events[Symbol.asyncIterator]();
      const writer = createWorkflowClient({ backend });

      await writer.getBackend().updateRun(run.id, { status: "waiting" });
      await writer.getBackend().updateRun(run.id, { status: "running" });

      assertEquals((await iterator.next()).value, {
        type: "run.status",
        runId: run.id,
        status: "waiting",
      });
      assertEquals((await iterator.next()).value, {
        type: "run.status",
        runId: run.id,
        status: "running",
      });
      await observation.close();
      writer.getApprovalManager().stop();
      writer.getEventWaitManager().stop();
    });

    it("delivers approval.pending to a subscriber connected before the approval exists", async () => {
      client.register(
        workflow({
          id: "observed-approval-workflow",
          steps: [waitForApproval("review", { message: "Please review" })],
        }),
      );

      // Subscribe before the run parks: the approval id must arrive on the
      // stream itself, with no getPendingApprovals() call needed to learn it.
      const handle = await client.start("observed-approval-workflow", {});
      const observation = await client.observeRunEvents(handle.runId);
      assertExists(observation);
      assertEquals(observation.supported, true);
      if (!observation.supported) throw new Error("expected observation support");

      await handle.settled();
      const [approval] = await client.getPendingApprovals(handle.runId);
      assertExists(approval);
      await client.approve(handle.runId, approval.id, "reviewer");

      const events = [];
      for await (const event of observation.events) events.push(event);
      await observation.close();

      assertEquals(
        events.filter((event) => event.type === "approval.pending"),
        [{
          type: "approval.pending",
          runId: handle.runId,
          approvalId: approval.id,
          nodeId: "review",
          message: "Please review",
        }],
      );
      // The approval is persisted after the run parks, so it must be reported
      // after the waiting status it explains.
      const waitingIndex = events.findIndex((event) =>
        event.type === "run.status" && event.status === "waiting"
      );
      const approvalIndex = events.findIndex((event) => event.type === "approval.pending");
      assertEquals(waitingIndex >= 0, true);
      assertEquals(approvalIndex > waitingIndex, true);
    });

    it("returns an explicit unsupported result for a legacy custom backend", async () => {
      const legacy = new MemoryBackend();
      Object.defineProperty(legacy, "openRunObservation", { value: undefined });
      const legacyClient = createWorkflowClient({ backend: legacy });

      assertEquals(await legacyClient.observeRunEvents("anything"), {
        supported: false,
        reason: "unsupported",
      });
      await legacyClient.destroy();
    });
  });

  describe("start()", () => {
    it("should start a workflow and return a handle", async () => {
      const handle = await client.start("test-workflow", { topic: "test" });

      assertExists(handle);
      assertExists(handle.runId);
      assertEquals(typeof handle.runId, "string");
    });

    it("should create a run in the backend", async () => {
      const handle = await client.start("test-workflow", { data: "value" });

      const run = await backend.getRun(handle.runId);
      assertExists(run);
      assertEquals(run.workflowId, "test-workflow");
      assertEquals(run.input, { data: "value" });
    });

    it("should throw for unregistered workflow", async () => {
      await assertRejects(
        () => client.start("non-existent", {}),
        Error,
        "Workflow not found",
      );
    });

    it("should use resource-not-found for unregistered workflow", async () => {
      try {
        await client.start("non-existent", {});
        throw new Error("Expected start() to throw");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
        if (!(error instanceof VeryfrontError)) throw error;

        assertEquals(error.slug, "resource-not-found");
        assertEquals(error.status, 404);
      }
    });

    it("captures injected project env on the workflow run context", async () => {
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const originalProjectApiUrl = Deno.env.get("VERYFRONT_PROJECT_API_URL");

      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({
            SERVICENOW_USERNAME: "automation@example.com",
            AI_GATEWAY_TOKEN: "project-token",
            VERYFRONT_API_TOKEN: "should-be-filtered",
          }),
        );
        Deno.env.set("VERYFRONT_PROJECT_API_URL", "https://api.veryfront.com");

        const handle = await client.start("test-workflow", { topic: "test" });
        const run = await backend.getRun(handle.runId);

        assertExists(run);
        assertEquals(run.context.env, {
          SERVICENOW_USERNAME: "automation@example.com",
          AI_GATEWAY_TOKEN: "project-token",
        });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }

        if (originalProjectApiUrl === undefined) {
          Deno.env.delete("VERYFRONT_PROJECT_API_URL");
        } else {
          Deno.env.set("VERYFRONT_PROJECT_API_URL", originalProjectApiUrl);
        }
      }
    });

    it("does not expose captured tenant metadata in completed output or context", async () => {
      const tenantWorkflow = workflow({
        id: "tenant-output-workflow",
        steps: [
          step("tenant-step", {
            tool: createMockTool("tenant-tool", { result: "ok" }),
          }),
        ],
      });

      client.register(tenantWorkflow);

      const handle = await runWithRequestContext(
        {
          projectSlug: "tests-1d0745b0",
          projectId: "project-1",
          token: "internal-runtime-token",
          productionMode: false,
          branch: "main",
        },
        () => client.start("tenant-output-workflow", { topic: "test" }),
      );

      const output = await handle.result();
      const run = await backend.getRun(handle.runId);

      assertExists(run);
      assertEquals(run._tenant?.token, "internal-runtime-token");
      assertEquals((output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.context as Record<string, unknown>)["_tenant"], undefined);
      assertEquals(run.output, { "tenant-step": { result: "ok" } });
    });

    it("passes captured tenant metadata to workflow tool execution context", async () => {
      let capturedContext: ToolExecutionContext | undefined;
      const contextTool: Tool = {
        id: "context-tool",
        type: "function",
        description: "Capture workflow tool context",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: async (_input, context) => {
          capturedContext = context;
          return {
            projectSlug: context?.projectSlug,
            projectId: context?.projectId,
            authToken: context?.authToken,
            productionMode: context?.productionMode,
            releaseId: context?.releaseId,
            branch: context?.branch,
            environmentName: context?.environmentName,
          };
        },
      };
      const tenantWorkflow = workflow({
        id: "tenant-tool-context-workflow",
        steps: [
          step("tenant-step", {
            tool: contextTool,
          }),
        ],
      });

      client.register(tenantWorkflow);

      const handle = await runWithRequestContext(
        {
          projectSlug: "tests-1d0745b0",
          projectId: "project-1",
          token: "internal-runtime-token",
          productionMode: true,
          releaseId: "release-1",
          environmentName: "production",
        },
        () => client.start("tenant-tool-context-workflow", { topic: "test" }),
      );

      const output = await handle.result();

      assertEquals(capturedContext?.agentId, "workflow");
      assertEquals(output, {
        "tenant-step": {
          projectSlug: "tests-1d0745b0",
          projectId: "project-1",
          authToken: "internal-runtime-token",
          productionMode: true,
          releaseId: "release-1",
          branch: null,
          environmentName: "production",
        },
      });
    });

    it("resolves project-scoped tools from stored tenant context when resuming a run", async () => {
      const scopedTool = createMockTool("scoped-tool", { result: "ok" });
      const scopedBackend = new MemoryBackend();
      const scopedClient = createWorkflowClient({
        backend: scopedBackend,
        executor: {
          stepExecutor: {
            toolRegistry,
          },
        },
      });

      try {
        runWithCacheKeyContext(
          { projectId: "project-123", mode: "preview", versionId: "branch-123" },
          () => {
            toolRegistry.register(scopedTool.id, scopedTool);
          },
        );

        const tenantWorkflow = workflow({
          id: "tenant-scoped-tool-workflow",
          steps: [step("tenant-step", { tool: "scoped-tool" })],
        });
        scopedClient.register(tenantWorkflow);

        const run: WorkflowRun = {
          id: "run-scoped-tool",
          workflowId: tenantWorkflow.id,
          status: "pending",
          input: {},
          nodeStates: {},
          currentNodes: [],
          context: { input: {} },
          checkpoints: [],
          pendingApprovals: [],
          createdAt: new Date(),
          workerId: "worker-current-owner",
          sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
          _tenant: {
            projectSlug: "acme",
            token: "tenant-token",
            projectId: "project-123",
            productionMode: false,
            releaseId: null,
            branch: "branch-123",
          },
        };
        await scopedBackend.createRun(run);

        await assertRejects(
          () => scopedClient.resume(run.id, "worker-stale-owner"),
          Error,
          "ownership",
        );
        await scopedClient.resume(run.id, "worker-current-owner");

        const completedRun = await scopedBackend.getRun(run.id);
        assertEquals(completedRun?.status, "completed");
        assertEquals(completedRun?.output, { "tenant-step": { result: "ok" } });
      } finally {
        toolRegistryInternal.clearAll();
        await scopedClient.destroy();
      }
    });
  });

  describe("getRun()", () => {
    it("should retrieve a workflow run", async () => {
      const handle = await client.start("test-workflow", { input: "data" });
      const run = await client.getRun(handle.runId);

      assertExists(run);
      assertEquals(run.id, handle.runId);
      assertEquals(run.workflowId, "test-workflow");
    });

    it("should return null for non-existent run", async () => {
      const run = await client.getRun("non-existent");
      assertEquals(run, null);
    });
  });

  describe("listRuns()", () => {
    async function seedRuns(): Promise<void> {
      await client.start("test-workflow", {});
      await client.start("test-workflow", {});
      await client.start("approval-workflow", {});
    }

    it("should list workflow runs", async () => {
      await seedRuns();

      const all = await client.listRuns();
      assertEquals(all.length, 3);
    });

    it("should filter by workflowId", async () => {
      await seedRuns();

      const filtered = await client.listRuns({ workflowId: "test-workflow" });
      assertEquals(filtered.length, 2);
    });
  });

  describe("cancel()", () => {
    it("should cancel a workflow", async () => {
      const handle = await client.start("test-workflow", {});
      await client.cancel(handle.runId);

      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "cancelled");
    });
  });

  describe("approve() and reject()", () => {
    async function createWaitingApprovalRun(runId: string, approvalId: string): Promise<void> {
      await backend.createRun({
        id: runId,
        workflowId: "approval-workflow",
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });

      await backend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });
    }

    it("should approve a pending approval", async () => {
      // Create run directly in waiting state (avoid async execution race)
      const runId = "test-run-approval";
      await createWaitingApprovalRun(runId, "approval-1");

      await client.approve(runId, "approval-1", "admin@test.com", "Looks good!");

      const approval = await backend.getPendingApproval(runId, "approval-1");
      assertEquals(approval?.status, "approved");
      assertEquals(approval?.decidedBy, "admin@test.com");
      assertEquals(approval?.comment, "Looks good!");
    });

    it("allows an approval to resume while its notifier is still pending", async () => {
      const approvalPersisted = Promise.withResolvers<string>();
      const releaseNotifier = Promise.withResolvers<void>();
      const lockedBackend = new MemoryBackend();
      const lockedClient = createWorkflowClient({
        backend: lockedBackend,
        approval: {
          notifier: async (approval) => {
            approvalPersisted.resolve(approval.id);
            await releaseNotifier.promise;
          },
        },
      });
      const workflowId = "immediate-approval-workflow";
      lockedClient.register(
        workflow({
          id: workflowId,
          steps: [
            waitForApproval("review"),
            dependsOn(
              step("finish", { tool: createMockTool("finish", { ok: true }) }),
              "review",
            ),
          ],
        }),
      );
      const run: WorkflowRun = {
        id: "run-immediate-approval",
        workflowId,
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        workerId: "worker-current-owner",
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      await lockedBackend.createRun(run);
      const waitingExecution = lockedClient.resume(run.id, run.workerId);

      try {
        const approvalId = await approvalPersisted.promise;
        await lockedClient.approve(run.id, approvalId, "reviewer");

        const completedRun = await lockedBackend.getRun(run.id);
        assertEquals(completedRun?.status, "completed");
        assertEquals(
          (completedRun?.output as { finish?: unknown } | undefined)?.finish,
          { ok: true },
        );
      } finally {
        releaseNotifier.resolve();
        await waitingExecution;
        await lockedClient.destroy();
      }
    });

    it("fails an owner-bound run when approval persistence fails", async () => {
      const rejectingBackend = new RejectingApprovalPersistenceBackend();
      const rejectingClient = createWorkflowClient({ backend: rejectingBackend });
      const workflowId = "approval-persistence-failure-workflow";
      rejectingClient.register(
        workflow({ id: workflowId, steps: [waitForApproval("review")] }),
      );
      const run: WorkflowRun = {
        id: "run-approval-persistence-failure",
        workflowId,
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        workerId: "worker-current-owner",
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      await rejectingBackend.createRun(run);

      try {
        await assertRejects(
          () => rejectingClient.resume(run.id, run.workerId),
          Error,
          "ownership changed before approval persistence",
        );

        const failedRun = await rejectingBackend.getRun(run.id);
        assertEquals(failedRun?.status, "failed");
        assertEquals(await rejectingBackend.getPendingApprovals(run.id), []);
      } finally {
        await rejectingClient.destroy();
      }
    });

    it("should reject a pending approval", async () => {
      // Create run directly in waiting state (avoid async execution race)
      const runId = "test-run-rejection";
      await createWaitingApprovalRun(runId, "approval-2");

      await client.reject(runId, "approval-2", "reviewer@test.com", "Needs changes");

      const approval = await backend.getPendingApproval(runId, "approval-2");
      assertEquals(approval?.status, "rejected");
      assertEquals(approval?.comment, "Needs changes");
    });
  });

  describe("WorkflowHandle", () => {
    it("should provide status method", async () => {
      const handle = await client.start("test-workflow", {});
      const status = await handle.status();

      assertExists(status);
      assertEquals(status.id, handle.runId);
    });

    it("does not expose backend-only approval metadata from status", async () => {
      const handle = await client.start("test-workflow", {});
      await backend.savePendingApproval(
        handle.runId,
        {
          id: "approval-with-internal-schema-identity",
          nodeId: "review",
          message: "Review",
          payload: undefined,
          requestedAt: new Date(),
          status: "pending",
          responseSchemaId: '["steps","review"]',
        } satisfies PersistedPendingApproval,
      );

      const status = await handle.status();

      assertEquals(
        Object.hasOwn(status.pendingApprovals[0]!, "responseSchemaId"),
        false,
      );
    });

    it("should provide cancel method", async () => {
      const handle = await client.start("test-workflow", {});
      await handle.cancel();

      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "cancelled");
    });
  });
});

describe("createWorkflowClient()", () => {
  it("should create a client with default backend", async () => {
    const client = createWorkflowClient();
    assertExists(client);
    await client.destroy();
  });

  it("should create a client with custom backend", async () => {
    const backend = new MemoryBackend();
    const client = createWorkflowClient({ backend });
    assertExists(client);
    await client.destroy();
  });
});

describe(
  "WorkflowClient.getRun approvals",
  () => {
    it("uses the approvals hydrated by the backend without querying twice", async () => {
      const backend = new CountingApprovalReadsBackend({ debug: false });
      const client = createWorkflowClient({ backend, debug: false });
      const runId = "run-hydrated-approvals";
      await backend.createRun({
        id: runId,
        workflowId: "gated-hydration",
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {}, runId, workflowId: "gated-hydration" },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "approval-hydrated",
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });

      try {
        const run = await client.getRun(runId);
        assertEquals(run?.pendingApprovals.length, 1);
        assertEquals(backend.approvalReads, 1);
      } finally {
        await client.destroy();
      }
    });

    it("carries the approvals a waiting run is blocked on", async () => {
      // The run record declares `pendingApprovals`, but approvals are persisted
      // to their own store so they can be reserved atomically against a worker.
      // Nothing wrote the field, so every reader saw an empty array while the run
      // sat waiting -- including useWorkflow, which announces approvals from it.
      const client = createWorkflowClient({
        backend: new MemoryBackend({ debug: false }),
        debug: false,
      });
      client.register(
        workflow({ id: "gated", steps: [waitForApproval("sign-off", { message: "ok?" })] }),
      );

      try {
        const handle = await client.start("gated", {});

        let approvals: PendingApproval[] = [];
        for (let attempt = 0; attempt < 100; attempt++) {
          approvals = await client.getPendingApprovals(handle.runId);
          if (approvals.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assertEquals(approvals.length, 1);

        const run = await client.getRun(handle.runId);
        assertEquals(run?.status, "waiting");
        assertEquals(run?.pendingApprovals.length, 1);
        assertEquals(run?.pendingApprovals[0]?.id, approvals[0]?.id);
      } finally {
        await client.destroy();
      }
    });

    it("clears them from the run once the approval is resolved", async () => {
      const client = createWorkflowClient({
        backend: new MemoryBackend({ debug: false }),
        debug: false,
      });
      client.register(
        workflow({ id: "gated-2", steps: [waitForApproval("sign-off", { message: "ok?" })] }),
      );

      try {
        const handle = await client.start("gated-2", {});

        let approvalId: string | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          approvalId = (await client.getPendingApprovals(handle.runId))[0]?.id;
          if (approvalId) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assertExists(approvalId);

        await client.approve(handle.runId, approvalId, "tester");

        const run = await client.getRun(handle.runId);
        assertEquals(run?.pendingApprovals.length, 0);
      } finally {
        await client.destroy();
      }
    });

    it("returns null for a run that does not exist", async () => {
      const client = createWorkflowClient({
        backend: new MemoryBackend({ debug: false }),
        debug: false,
      });
      try {
        assertEquals(await client.getRun("run_missing"), null);
      } finally {
        await client.destroy();
      }
    });
  },
);

/**
 * Refuses every conditional run update while armed, which is what delivery
 * looks like when ownership of the run keeps changing under a worker pool.
 * Reconciliation exhausts its attempts and throws.
 */
class BlockableRunUpdateBackend extends MemoryBackend {
  blockRunUpdates = false;

  override updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (this.blockRunUpdates) return Promise.resolve(false);
    return super.updateRunIfStatus(runId, expectedStatuses, patch);
  }

  override updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (this.blockRunUpdates) return Promise.resolve(false);
    return super.updateRunIfStatusAndWorker(runId, expectedStatuses, expectedWorkerId, patch);
  }
}

/**
 * Fails delivery for one named node only, by refusing the run read that
 * reconciliation starts from, and leaves every other wait deliverable.
 */
class FailOneNodeDeliveryBackend extends MemoryBackend {
  private deliveringFailingNode = false;

  constructor(private readonly failingNodeId: string) {
    super();
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    if (this.deliveringFailingNode) {
      return Promise.reject(new Error(`run read refused for ${runId}`));
    }
    return super.getRun(runId);
  }

  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    const pending = await super.getPendingEventWaits(runId);
    this.deliveringFailingNode = pending.some(
      (wait) => wait.id === waitId && wait.nodeId === this.failingNodeId,
    );
    return await super.claimRunEventForWait(runId, waitId, eventName);
  }

  override restorePendingEventWait(runId: string, waitId: string): Promise<boolean> {
    this.deliveringFailingNode = false;
    return super.restorePendingEventWait(runId, waitId);
  }

  override async restoreRunEventDelivery(
    runId: string,
    waitId: string,
    event: RunEventEnvelope,
  ): Promise<boolean> {
    try {
      return await super.restoreRunEventDelivery(runId, waitId, event);
    } finally {
      this.deliveringFailingNode = false;
    }
  }
}

class FailFirstDeliveryRunReadBackend extends MemoryBackend {
  private rejectDeliveryRead = false;
  private failedOnce = false;

  override getRun(runId: string): Promise<WorkflowRun | null> {
    if (this.rejectDeliveryRead) {
      return Promise.reject(new Error(`transient run read failure for ${runId}`));
    }
    return super.getRun(runId);
  }

  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    const event = await super.claimRunEventForWait(runId, waitId, eventName);
    if (event && !this.failedOnce) {
      this.failedOnce = true;
      this.rejectDeliveryRead = true;
    }
    return event;
  }

  override async restoreRunEventDelivery(
    runId: string,
    waitId: string,
    event: RunEventEnvelope,
  ): Promise<boolean> {
    try {
      return await super.restoreRunEventDelivery(runId, waitId, event);
    } finally {
      this.rejectDeliveryRead = false;
    }
  }
}

class RejectCommittedOutcomeReadBackend extends MemoryBackend {
  private deliveryCommitted = false;
  private committedReads = 0;

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    const updated = await super.updateRunIfStatus(runId, expectedStatuses, patch);
    if (updated && patch.nodeStates?.gate?.status === "completed") {
      this.deliveryCommitted = true;
    }
    return updated;
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    if (this.deliveryCommitted) {
      this.committedReads++;
      if (this.committedReads === 2) {
        return Promise.reject(new Error("committed outcome read unavailable"));
      }
    }
    return super.getRun(runId);
  }
}

/**
 * Refuses to persist run failures on demand, so an expired wait's run
 * transition fails while everything else keeps working.
 */
class RefusingRunFailureBackend extends MemoryBackend {
  refuseRunFailures = false;
  refusedFailures = 0;

  override updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (this.refuseRunFailures && patch.status === "failed") {
      this.refusedFailures++;
      return Promise.reject(new Error("run failure write refused"));
    }
    return super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

class PausingRunFailureBackend extends MemoryBackend {
  readonly failureUpdateStarted = Promise.withResolvers<void>();
  readonly releaseFailureUpdate = Promise.withResolvers<void>();
  pauseFailureUpdate = false;
  failureUpdates = 0;

  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed") {
      this.failureUpdates++;
      if (this.pauseFailureUpdate) {
        this.pauseFailureUpdate = false;
        this.failureUpdateStarted.resolve();
        await this.releaseFailureUpdate.promise;
      }
    }
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

/**
 * Turns the run terminal between publishEvent's status check and the append,
 * the window the post-drain reconciliation exists to cover.
 */
class TerminalDuringAppendBackend extends MemoryBackend {
  cancelBeforeNextAppend = false;

  override async appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    if (this.cancelBeforeNextAppend) {
      this.cancelBeforeNextAppend = false;
      await super.updateRun(runId, { status: "cancelled", completedAt: new Date() });
    }
    await super.appendRunEvent(runId, event);
  }
}

/** Deletes an observed run before accepting the publisher's envelope. */
class DeleteDuringAppendBackend extends MemoryBackend {
  deleteBeforeNextAppend = false;

  override async appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    if (this.deleteBeforeNextAppend) {
      this.deleteBeforeNextAppend = false;
      await super.deleteRun(runId);
    }
    await super.appendRunEvent(runId, event);
  }
}

class RetryDuringTerminalCleanupBackend extends MemoryBackend {
  private terminalReadCountdown = 0;

  armTerminalReadAfterInitialCheck(): void {
    this.terminalReadCountdown = 2;
  }

  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    if (!run || this.terminalReadCountdown === 0) return run;
    this.terminalReadCountdown--;
    if (this.terminalReadCountdown !== 0) return run;

    queueMicrotask(() => {
      void super.updateRun(runId, { status: "waiting" }).then(() =>
        super.appendRunEvent(runId, {
          id: "evt-retry-publish",
          eventName: "audit.recorded",
          payload: { retry: true },
          publishedAt: new Date(),
        })
      );
    });
    return { ...run, status: "cancelled" };
  }
}

/**
 * Resolves one wait behind the manager's back, between the read that listed it
 * and the claim, so the claim loses and the taken event has to go back.
 */
class ResolveBeforeClaimBackend extends MemoryBackend {
  stealWaitId?: string;
  lastPublishedAt?: Date;

  override appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    this.lastPublishedAt = event.publishedAt;
    return super.appendRunEvent(runId, event);
  }

  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    if (this.stealWaitId) {
      const stolen = this.stealWaitId;
      this.stealWaitId = undefined;
      await super.resolvePendingEventWait(runId, stolen, "delivered");
    }
    return await super.claimRunEventForWait(runId, waitId, eventName);
  }
}

class FailRunAfterEventClaimBackend extends MemoryBackend {
  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    const event = await super.claimRunEventForWait(runId, waitId, eventName);
    if (event) await super.updateRun(runId, { status: "failed", completedAt: new Date() });
    return event;
  }
}

class SlowFirstWaitClaimBackend extends MemoryBackend {
  slowWaitId?: string;

  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    if (waitId === this.slowWaitId) await delay(30);
    return await super.claimRunEventForWait(runId, waitId, eventName);
  }
}

class CoordinatedOverlappingDrainBackend extends MemoryBackend {
  readonly firstClaimStarted = Promise.withResolvers<void>();
  readonly releaseFirstClaim = Promise.withResolvers<void>();
  readonly secondClaimStarted = Promise.withResolvers<void>();
  readonly releaseSecondClaim = Promise.withResolvers<void>();
  private armed = false;
  private claimCalls = 0;

  arm(): void {
    this.armed = true;
  }

  override async claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
  ): Promise<RunEventEnvelope | null> {
    if (!this.armed) return await super.claimRunEventForWait(runId, waitId, eventName);
    this.claimCalls++;
    if (this.claimCalls === 1) {
      this.firstClaimStarted.resolve();
      await this.releaseFirstClaim.promise;
      return null;
    }
    if (this.claimCalls === 2) {
      this.secondClaimStarted.resolve();
      await this.releaseSecondClaim.promise;
    }
    return await super.claimRunEventForWait(runId, waitId, eventName);
  }
}

class SlowPendingEventWaitListBackend extends MemoryBackend {
  listDelayMs = 0;

  override async listPendingEventWaits(): Promise<
    Array<{ runId: string; wait: PersistedPendingEventWait }>
  > {
    const waits = await super.listPendingEventWaits();
    await delay(this.listDelayMs);
    return waits;
  }
}

class RejectOnceEventWaitResolutionBackend extends MemoryBackend {
  rejectedResolutions = 0;

  override resolvePendingEventWait(
    runId: string,
    waitId: string,
    status: "delivered" | "expired" | "cancelled",
  ): Promise<boolean> {
    if (status === "expired" && this.rejectedResolutions === 0) {
      this.rejectedResolutions++;
      return Promise.reject(new Error("transient event wait resolution failure"));
    }
    return super.resolvePendingEventWait(runId, waitId, status);
  }
}

class FinalizationObservingBackend extends MemoryBackend {
  finalizedEventIds: string[] = [];

  override finalizeRunEventDelivery(
    runId: string,
    eventId: string,
    delivered: boolean,
  ): Promise<void> {
    this.finalizedEventIds.push(eventId);
    return super.finalizeRunEventDelivery(runId, eventId, delivered);
  }
}

class CompleteSiblingDuringTimeoutBackend extends MemoryBackend {
  override async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.status === "failed" && patch.nodeStates?.timed) {
      await super.updateRun(runId, {
        nodeStates: {
          sibling: {
            nodeId: "sibling",
            status: "completed",
            output: { accepted: true },
            attempt: 1,
            completedAt: new Date(),
          },
        },
      });
    }
    return await super.updateRunIfStatus(runId, expectedStatuses, patch);
  }
}

/**
 * Claims a timed wait the moment its record is persisted, before the manager
 * that created it regains control: the window in which another client's
 * publish can resolve the record and clear its expiry.
 */
class ClaimDuringPersistBackend extends MemoryBackend {
  manager?: EventWaitManager;
  claimedWaitIds: string[] = [];

  override async savePendingEventWaitIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    wait: PersistedPendingEventWait,
  ): Promise<boolean> {
    const saved = await super.savePendingEventWaitIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      wait,
    );
    if (saved && wait.expiresAt !== undefined && this.manager) {
      await super.resolvePendingEventWait(runId, wait.id, "delivered");
      this.manager.clearWaitExpiry(wait.id);
      this.claimedWaitIds.push(wait.id);
    }
    return saved;
  }
}

/**
 * Distinguishes the atomic delivery rollback from the two-call sequence it
 * replaced: a standalone wait restore during a rollback is the crash window
 * in which the event would be lost.
 */
class RollbackObservingBackend extends BlockableRunUpdateBackend {
  standaloneWaitRestores = 0;
  combinedRestores = 0;
  private inCombinedRestore = false;

  override restorePendingEventWait(runId: string, waitId: string): Promise<boolean> {
    if (!this.inCombinedRestore) this.standaloneWaitRestores++;
    return super.restorePendingEventWait(runId, waitId);
  }

  override async restoreRunEventDelivery(
    runId: string,
    waitId: string,
    event: RunEventEnvelope,
  ): Promise<boolean> {
    this.combinedRestores++;
    this.inCombinedRestore = true;
    try {
      return await super.restoreRunEventDelivery(runId, waitId, event);
    } finally {
      this.inCombinedRestore = false;
    }
  }
}

class RefusingDeliveryRollbackBackend extends BlockableRunUpdateBackend {
  override restoreRunEventDelivery(): Promise<boolean> {
    return Promise.reject(new Error("delivery rollback refused"));
  }
}

class FailFirstDeliveryFinalizationBackend extends MemoryBackend {
  finalizationAttempts = 0;

  override finalizeRunEventDelivery(
    runId: string,
    eventId: string,
    delivered: boolean,
  ): Promise<void> {
    this.finalizationAttempts++;
    if (this.finalizationAttempts === 1) {
      return Promise.reject(new Error("delivery finalization unavailable"));
    }
    return super.finalizeRunEventDelivery(runId, eventId, delivered);
  }
}

class AlwaysFailDeliveryFinalizationBackend extends MemoryBackend {
  finalizationAttempts = 0;

  override finalizeRunEventDelivery(): Promise<void> {
    this.finalizationAttempts++;
    return Promise.reject(new Error("delivery finalization remains unavailable"));
  }
}

class RejectTimedFinalizationBackend extends MemoryBackend {
  override finalizeTimedEventWaitClaim(): Promise<void> {
    return Promise.reject(new Error("timed claim finalization unavailable"));
  }
}

class CountingDeliveryClaimReadsBackend extends MemoryBackend {
  deliveryClaimReads = 0;

  override listRunEventDeliveryClaims(runId?: string): Promise<RunEventDeliveryClaim[]> {
    this.deliveryClaimReads++;
    return super.listRunEventDeliveryClaims(runId);
  }
}

class DrainFromOtherManagerOnAppendBackend extends MemoryBackend {
  manager?: EventWaitManager;
  armed = false;
  rejectFinalization = false;

  override async appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    await super.appendRunEvent(runId, event);
    if (this.armed) await this.manager?.drainPendingEvents(runId);
  }

  override finalizeRunEventDelivery(
    runId: string,
    eventId: string,
    delivered: boolean,
  ): Promise<void> {
    if (this.rejectFinalization) {
      return Promise.reject(new Error("delivery finalization unavailable"));
    }
    return super.finalizeRunEventDelivery(runId, eventId, delivered);
  }
}

function sharedBackendView(backend: MemoryBackend): WorkflowBackend {
  return new Proxy(backend, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

class ReactivateFailedDuringAppendBackend extends MemoryBackend {
  reactivateOnAppend = false;

  override async appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    await super.appendRunEvent(runId, event);
    if (this.reactivateOnAppend) {
      this.reactivateOnAppend = false;
      await super.updateRun(runId, { status: "waiting", error: undefined });
    }
  }
}

class RejectOneRunPendingWaitReadBackend extends MemoryBackend {
  rejectedRunId?: string;

  override getPendingEventWaits(runId: string): Promise<PersistedPendingEventWait[]> {
    if (runId === this.rejectedRunId) {
      return Promise.reject(new Error(`pending wait read refused for ${runId}`));
    }
    return super.getPendingEventWaits(runId);
  }
}

class FailingTerminalWaitCleanupBackend extends MemoryBackend {
  override resolvePendingEventWait(
    runId: string,
    waitId: string,
    status: "delivered" | "expired" | "cancelled",
  ): Promise<boolean> {
    if (runId === "run_terminal_cleanup_failure" && status === "cancelled") {
      return Promise.reject(new Error(`terminal wait cleanup refused for ${waitId}`));
    }
    return super.resolvePendingEventWait(runId, waitId, status);
  }
}

describe("WorkflowClient durable event waits", () => {
  let client: WorkflowClient;
  let backend: MemoryBackend;

  const eventWorkflow = workflow({
    id: "event-workflow",
    steps: [
      step("before", { tool: createMockTool("before-tool", { ok: true }) }),
      waitForEvent("await-payment", { eventName: "payment.confirmed" }),
      step("after", { tool: createMockTool("after-tool", { done: true }) }),
    ],
  });

  beforeEach(() => {
    backend = new MemoryBackend();
    client = createWorkflowClient({ backend });
  });

  it("coalesces concurrent event-wait creation for the same live node", async () => {
    const run: WorkflowRun = {
      id: "run_concurrent_event_wait",
      workflowId: "concurrent-event-wait",
      status: "waiting",
      workerId: "run-execution:owner",
      input: {},
      nodeStates: {
        gate: { nodeId: "gate", status: "running", attempt: 1, startedAt: new Date() },
      },
      currentNodes: ["gate"],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
    };
    await backend.createRun(run);
    const manager = client.getEventWaitManager();
    const waitConfig: WaitNodeConfig = {
      type: "wait",
      waitType: "event",
      eventName: "gate.ready",
    };

    const waits = await Promise.all([
      manager.createEventWait(run, "gate", waitConfig),
      manager.createEventWait(run, "gate", waitConfig),
    ]);

    assertEquals(waits[0]?.id, waits[1]?.id);
    assertEquals((await backend.getPendingEventWaits(run.id)).length, 1);
  });

  it("attributes delivery when another client drains during publication", async () => {
    const shared = new DrainFromOtherManagerOnAppendBackend();
    const parked = createWorkflowClient({ backend: sharedBackendView(shared) });
    const publisher = createWorkflowClient({ backend: sharedBackendView(shared) });
    try {
      parked.register(eventWorkflow);
      const handle = await parked.start("event-workflow", {});
      await handle.settled();
      shared.manager = parked.getEventWaitManager();
      shared.armed = true;

      assertEquals(
        await publisher.publishEvent(handle.runId, "payment.confirmed", { amount: 42 }),
        "delivered",
        "the publisher must observe the exact envelope delivered by the other manager",
      );
      assertEquals((await parked.getRun(handle.runId))?.status, "completed");
    } finally {
      await parked.destroy();
      await publisher.destroy();
    }
  });

  it("observes another client's committed delivery while receipt finalization retries", async () => {
    const shared = new DrainFromOtherManagerOnAppendBackend();
    const parked = createWorkflowClient({ backend: sharedBackendView(shared) });
    const publisher = createWorkflowClient({ backend: sharedBackendView(shared) });
    try {
      parked.register(workflow({
        id: "cross-process-finalization-retry",
        steps: [
          waitForEvent("gate", { eventName: "gate.ready" }),
          waitForApproval("keep-active", { message: "Keep the run active" }),
        ],
      }));
      const handle = await parked.start("cross-process-finalization-retry", {});
      await handle.settled();
      shared.manager = parked.getEventWaitManager();
      shared.armed = true;
      shared.rejectFinalization = true;

      assertEquals(
        await publisher.publishEvent(handle.runId, "gate.ready", {}),
        "delivered",
        "the durable claim plus committed node must be observable before its receipt persists",
      );
      assertEquals((await shared.listRunEventDeliveryClaims(handle.runId)).length, 1);
      assertEquals((await parked.getRun(handle.runId))?.nodeStates.gate?.status, "completed");
    } finally {
      await parked.destroy();
      await publisher.destroy();
    }
  });

  it("rejects event names that no public wait can consume", async () => {
    for (
      const eventName of [
        "",
        " payment.confirmed ",
        "__delay__",
        "x".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS + 1),
      ]
    ) {
      await assertRejects(
        () => client.publishEvent("run_invalid_event_name", eventName, {}),
        Error,
        "eventName",
      );
      assertEquals(
        await backend.takeRunEvent("run_invalid_event_name", eventName),
        null,
        `invalid event ${JSON.stringify(eventName)} must not consume mailbox capacity`,
      );
    }
  });

  it("continues the expiry sweep after one terminal wait cleanup fails", async () => {
    const flakyBackend = new FailingTerminalWaitCleanupBackend();
    const sweepingClient = createWorkflowClient({
      backend: flakyBackend,
      eventWait: { expirationCheckInterval: 3_600_000 },
    });
    const pendingWait = (
      runId: string,
      nodeId: string,
      expiresAt?: Date,
    ): PersistedPendingEventWait => ({
      id: `wait_${nodeId}`,
      runId,
      nodeId,
      eventName: `${nodeId}.completed`,
      waitKind: "event",
      requestedAt: new Date(0),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      status: "pending",
    });

    try {
      const terminalRun: WorkflowRun = {
        id: "run_terminal_cleanup_failure",
        workflowId: "terminal-cleanup",
        status: "completed",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(0),
        completedAt: new Date(1),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      const expiringRun: WorkflowRun = {
        ...terminalRun,
        id: "run_expiry_after_cleanup_failure",
        workflowId: "expiry-after-cleanup",
        status: "waiting",
        completedAt: undefined,
        nodeStates: {
          later: { nodeId: "later", status: "running", attempt: 1 },
        },
      };
      await flakyBackend.createRun(terminalRun);
      await flakyBackend.savePendingEventWait(
        terminalRun.id,
        pendingWait(terminalRun.id, "terminal"),
      );
      await flakyBackend.createRun(expiringRun);
      await flakyBackend.savePendingEventWait(
        expiringRun.id,
        pendingWait(expiringRun.id, "later", new Date(1)),
      );

      await sweepingClient.getEventWaitManager().checkExpiredEventWaits();

      assertEquals(
        (await flakyBackend.getRun(expiringRun.id))?.status,
        "failed",
        "a terminal cleanup failure must not block a later expired wait",
      );
    } finally {
      await sweepingClient.destroy();
    }
  });

  it("continues recovered-run drains after one run fails", async () => {
    const flakyBackend = new RejectOneRunPendingWaitReadBackend();
    const sweepingClient = createWorkflowClient({
      backend: flakyBackend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    const recoveryWorkflow = workflow({
      id: "isolated-recovered-drain",
      steps: [
        waitForEvent("gate", { eventName: "gate.ready" }),
        step("after", { tool: createMockTool("recovered-after", { done: true }) }),
      ],
    });
    sweepingClient.register(recoveryWorkflow);
    try {
      const bad = await sweepingClient.start("isolated-recovered-drain", {});
      const good = await sweepingClient.start("isolated-recovered-drain", {});
      await Promise.all([bad.settled(), good.settled()]);
      for (const handle of [bad, good]) {
        const [wait] = await flakyBackend.getPendingEventWaits(handle.runId);
        assertExists(wait);
        const event: RunEventEnvelope = {
          id: `event-${handle.runId}`,
          eventName: "gate.ready",
          payload: { runId: handle.runId },
          publishedAt: new Date(),
        };
        await flakyBackend.appendRunEvent(handle.runId, event);
        assertExists(
          await flakyBackend.claimRunEventForWait(
            handle.runId,
            wait.id,
            event.eventName,
          ),
        );
      }
      flakyBackend.rejectedRunId = bad.runId;

      await sweepingClient.getEventWaitManager().checkExpiredEventWaits();

      assertEquals(
        (await sweepingClient.getRun(good.runId))?.status,
        "completed",
        "one recovered run failure must not block a later recovered run",
      );
    } finally {
      await sweepingClient.destroy();
    }
  });

  it("honors event publication time when an earlier wait delays its claim", async () => {
    const slowBackend = new SlowFirstWaitClaimBackend();
    const slowClient = createWorkflowClient({
      backend: slowBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const runId = "run_deadline_during_drain";
    try {
      await slowBackend.createRun({
        id: runId,
        workflowId: "deadline-during-drain",
        status: "waiting",
        input: {},
        nodeStates: {
          first: { nodeId: "first", status: "running", attempt: 1 },
          second: { nodeId: "second", status: "running", attempt: 1 },
        },
        currentNodes: ["first", "second"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      slowBackend.slowWaitId = "wait-first";
      await slowBackend.savePendingEventWait(runId, {
        id: "wait-first",
        runId,
        nodeId: "first",
        eventName: "first.ready",
        waitKind: "event",
        requestedAt: new Date(),
        status: "pending",
      });
      await slowBackend.savePendingEventWait(runId, {
        id: "wait-second",
        runId,
        nodeId: "second",
        eventName: "second.ready",
        waitKind: "event",
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 5),
        status: "pending",
      });

      assertEquals(await slowClient.publishEvent(runId, "second.ready", {}), "delivered");
      assertEquals((await slowBackend.getRun(runId))?.nodeStates.second?.status, "completed");
    } finally {
      await slowClient.destroy();
    }
  });

  it("checks each swept deadline after asynchronous backend reads", async () => {
    const slowBackend = new SlowPendingEventWaitListBackend();
    const sweepingClient = createWorkflowClient({
      backend: slowBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const runId = "run_deadline_during_sweep";
    try {
      await slowBackend.createRun({
        id: runId,
        workflowId: "deadline-during-sweep",
        status: "waiting",
        input: {},
        nodeStates: {
          timed: { nodeId: "timed", status: "running", attempt: 1 },
        },
        currentNodes: ["timed"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await slowBackend.savePendingEventWait(runId, {
        id: "wait-timed-sweep",
        runId,
        nodeId: "timed",
        eventName: "timed.ready",
        waitKind: "event",
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 20),
        status: "pending",
      });
      slowBackend.listDelayMs = 40;

      await sweepingClient.getEventWaitManager().checkExpiredEventWaits();

      assertEquals(
        (await slowBackend.getRun(runId))?.status,
        "failed",
        "a wait expiring while the backend lists it must be handled by this sweep",
      );
    } finally {
      await sweepingClient.destroy();
    }
  });

  it("merges only the timed-out node over a concurrent sibling completion", async () => {
    const racingBackend = new CompleteSiblingDuringTimeoutBackend();
    const racingClient = createWorkflowClient({
      backend: racingBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const runId = "run_timeout_sibling_merge";
    try {
      await racingBackend.createRun({
        id: runId,
        workflowId: "timeout-sibling-merge",
        status: "waiting",
        input: {},
        nodeStates: {
          timed: { nodeId: "timed", status: "running", attempt: 1 },
          sibling: { nodeId: "sibling", status: "running", attempt: 1 },
        },
        currentNodes: ["timed", "sibling"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await racingBackend.savePendingEventWait(runId, {
        id: "wait-timed",
        runId,
        nodeId: "timed",
        eventName: "timed.ready",
        waitKind: "event",
        requestedAt: new Date(0),
        expiresAt: new Date(1),
        status: "pending",
      });

      await racingClient.getEventWaitManager().checkExpiredEventWaits();

      const run = await racingBackend.getRun(runId);
      assertEquals(run?.nodeStates.timed?.status, "failed");
      assertEquals(run?.nodeStates.sibling?.status, "completed");
      assertEquals(run?.nodeStates.sibling?.output, { accepted: true });
    } finally {
      await racingClient.destroy();
    }
  });

  afterEach(async () => {
    await client.destroy();
  });

  it("persists a pending event wait naming the event the run is parked on", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();

    const waits = await client.getPendingEventWaits(handle.runId);
    assertEquals(
      waits.length,
      1,
      "a run parked on waitForEvent must persist exactly one pending event wait",
    );
    assertEquals(
      waits[0]?.nodeId,
      "await-payment",
      "the persisted wait must name the node that parked",
    );
    assertEquals(
      waits[0]?.eventName,
      "payment.confirmed",
      "the persisted wait must name the event that releases it",
    );
  });

  it("persists a whole waiting batch before draining buffered events", async () => {
    client.register(workflow({
      id: "buffered-wait-batch",
      steps: [
        { ...waitForEvent("first", { eventName: "first.ready" }), dependsOn: [] },
        { ...waitForEvent("second", { eventName: "second.ready" }), dependsOn: [] },
      ],
    }));
    const runId = "run_buffered_wait_batch";
    await client.publishEvent(runId, "first.ready", { first: true });

    const handle = await client.start("buffered-wait-batch", {}, { runId });
    await handle.settled();

    assertEquals(
      (await client.getPendingEventWaits(runId)).map((wait) => wait.nodeId),
      ["second"],
      "recursive resume must not duplicate a sibling wait that the original batch had not persisted yet",
    );
    await client.publishEvent(runId, "second.ready", { second: true });
    await waitFor(async () => (await client.getRun(runId))?.status === "completed");
  });

  it("reports an event delivered by a recursive same-run drain", async () => {
    client.register(workflow({
      id: "recursive-drain-outcome",
      steps: [
        waitForEvent("first", { eventName: "gate.ready" }),
        waitForEvent("second", { eventName: "gate.ready" }),
      ],
    }));
    const handle = await client.start("recursive-drain-outcome", {});
    await handle.settled();
    await backend.appendRunEvent(handle.runId, {
      id: "evt-older-buffered",
      eventName: "gate.ready",
      payload: { sequence: 1 },
      publishedAt: new Date(),
    });

    assertEquals(
      await client.publishEvent(handle.runId, "gate.ready", { sequence: 2 }),
      "delivered",
      "a nested drain that consumes this publish must contribute to its outer outcome",
    );
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed");
  });

  it("does not recover a live claim during a recursive same-run drain", async () => {
    const countingBackend = new CountingDeliveryClaimReadsBackend();
    const countingClient = createWorkflowClient({
      backend: countingBackend,
      eventWait: { deliveryClaimRecoveryDelay: 0 },
    });
    try {
      countingClient.register(workflow({
        id: "recursive-drain-live-claim",
        steps: [
          waitForEvent("first", { eventName: "gate.ready" }),
          waitForEvent("second", { eventName: "gate.ready" }),
        ],
      }));
      const handle = await countingClient.start("recursive-drain-live-claim", {});
      await handle.settled();
      await countingBackend.appendRunEvent(handle.runId, {
        id: "evt-older-recursive",
        eventName: "gate.ready",
        payload: { sequence: 1 },
        publishedAt: new Date(),
      });
      countingBackend.deliveryClaimReads = 0;

      assertEquals(
        await countingClient.publishEvent(handle.runId, "gate.ready", { sequence: 2 }),
        "delivered",
      );
      await waitFor(async () =>
        (await countingClient.getRun(handle.runId))?.status === "completed"
      );
      assertEquals(
        countingBackend.deliveryClaimReads,
        2,
        "run control checks the live claim once and only the outer drain scans it for recovery",
      );
    } finally {
      await countingClient.destroy();
    }
  });

  it("waits for an overlapping drain that claims this publisher's envelope", async () => {
    const racingBackend = new CoordinatedOverlappingDrainBackend();
    const racingClient = createWorkflowClient({ backend: racingBackend });
    try {
      racingClient.register(workflow({
        id: "overlapping-drain-outcome",
        steps: [waitForEvent("gate", { eventName: "gate.ready" })],
      }));
      const handle = await racingClient.start("overlapping-drain-outcome", {});
      await handle.settled();
      racingBackend.arm();

      const firstPublish = racingClient.publishEvent(handle.runId, "gate.ready", {
        sequence: 1,
      });
      await racingBackend.firstClaimStarted.promise;
      const secondPublish = racingClient.publishEvent(handle.runId, "gate.ready", {
        sequence: 2,
      });
      await racingBackend.secondClaimStarted.promise;

      racingBackend.releaseFirstClaim.resolve();
      const firstState = await Promise.race([
        firstPublish.then(() => "settled" as const),
        delay(30).then(() => "pending" as const),
      ]);
      racingBackend.releaseSecondClaim.resolve();
      const [firstOutcome, secondOutcome] = await Promise.all([firstPublish, secondPublish]);

      assertEquals(
        firstState,
        "pending",
        "the first publisher must not classify its event while an overlapping drain is active",
      );
      assertEquals(firstOutcome, "delivered");
      assertEquals(secondOutcome, "run-terminal");
    } finally {
      racingBackend.releaseFirstClaim.resolve();
      racingBackend.releaseSecondClaim.resolve();
      await racingClient.destroy();
    }
  });

  it("persists every event wait nested inside a parallel node", async () => {
    client.register(workflow({
      id: "nested-parallel-waits",
      steps: [
        parallel("nested", [
          { ...waitForEvent("first", { eventName: "first.ready" }), dependsOn: [] },
          { ...waitForEvent("second", { eventName: "second.ready" }), dependsOn: [] },
        ]),
      ],
    }));

    const handle = await client.start("nested-parallel-waits", {});
    await handle.settled();
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId),
      ["nested/first", "nested/second"],
    );

    await client.publishEvent(handle.runId, "first.ready", {});
    assertEquals((await client.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId), [
      "nested/second",
    ]);
    await client.publishEvent(handle.runId, "second.ready", {});
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed");
  });

  it("wakes a parked run when the named event is published", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();

    await client.publishEvent(handle.runId, "payment.confirmed", { amount: 42 });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "published event did not resume the parked run" },
    );

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.nodeStates["after"]?.status,
      "completed",
      "the step after the event wait must run once the event arrives",
    );
    assertEquals(
      (run?.context["await-payment"] as { payload?: unknown } | undefined)?.payload,
      { amount: 42 },
      "the event payload must land in the workflow context under the wait node id",
    );
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).length,
      0,
      "a delivered event wait must no longer be pending",
    );
  });

  it("finalizes the mailbox reservation after a successful delivery", async () => {
    const observingBackend = new FinalizationObservingBackend();
    const observingClient = createWorkflowClient({ backend: observingBackend });
    try {
      observingClient.register(eventWorkflow);
      const handle = await observingClient.start("event-workflow", {});
      await handle.settled();

      assertEquals(
        await observingClient.publishEvent(handle.runId, "payment.confirmed", { amount: 42 }),
        "delivered",
      );
      assertEquals(
        observingBackend.finalizedEventIds.length,
        1,
        "successful delivery must finalize the exact claimed event reservation",
      );
    } finally {
      await observingClient.destroy();
    }
  });

  it("leaves the run parked when a differently named event is published", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();

    await client.publishEvent(handle.runId, "payment.failed", {});

    assertEquals(
      (await client.getRun(handle.runId))?.status,
      "waiting",
      "an unrelated event name must not release the wait",
    );
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).length,
      1,
      "the wait must stay pending after an unrelated event",
    );
  });

  it("buffers an event published before the run parks", async () => {
    client.register(workflow({
      id: "early-event-workflow",
      steps: [
        step("before", { tool: createMockTool("before-tool", { ok: true }) }),
        waitForEvent("await-payment", { eventName: "payment.confirmed" }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const runId = "run_early_event";
    await client.publishEvent(runId, "payment.confirmed", { amount: 7 });

    const handle = await client.start("early-event-workflow", {}, { runId });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "an event published before the run parked was dropped instead of buffered" },
    );

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.nodeStates["after"]?.status,
      "completed",
      "a buffered event must release the wait as soon as the node parks",
    );
  });

  it("retries a buffered event whose delivery rolls back after parking", async () => {
    const flaky = new FailFirstDeliveryRunReadBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    const runId = "run_buffered_delivery_retry";
    try {
      flakyClient.register(workflow({
        id: "buffered-delivery-retry",
        steps: [waitForEvent("gate", { eventName: "gate.ready" })],
      }));
      assertEquals(
        await flakyClient.publishEvent(runId, "gate.ready", { ready: true }),
        "buffered",
      );
      const handle = await flakyClient.start("buffered-delivery-retry", {}, { runId });
      await handle.settled();
      assertEquals((await flakyClient.getPendingEventWaits(runId)).length, 1);

      await waitFor(async () => (await flakyClient.getRun(runId))?.status === "completed", {
        timeout: 2_500,
        message: "a rolled-back delivery drained after parking was never retried",
      });
    } finally {
      await flakyClient.destroy();
    }
  });

  it("recovers rolled-back buffered delivery after its parking process exits", async () => {
    const sharedBackend = new FailFirstDeliveryRunReadBackend();
    const parked = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const recovering = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const definition = workflow({
      id: "restart-buffered-delivery-retry",
      steps: [waitForEvent("gate", { eventName: "gate.ready" })],
    });
    parked.register(definition);
    recovering.register(definition);
    const runId = "run_restart_buffered_delivery_retry";
    try {
      assertEquals(await parked.publishEvent(runId, "gate.ready", {}), "buffered");
      const handle = await parked.start(definition.id, {}, { runId });
      await handle.settled();
      assertEquals((await parked.getPendingEventWaits(runId)).length, 1);
      parked.getEventWaitManager().stop();

      await recovering.getEventWaitManager().checkExpiredEventWaits();

      assertEquals((await recovering.getRun(runId))?.status, "completed");
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("fails a run whose declared event timeout elapses", async () => {
    client.register(workflow({
      id: "timeout-event-workflow",
      steps: [
        waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 50 }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await client.start("timeout-event-workflow", {});
    await handle.settled();

    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "failed",
      { message: "the declared waitForEvent timeout was never enforced" },
    );

    const run = await client.getRun(handle.runId);
    assert(
      run?.error?.message.includes("await-payment") === true,
      `the timeout failure must name the node that timed out, got: ${run?.error?.message}`,
    );
    assertEquals(
      run?.nodeStates["after"]?.status ?? "pending",
      "pending",
      "no step after a timed-out wait may run",
    );
  });

  it("completes a delay node once its duration elapses", async () => {
    client.register(workflow({
      id: "delay-workflow",
      steps: [
        step("before", { tool: createMockTool("before-tool", { ok: true }) }),
        delayNode("pause", 50),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await client.start("delay-workflow", {});

    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "delay() never resumed the run" },
    );

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.nodeStates["after"]?.status,
      "completed",
      "the step after delay() must run once the duration elapses",
    );
  });

  it("expires a wait whose process is gone, from another client on the same backend", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({ backend: sharedBackend });
    const recovering = createWorkflowClient({ backend: sharedBackend });
    try {
      parked.register(workflow({
        id: "abandoned-event-workflow",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 50 }),
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
        ],
      }));
      const handle = await parked.start("abandoned-event-workflow", {});
      await handle.settled();

      const [wait] = await parked.getPendingEventWaits(handle.runId);
      assertExists(wait?.expiresAt, "a declared timeout must be persisted as a deadline");
      // The process that parked the wait goes away with its in-process timer.
      parked.getEventWaitManager().stop();
      await waitFor(
        () => Date.now() > wait.expiresAt!.getTime(),
        { message: "the persisted deadline never passed" },
      );

      await recovering.getEventWaitManager().checkExpiredEventWaits();

      assertEquals(
        (await recovering.getRun(handle.runId))?.status,
        "failed",
        "a persisted wait must be enforceable by a process that did not park it",
      );
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("recovers an event claimed by a publisher process that exited before delivery", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({ backend: sharedBackend });
    const recovering = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    const recoveryWorkflow = workflow({
      id: "abandoned-delivery-claim",
      steps: [
        waitForEvent("gate", { eventName: "gate.ready" }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    });
    parked.register(recoveryWorkflow);
    recovering.register(recoveryWorkflow);
    try {
      const handle = await parked.start("abandoned-delivery-claim", {});
      await handle.settled();
      parked.getEventWaitManager().stop();
      const [wait] = await sharedBackend.getPendingEventWaits(handle.runId);
      assertExists(wait);
      await sharedBackend.appendRunEvent(handle.runId, {
        id: "evt-abandoned-claim",
        eventName: "gate.ready",
        payload: { recovered: true },
        publishedAt: new Date(),
      });
      assertExists(
        await sharedBackend.claimRunEventForWait(handle.runId, wait.id, wait.eventName),
      );
      assertEquals((await sharedBackend.listRunEventDeliveryClaims(handle.runId)).length, 1);

      await recovering.getEventWaitManager().checkExpiredEventWaits();

      assertEquals((await recovering.getRun(handle.runId))?.status, "completed");
      assertEquals((await sharedBackend.listRunEventDeliveryClaims(handle.runId)).length, 0);
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("recovers a delay claimed before its node transition committed", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const recovering = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    const definition = workflow({
      id: "abandoned-delay-claim",
      steps: [delayNode("pause", 200)],
    });
    parked.register(definition);
    recovering.register(definition);
    try {
      const handle = await parked.start("abandoned-delay-claim", {});
      await handle.settled();
      const [wait] = await parked.getPendingEventWaits(handle.runId);
      assertExists(wait?.expiresAt);
      parked.getEventWaitManager().stop();
      assertEquals(
        await sharedBackend.resolvePendingEventWait(handle.runId, wait.id, "delivered"),
        true,
      );
      await waitFor(() => Date.now() > wait.expiresAt!.getTime());

      await recovering.getEventWaitManager().checkExpiredEventWaits();

      await waitFor(async () => (await recovering.getRun(handle.runId))?.status === "completed", {
        message: "a replacement manager could not recover the claimed delay",
      });
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("recovers an event timeout claimed before the run failure committed", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0 },
    });
    const recovering = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    const definition = workflow({
      id: "abandoned-timeout-claim",
      steps: [waitForEvent("gate", { eventName: "gate.ready", timeout: 200 })],
    });
    parked.register(definition);
    recovering.register(definition);
    try {
      const handle = await parked.start("abandoned-timeout-claim", {});
      await handle.settled();
      const [wait] = await parked.getPendingEventWaits(handle.runId);
      assertExists(wait?.expiresAt);
      parked.getEventWaitManager().stop();
      assertEquals(
        await sharedBackend.resolvePendingEventWait(handle.runId, wait.id, "expired"),
        true,
      );
      await waitFor(() => Date.now() > wait.expiresAt!.getTime());

      await recovering.getEventWaitManager().checkExpiredEventWaits();

      assertEquals((await recovering.getRun(handle.runId))?.status, "failed");
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("does not recover its own timeout while the run failure is in flight", async () => {
    const sharedBackend = new PausingRunFailureBackend();
    const timedClient = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    timedClient.register(workflow({
      id: "active-timeout-claim",
      steps: [waitForEvent("gate", { eventName: "gate.ready", timeout: 30 })],
    }));
    sharedBackend.pauseFailureUpdate = true;
    try {
      const handle = await timedClient.start("active-timeout-claim", {});
      await handle.settled();
      await sharedBackend.failureUpdateStarted.promise;

      await timedClient.getEventWaitManager().drainPendingEvents(handle.runId);
      sharedBackend.releaseFailureUpdate.resolve();

      await waitFor(async () => (await timedClient.getRun(handle.runId))?.status === "failed");
      assertEquals(sharedBackend.failureUpdates, 1);
      assertEquals(await timedClient.getPendingEventWaits(handle.runId), []);
      assertEquals(await sharedBackend.listTimedEventWaitClaims(handle.runId), []);
    } finally {
      sharedBackend.releaseFailureUpdate.resolve();
      await timedClient.destroy();
    }
  });

  it("keeps a still-parked run waiting when resume finds no decision", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();

    await client.resume(handle.runId);

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.status,
      "waiting",
      "resuming a run still parked on a wait must leave it waiting, not fail it",
    );
    assertEquals(
      run?.error,
      undefined,
      "a still-parked run must not be given a stalled-graph error by a bare resume",
    );
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).length,
      1,
      "a bare resume must not duplicate the pending event wait",
    );
  });

  it("keeps a still-parked approval run waiting and does not duplicate its approval", async () => {
    client.register(workflow({
      id: "parked-approval-workflow",
      steps: [
        waitForApproval("sign-off", { message: "ok?" }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await client.start("parked-approval-workflow", {});
    await handle.settled();

    await client.resume(handle.runId);

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.status,
      "waiting",
      "resuming a run still parked on an approval must leave it waiting",
    );
    assertEquals(
      (await client.getPendingApprovals(handle.runId)).length,
      1,
      "a bare resume must not raise a second approval for the same parked node",
    );
  });

  it("rolls a failed delivery back so a later publish still wakes the run", async () => {
    const flaky = new BlockableRunUpdateBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      flakyClient.register(eventWorkflow);
      const handle = await flakyClient.start("event-workflow", {});
      await handle.settled();

      flaky.blockRunUpdates = true;
      const refused = await flakyClient.publishEvent(handle.runId, "payment.confirmed", {
        amount: 42,
      });
      flaky.blockRunUpdates = false;

      assertEquals(
        refused,
        "delivery-failed",
        "a publish whose delivery failed must say so, not report the event delivered",
      );
      assertEquals(
        (await flakyClient.getPendingEventWaits(handle.runId)).length,
        1,
        "a failed delivery must give the wait back, or nothing can ever wake the run",
      );
      assertEquals(
        (await flakyClient.getRun(handle.runId))?.status,
        "waiting",
        "a failed delivery must leave the run parked, not terminal",
      );

      assertEquals(
        await flakyClient.retryEventDelivery(handle.runId, "payment.confirmed"),
        true,
        "retry must drain the restored envelope without appending a duplicate",
      );
      await waitFor(
        async () => (await flakyClient.getRun(handle.runId))?.status === "completed",
        { message: "a run whose delivery was rolled back could never be woken again" },
      );
      assertEquals(
        (await flakyClient.getRun(handle.runId))?.nodeStates["after"]?.status,
        "completed",
        "the re-publish must wake the run through the restored event",
      );
    } finally {
      await flakyClient.destroy();
    }
  });

  it("does not duplicate a failed event while retrying sequential same-name waits", async () => {
    const flaky = new BlockableRunUpdateBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      flakyClient.register(workflow({
        id: "failed-event-retry-with-sequential-waits",
        steps: [
          waitForEvent("first", { eventName: "gate.ready" }),
          waitForEvent("second", { eventName: "gate.ready" }),
        ],
      }));
      const handle = await flakyClient.start("failed-event-retry-with-sequential-waits", {});
      await handle.settled();

      flaky.blockRunUpdates = true;
      assertEquals(
        await flakyClient.publishEvent(handle.runId, "gate.ready", { sequence: 1 }),
        "delivery-failed",
      );
      flaky.blockRunUpdates = false;

      assertEquals(await flakyClient.retryEventDelivery(handle.runId, "gate.ready"), true);
      assertEquals((await flakyClient.getRun(handle.runId))?.status, "waiting");
      assertEquals(
        (await flakyClient.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId),
        ["second"],
        "one retried envelope must release only the first of two sequential waits",
      );
      assertEquals(await flaky.peekRunEvent(handle.runId, "gate.ready"), null);

      await flakyClient.publishEvent(handle.runId, "gate.ready", { sequence: 2 });
      await waitFor(async () => (await flakyClient.getRun(handle.runId))?.status === "completed");
    } finally {
      await flakyClient.destroy();
    }
  });

  it("retries a transient delivery-finalization failure", async () => {
    const flaky = new FailFirstDeliveryFinalizationBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      flakyClient.register(workflow({
        id: "delivery-finalization-retry",
        steps: [
          waitForEvent("gate", { eventName: "gate.ready" }),
          waitForApproval("approval", { message: "keep the run active" }),
        ],
      }));
      const handle = await flakyClient.start("delivery-finalization-retry", {});
      await handle.settled();

      assertEquals(await flakyClient.publishEvent(handle.runId, "gate.ready", {}), "delivered");
      await waitFor(() => flaky.finalizationAttempts >= 2, {
        timeout: 2_500,
        message: "a transient finalization failure was never retried",
      });
      assertEquals((await flaky.listRunEventDeliveryClaims(handle.runId)).length, 0);
    } finally {
      await flakyClient.destroy();
    }
  });

  it("continues low-frequency delivery finalization when sweeping is disabled", async () => {
    using time = new FakeTime();
    const failing = new AlwaysFailDeliveryFinalizationBackend();
    const failingClient = createWorkflowClient({
      backend: failing,
      eventWait: { expirationCheckInterval: 0 },
    });
    try {
      failingClient.register(workflow({
        id: "bounded-delivery-finalization-retry",
        steps: [
          waitForEvent("gate", { eventName: "gate.ready" }),
          waitForApproval("keep-active", { message: "keep the delivery claim recoverable" }),
        ],
      }));
      const handle = await failingClient.start("bounded-delivery-finalization-retry", {});
      await handle.settled();

      assertEquals(await failingClient.publishEvent(handle.runId, "gate.ready", {}), "delivered");
      for (const retryDelay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000]) {
        await time.tickAsync(retryDelay);
      }

      assertEquals(
        failing.finalizationAttempts,
        8,
        "prompt retries must remain exponentially backed off",
      );

      await time.tickAsync(60_000);
      assertEquals(
        failing.finalizationAttempts,
        9,
        "without a sweep, low-frequency retries must keep reconciling the durable claim",
      );
    } finally {
      await failingClient.destroy();
    }
  });

  it("rolls a failed delivery back through one atomic backend restore", async () => {
    const flaky = new RollbackObservingBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      flakyClient.register(eventWorkflow);
      const handle = await flakyClient.start("event-workflow", {});
      await handle.settled();

      flaky.blockRunUpdates = true;
      const refused = await flakyClient.publishEvent(handle.runId, "payment.confirmed", {
        amount: 7,
      });
      flaky.blockRunUpdates = false;

      assertEquals(refused, "delivery-failed");
      assertEquals(
        flaky.combinedRestores,
        1,
        "the rollback must restore the wait and the event as one backend operation",
      );
      assertEquals(
        flaky.standaloneWaitRestores,
        0,
        "a standalone wait restore during rollback is the crash window in which " +
          "the event is lost forever; the atomic operation must be used instead",
      );
      assertEquals(
        (await flakyClient.getPendingEventWaits(handle.runId)).length,
        1,
        "the atomic rollback must leave the wait pending again",
      );
      assertEquals(
        (await flaky.takeRunEvent(handle.runId, "payment.confirmed"))?.payload,
        { amount: 7 },
        "the atomic rollback must leave the event back in the mailbox",
      );
    } finally {
      await flakyClient.destroy();
    }
  });

  it("rejects a publish when its failed delivery cannot be rolled back", async () => {
    const refusing = new RefusingDeliveryRollbackBackend();
    const refusingClient = createWorkflowClient({ backend: refusing });
    try {
      refusingClient.register(eventWorkflow);
      const handle = await refusingClient.start("event-workflow", {});
      await handle.settled();

      refusing.blockRunUpdates = true;
      await assertRejects(
        () => refusingClient.publishEvent(handle.runId, "payment.confirmed", { amount: 7 }),
        Error,
        "delivery rollback refused",
      );
    } finally {
      await refusingClient.destroy();
    }
  });

  it("arms a timed wait's deadline before its record becomes claimable", async () => {
    const racing = new ClaimDuringPersistBackend();
    const racingClient = createWorkflowClient({
      backend: racing,
      eventWait: { expirationCheckInterval: 3_600_000 },
    });
    try {
      racing.manager = racingClient.getEventWaitManager();
      racingClient.register(workflow({
        id: "claim-during-persist-workflow",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: "1h" }),
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
        ],
      }));

      const handle = await racingClient.start("claim-during-persist-workflow", {});
      await handle.settled();

      assertEquals(
        racing.claimedWaitIds.length,
        1,
        "the concurrent claim must have fired inside the persistence window, " +
          "otherwise this proves nothing",
      );
      // Reaching into the private timer map is deliberate: the leak this
      // guards against is purely an in-process timer closure held until the
      // original deadline, with no other observable surface.
      const timers =
        (racing.manager as unknown as { expiryTimers: Map<string, unknown> }).expiryTimers;
      assertEquals(
        timers.size,
        0,
        "a wait claimed while its record was being persisted must not leave a " +
          "live deadline timer behind: armed after publication, the claimer's " +
          "clear would miss it and the closure would survive until the deadline",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("clears the parking client's long deadline timer after another client resolves the wait", async () => {
    const shared = new MemoryBackend();
    const parked = createWorkflowClient({
      backend: shared,
      eventWait: { expirationCheckInterval: 3_600_000 },
    });
    const resolver = createWorkflowClient({ backend: shared });
    try {
      parked.register(workflow({
        id: "cross-client-timer-workflow",
        steps: [
          waitForEvent("await-payment", {
            eventName: "payment.confirmed",
            timeout: "1h",
          }),
        ],
      }));
      const handle = await parked.start("cross-client-timer-workflow", {});
      await handle.settled();
      const [wait] = await parked.getPendingEventWaits(handle.runId);
      assertExists(wait);
      const parkingTimers = (parked.getEventWaitManager() as unknown as {
        expiryTimers: Map<string, unknown>;
      }).expiryTimers;
      assertEquals(parkingTimers.has(wait.id), true);

      await shared.resolvePendingEventWait(handle.runId, wait.id, "delivered");
      resolver.getEventWaitManager().clearWaitExpiry(wait.id);

      assertEquals(
        parkingTimers.has(wait.id),
        false,
        "a cross-client resolution must not retain the parking manager's timer closure",
      );
    } finally {
      await parked.destroy();
      await resolver.destroy();
    }
  });

  it("keeps a committed event outcome when only the resume nudge fails", async () => {
    const writer = createWorkflowClient({ backend });
    const recovering = createWorkflowClient({
      backend,
      eventWait: { expirationCheckInterval: 0, deliveryClaimRecoveryDelay: 0 },
    });
    try {
      client.register(eventWorkflow);
      recovering.register(eventWorkflow);
      const handle = await client.start("event-workflow", {});
      await handle.settled();

      assertEquals(
        await writer.publishEvent(handle.runId, "payment.confirmed", { amount: 42 }),
        "delivered",
        "a missing workflow registration in the publishing client must not roll back a committed node",
      );
      assertEquals((await client.getPendingEventWaits(handle.runId)).length, 0);
      assertEquals(
        (await client.getRun(handle.runId))?.nodeStates["await-payment"]?.status,
        "completed",
      );
      assertEquals(
        (await backend.listRunEventDeliveryClaims(handle.runId)).length,
        1,
        "the unresumed delivery claim must remain as its durable reconciliation signal",
      );

      await recovering.getEventWaitManager().checkExpiredEventWaits();
      assertEquals((await recovering.getRun(handle.runId))?.status, "completed");
      assertEquals((await backend.listRunEventDeliveryClaims(handle.runId)).length, 0);
      assertEquals(await backend.takeRunEvent(handle.runId, "payment.confirmed"), null);
    } finally {
      await writer.destroy();
      await recovering.destroy();
    }
  });

  it("preserves a delivery claim when the committed-outcome read is uncertain", async () => {
    const uncertain = new RejectCommittedOutcomeReadBackend();
    const runId = "run-uncertain-committed-outcome";
    await uncertain.createRun({
      id: runId,
      workflowId: "uncertain-committed-outcome",
      status: "waiting",
      input: {},
      nodeStates: {
        gate: { nodeId: "gate", status: "running", attempt: 1 },
      },
      currentNodes: ["gate"],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
    });
    await uncertain.savePendingEventWait(runId, {
      id: "evw-uncertain-commit",
      runId,
      nodeId: "gate",
      eventName: "gate.ready",
      waitKind: "event",
      requestedAt: new Date(),
      status: "pending",
    });
    await uncertain.appendRunEvent(runId, {
      id: "evt-uncertain-commit",
      eventName: "gate.ready",
      payload: {},
      publishedAt: new Date(),
    });
    const failingExecutor = {
      resume: () => Promise.reject(new Error("resume unavailable")),
    } as unknown as WorkflowExecutor;
    const manager = new EventWaitManager({
      backend: uncertain,
      executor: failingExecutor,
      expirationCheckInterval: 0,
    });
    try {
      await manager.drainPendingEvents(runId);

      assertEquals((await uncertain.getRun(runId))?.nodeStates.gate?.status, "completed");
      assertEquals((await uncertain.listRunEventDeliveryClaims(runId)).length, 1);
      assertEquals(await uncertain.peekRunEvent(runId, "gate.ready"), null);
    } finally {
      manager.stop();
    }
  });

  it("restores a claimed event when a sibling failure wins the terminal race", async () => {
    const racingBackend = new FailRunAfterEventClaimBackend();
    const racingClient = createWorkflowClient({ backend: racingBackend });
    try {
      racingClient.register(eventWorkflow);
      const handle = await racingClient.start("event-workflow", {});
      await handle.settled();

      assertEquals(
        await racingClient.publishEvent(handle.runId, "payment.confirmed", { amount: 9 }),
        "buffered",
        "mail restored after a sibling failure must remain buffered for retry",
      );
      assertEquals((await racingClient.getPendingEventWaits(handle.runId)).length, 1);
      assertEquals(
        (await racingBackend.takeRunEvent(handle.runId, "payment.confirmed"))?.payload,
        { amount: 9 },
        "a retryable failed run must retain the event claimed just before it failed",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("keeps a run resumable by resume after a delivery failed", async () => {
    const flaky = new BlockableRunUpdateBackend();
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      flakyClient.register(eventWorkflow);
      const handle = await flakyClient.start("event-workflow", {});
      await handle.settled();

      flaky.blockRunUpdates = true;
      await flakyClient.publishEvent(handle.runId, "payment.confirmed", { amount: 42 });
      flaky.blockRunUpdates = false;

      await flakyClient.resume(handle.runId);

      const run = await flakyClient.getRun(handle.runId);
      assertEquals(
        run?.status,
        "waiting",
        "a rolled-back delivery must leave the durable record that keeps resume from " +
          "failing a run that is merely parked",
      );
      assertEquals(run?.error, undefined);
    } finally {
      await flakyClient.destroy();
    }
  });

  it("delivers to the other waits of a run when one wait's delivery fails", async () => {
    const flaky = new FailOneNodeDeliveryBackend("await-payment");
    const flakyClient = createWorkflowClient({ backend: flaky });
    try {
      // Two waits parked on one run at once, written straight to the backend so
      // the drain loop is what is under test and nothing else is.
      const runId = "run_two_parked_waits";
      flakyClient.register(workflow({
        id: "two-wait-workflow",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed" }),
          waitForEvent("await-shipping", { eventName: "shipping.confirmed" }),
        ],
      }));
      await flaky.createRun({
        id: runId,
        workflowId: "two-wait-workflow",
        status: "waiting",
        input: {},
        nodeStates: {
          "await-payment": { nodeId: "await-payment", status: "running", attempt: 1 },
        },
        currentNodes: ["await-payment"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      for (
        const [nodeId, eventName] of [
          ["await-payment", "payment.confirmed"],
          ["await-shipping", "shipping.confirmed"],
        ]
      ) {
        await flaky.savePendingEventWait(runId, {
          id: `evw-${nodeId}`,
          runId,
          nodeId: nodeId!,
          eventName: eventName!,
          waitKind: "event",
          requestedAt: new Date(),
          status: "pending",
        });
      }

      await flakyClient.publishEvent(runId, "shipping.confirmed", { tracking: "abc" });
      const outcome = await flakyClient.publishEvent(runId, "payment.confirmed", {});

      assertEquals(
        outcome,
        "delivery-failed",
        "one wait failed to deliver, and the publish must report that",
      );
      assertEquals(
        (await flakyClient.getPendingEventWaits(runId)).map((wait) => wait.nodeId),
        ["await-payment"],
        "a wait whose delivery threw must not deny every other wait on the run its event",
      );
      assertEquals(
        (await flaky.getRun(runId))?.nodeStates["await-shipping"]?.status,
        "completed",
        "the deliverable wait's node must complete even though a sibling wait threw",
      );
    } finally {
      await flakyClient.destroy();
    }
  });

  it("keeps an event buffered when another actor resolves the wait before its claim", async () => {
    const racing = new ResolveBeforeClaimBackend();
    const racingClient = createWorkflowClient({ backend: racing });
    try {
      racingClient.register(eventWorkflow);
      const handle = await racingClient.start("event-workflow", {});
      await handle.settled();
      const [wait] = await racingClient.getPendingEventWaits(handle.runId);
      assertExists(wait);
      racing.stealWaitId = wait.id;

      const outcome = await racingClient.publishEvent(handle.runId, "payment.confirmed", {
        amount: 3,
      });

      assertEquals(
        outcome,
        "buffered",
        "losing the claim must not report a delivery this process never made",
      );
      const restored = await racing.takeRunEvent(handle.runId, "payment.confirmed");
      assertEquals(
        restored && {
          eventName: restored.eventName,
          payload: restored.payload,
          publishedAt: restored.publishedAt,
        },
        {
          eventName: "payment.confirmed",
          payload: { amount: 3 },
          publishedAt: racing.lastPublishedAt!,
        },
        "an event whose wait was claimed by someone else must stay in the mailbox",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("refuses a publish that would overflow the mailbox rather than drop a buffered event", async () => {
    client.register(eventWorkflow);
    const runId = "run_mailbox_bound";
    await client.publishEvent(runId, "payment.confirmed", { amount: 99 });
    for (let index = 1; index < MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES; index++) {
      await client.publishEvent(runId, "noise", { index });
    }

    await assertRejects(
      () => client.publishEvent(runId, "noise", { index: "overflow" }),
      Error,
      "Run event mailbox full",
    );

    const handle = await client.start("event-workflow", {}, { runId });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      {
        message: "the buffered event was evicted by later unrelated events, so the run " +
          "parked forever on a wait whose event had already been accepted",
      },
    );
    assertEquals(
      (await client.getRun(handle.runId))?.nodeStates["after"]?.status,
      "completed",
    );
  });

  it("discards an event for a terminal run instead of reporting it delivered", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();
    await client.cancel(handle.runId);

    assertEquals(
      await client.publishEvent(handle.runId, "payment.confirmed", { amount: 1 }),
      "run-terminal",
      "a run that can never act on an event must not be told the event was delivered",
    );
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).length,
      0,
      "cancelling a run must resolve its pending event waits, or the terminal run " +
        "reports itself parked forever",
    );
  });

  it("buffers rather than reporting terminal for a run that does not exist yet", async () => {
    assertEquals(
      await client.publishEvent("run_not_started_yet", "payment.confirmed", {}),
      "buffered",
      "publishing to a reserved id before the run starts is the case the mailbox serves",
    );
  });

  it("never releases a delay wait through a published event", async () => {
    client.register(workflow({
      id: "long-delay-workflow",
      steps: [
        delayNode("pause", 3_600_000),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await client.start("long-delay-workflow", {});
    await handle.settled();
    const [wait] = await client.getPendingEventWaits(handle.runId);
    assertExists(wait, "a delay must park a durable wait");
    assertEquals(wait.waitKind, "delay");

    await assertRejects(
      () => client.publishEvent(handle.runId, wait.eventName, { forced: true }),
      Error,
      "eventName",
      "the reserved delay transport name is not a publishable public event",
    );
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).length,
      1,
      "the delay wait must still be pending after its reserved name was published",
    );
    assertEquals(
      (await client.getRun(handle.runId))?.nodeStates["after"]?.status ?? "pending",
      "pending",
      "no step after a delay may run before the delay's duration elapses",
    );
  });

  it("does not spin when a delay's delivery keeps failing", async () => {
    // A delay's deadline is always in the past by the time delivery runs, so a
    // rollback that re-armed it would fire again on the very next tick. Pin the
    // sweep far outside the observation window: any retry counted here came
    // from a re-armed local timer, not from the sweep.
    const backend = new MemoryBackend();
    const spinning = createWorkflowClient({
      backend,
      eventWait: { expirationCheckInterval: 60_000 },
    });
    spinning.register(workflow({
      id: "failing-delay-workflow",
      steps: [
        delayNode("pause", 300),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));

    try {
      const handle = await spinning.start("failing-delay-workflow", {});
      await handle.settled();
      await waitFor(
        async () => (await spinning.getPendingEventWaits(handle.runId)).length === 1,
        { message: "the delay never parked a durable wait" },
      );

      // Break delivery only now, so the run reaches its parked state normally
      // and only the deadline delivery fails.
      let claims = 0;
      const realResolve = backend.resolvePendingEventWait.bind(backend);
      backend.resolvePendingEventWait = (runId, waitId, outcome) => {
        claims++;
        return realResolve(runId, waitId, outcome);
      };
      backend.updateRunIfStatusAndWorker = () => Promise.resolve(false);

      // The 300ms deadline elapses inside this window, so a spinning rollback
      // would accumulate hundreds of attempts here.
      await delay(700);

      assertEquals(
        (await spinning.getPendingEventWaits(handle.runId)).length,
        1,
        "a delay whose delivery failed must be left claimable rather than lost",
      );
      assert(
        claims > 0,
        "the delay deadline must have been reached, otherwise this proves nothing",
      );
      assert(
        claims <= 3,
        "a failed delay delivery must defer its retry to the sweep rather than " +
          `re-arming an elapsed deadline; observed ${claims} delivery attempts`,
      );
    } finally {
      spinning.getEventWaitManager().stop();
      spinning.getApprovalManager().stop();
    }
  });

  it("expires a wait left by a dead process without being asked to look", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({ backend: sharedBackend });
    parked.register(workflow({
      id: "restart-recovery-workflow",
      steps: [
        waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 20 }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await parked.start("restart-recovery-workflow", {});
    await handle.settled();
    // The process that parked the wait dies with its in-process deadline timer.
    parked.getEventWaitManager().stop();

    // A replacement process. It never parks a wait and never publishes an
    // event, so nothing here ever touches the event-wait machinery: only the
    // sweep it starts for itself can reclaim the abandoned wait.
    const recovering = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 10 },
    });
    try {
      await waitFor(
        async () => (await recovering.getRun(handle.runId))?.status === "failed",
        {
          message: "a restarted process never armed its sweep, so a wait parked before " +
            "the restart never reached its declared deadline",
        },
      );
    } finally {
      await parked.destroy();
      await recovering.destroy();
    }
  });

  it("persists a durable record for every wait parked by one concurrent batch", async () => {
    client.register(workflow({
      id: "concurrent-waits-workflow",
      steps: [
        { ...waitForEvent("await-payment", { eventName: "payment.confirmed" }), dependsOn: [] },
        { ...waitForEvent("await-shipping", { eventName: "shipping.confirmed" }), dependsOn: [] },
        dependsOn(
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
          "await-payment",
          "await-shipping",
        ),
      ],
    }));
    const handle = await client.start("concurrent-waits-workflow", {});
    await handle.settled();

    const waits = await client.getPendingEventWaits(handle.runId);
    assertEquals(
      waits.map((wait) => wait.nodeId).sort(),
      ["await-payment", "await-shipping"],
      "both dependency-free waits parked in one batch, and each must persist its own " +
        "record or the second can never be woken",
    );

    await client.publishEvent(handle.runId, "payment.confirmed", { amount: 1 });
    await waitFor(
      async () =>
        (await client.getRun(handle.runId))?.nodeStates["await-payment"]?.status ===
          "completed",
      { message: "the first event never completed its wait" },
    );
    assertEquals(
      (await client.getRun(handle.runId))?.status,
      "waiting",
      "one delivered event must leave the run parked on the remaining wait, not fail it",
    );

    await client.publishEvent(handle.runId, "shipping.confirmed", { tracking: "abc" });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "the second wait's event never completed the run" },
    );
    assertEquals(
      (await client.getRun(handle.runId))?.nodeStates["after"]?.status,
      "completed",
    );
  });

  it("keeps same-named waits in dependency-free loops distinct", async () => {
    client.register(workflow({
      id: "concurrent-loop-waits-workflow",
      steps: [
        {
          ...loop("left", {
            while: (_context, loopContext) => loopContext.isFirstIteration,
            maxIterations: 1,
            steps: [waitForEvent("gate", { eventName: "left.ready" })],
          }),
          dependsOn: [],
        },
        {
          ...loop("right", {
            while: (_context, loopContext) => loopContext.isFirstIteration,
            maxIterations: 1,
            steps: [waitForEvent("gate", { eventName: "right.ready" })],
          }),
          dependsOn: [],
        },
        dependsOn(
          step("after-loops", { tool: createMockTool("after-loops-tool", { done: true }) }),
          "left",
          "right",
        ),
      ],
    }));
    const handle = await client.start("concurrent-loop-waits-workflow", {});
    await handle.settled();

    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId).sort(),
      ["left/gate", "right/gate"],
    );

    assertEquals(await client.publishEvent(handle.runId, "left.ready", {}), "delivered");
    assertEquals((await client.getRun(handle.runId))?.status, "waiting");
    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId),
      ["right/gate"],
      "delivering one loop's child must not complete the sibling loop's same local ID",
    );

    assertEquals(await client.publishEvent(handle.runId, "right.ready", {}), "delivered");
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed");
  });

  it("anchors the declared timeout to when the wait node started", async () => {
    const slowSibling: Tool = {
      id: "slow-sibling-tool",
      type: "function",
      description: "Slow sibling that delays the batch settling",
      inputSchema: defineSchema((v) => v.object({}).passthrough())(),
      execute: async () => {
        await delay(120);
        return { ok: true };
      },
    };
    client.register(workflow({
      id: "deadline-anchor-workflow",
      steps: [
        { ...step("slow-sibling", { tool: slowSibling }), dependsOn: [] },
        {
          ...waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: "10s" }),
          dependsOn: [],
        },
      ],
    }));
    const handle = await client.start("deadline-anchor-workflow", {});
    await handle.settled();

    const run = await client.getRun(handle.runId);
    const startedAt = run?.nodeStates["await-payment"]?.startedAt;
    assertExists(startedAt, "the wait node must record when it started");
    const [wait] = await client.getPendingEventWaits(handle.runId);
    assertExists(wait?.expiresAt);
    assertEquals(
      wait.expiresAt.getTime(),
      new Date(startedAt).getTime() + 10_000,
      "the deadline must be the node's start plus its declared timeout",
    );
    assert(
      wait.expiresAt.getTime() <= wait.requestedAt.getTime() + 10_000 - 100,
      "a slow sibling settling the batch must not stretch the declared timeout",
    );
  });

  it("does not deliver an event published after the declared deadline passed", async () => {
    const sharedBackend = new MemoryBackend();
    const parked = createWorkflowClient({ backend: sharedBackend });
    // A publisher whose sweep is pinned far away, so only the drain-time
    // deadline check between it and a late delivery is under test.
    const publisher = createWorkflowClient({
      backend: sharedBackend,
      eventWait: { expirationCheckInterval: 3_600_000 },
    });
    try {
      parked.register(workflow({
        id: "late-publish-workflow",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 30 }),
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
        ],
      }));
      const handle = await parked.start("late-publish-workflow", {});
      await handle.settled();
      const [wait] = await parked.getPendingEventWaits(handle.runId);
      assertExists(wait?.expiresAt);
      // The process that parked the wait dies before its deadline timer fires.
      parked.getEventWaitManager().stop();
      await waitFor(() => Date.now() > wait.expiresAt!.getTime(), {
        message: "the deadline never passed",
      });

      const outcome = await publisher.publishEvent(handle.runId, "payment.confirmed", {
        amount: 9,
      });

      assert(
        outcome !== "delivered",
        "an event published after the declared deadline must not resolve the wait",
      );
      const run = await publisher.getRun(handle.runId);
      assertEquals(
        run?.status,
        "failed",
        "an overdue wait found at delivery time must be expired, not extended",
      );
      assertEquals(
        run?.nodeStates["after"]?.status ?? "pending",
        "pending",
        "no step behind the expired wait may run off the late event",
      );
    } finally {
      await parked.destroy();
      await publisher.destroy();
    }
  });

  it("delivers buffered mail published before the deadline even when draining is late", async () => {
    client.register(workflow({
      id: "on-time-buffered-event",
      steps: [waitForEvent("gate", { eventName: "gate.ready", timeout: "1h" })],
    }));
    const runId = "run_on_time_buffered_event";
    const deadline = new Date(Date.now() - 10);
    await backend.createRun({
      id: runId,
      workflowId: "on-time-buffered-event",
      status: "waiting",
      input: {},
      nodeStates: {
        gate: { nodeId: "gate", status: "running", attempt: 1, startedAt: new Date(0) },
      },
      currentNodes: ["gate"],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(0),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
    });
    await backend.savePendingEventWait(runId, {
      id: "wait-on-time-buffered-event",
      runId,
      nodeId: "gate",
      eventName: "gate.ready",
      waitKind: "event",
      requestedAt: new Date(0),
      expiresAt: deadline,
      status: "pending",
    });
    await backend.appendRunEvent(runId, {
      id: "evt-on-time-buffered-event",
      eventName: "gate.ready",
      payload: { arrived: "before-deadline" },
      publishedAt: new Date(deadline.getTime() - 1),
    });

    assertEquals(await client.retryEventDelivery(runId, "gate.ready"), true);
    await waitFor(async () => (await client.getRun(runId))?.status === "completed");
  });

  it("claims on-time buffered mail before its deadline timer expires the wait", async () => {
    client.register(workflow({
      id: "timer-honors-on-time-buffered-event",
      steps: [waitForEvent("gate", { eventName: "gate.ready", timeout: 500 })],
    }));
    const handle = await client.start("timer-honors-on-time-buffered-event", {});
    await handle.settled();
    const [wait] = await client.getPendingEventWaits(handle.runId);
    assertExists(wait?.expiresAt);
    assert(
      Date.now() < wait.expiresAt.getTime(),
      "the test envelope must enter the durable mailbox before the deadline",
    );
    await backend.appendRunEvent(handle.runId, {
      id: "evt-before-timer-deadline",
      eventName: "gate.ready",
      payload: { arrived: "on-time" },
      publishedAt: new Date(),
    });

    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed", {
      timeout: 2_000,
      message: "the deadline timer expired a wait whose event was already buffered on time",
    });
  });

  it("marks a timed-out wait node failed so retry can schedule it again", async () => {
    // The timeout has to serve twice: short enough for the first park to fail
    // promptly, long enough for the retried park to still be pending when the
    // event is published right after it re-arms.
    client.register(workflow({
      id: "retryable-timeout-workflow",
      steps: [
        waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 400 }),
        step("after", { tool: createMockTool("after-tool", { done: true }) }),
      ],
    }));
    const handle = await client.start("retryable-timeout-workflow", {});
    await handle.settled();
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "failed",
      { message: "the declared timeout never failed the run" },
    );

    assertEquals(
      (await client.getRun(handle.runId))?.nodeStates["await-payment"]?.status,
      "failed",
      "the wait node itself must be failed: a wait left running is never " +
        "re-scheduled, so a retried run would stall immediately",
    );

    await client.retry(handle.runId);
    await waitFor(
      async () => (await client.getPendingEventWaits(handle.runId)).length === 1,
      { message: "retry never re-parked the timed-out wait" },
    );

    await client.publishEvent(handle.runId, "payment.confirmed", { amount: 2 });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "the retried wait could not be woken by its event" },
    );
  });

  it("does not reactivate a failed run until its timeout claim is finalized", async () => {
    const fenced = new RejectTimedFinalizationBackend();
    const fencedClient = createWorkflowClient({ backend: fenced });
    try {
      fencedClient.register(workflow({
        id: "retry-timeout-finalization-fence",
        steps: [waitForEvent("gate", { eventName: "gate.ready", timeout: 30 })],
      }));
      const handle = await fencedClient.start("retry-timeout-finalization-fence", {});
      await handle.settled();
      await waitFor(async () => (await fencedClient.getRun(handle.runId))?.status === "failed");

      await assertRejects(
        () => fencedClient.retry(handle.runId),
        Error,
        "timed claim finalization unavailable",
      );
      assertEquals((await fencedClient.getRun(handle.runId))?.status, "failed");
    } finally {
      await fencedClient.destroy();
    }
  });

  it("retains buffered mail while a failed run is retried", async () => {
    client.register(workflow({
      id: "retry-retains-buffered-mail",
      steps: [
        waitForEvent("timed", { eventName: "timed.ready", timeout: 400 }),
        waitForEvent("later", { eventName: "later.ready" }),
      ],
    }));
    const handle = await client.start("retry-retains-buffered-mail", {});
    await handle.settled();
    assertEquals(
      await client.publishEvent(handle.runId, "later.ready", { retained: true }),
      "buffered",
    );
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "failed", {
      message: "the first wait never reached its deadline",
    });
    assertExists(
      await backend.peekRunEvent(handle.runId, "later.ready"),
      "a retryable failed run must retain unrelated buffered mail",
    );

    await client.retry(handle.runId);
    await waitFor(
      async () =>
        (await client.getPendingEventWaits(handle.runId)).some((wait) => wait.nodeId === "timed"),
    );
    await client.publishEvent(handle.runId, "timed.ready", {});
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed", {
      message: "the retried workflow did not consume mail buffered before its failure",
    });
  });

  it("retains sibling waits while a failed run remains retryable", async () => {
    client.register(workflow({
      id: "retry-retains-sibling-wait",
      steps: [
        { ...waitForEvent("failed", { eventName: "failed.ready" }), dependsOn: [] },
        { ...waitForEvent("sibling", { eventName: "sibling.ready" }), dependsOn: [] },
      ],
    }));
    const handle = await client.start("retry-retains-sibling-wait", {});
    await handle.settled();
    const waits = await backend.getPendingEventWaits(handle.runId);
    const failedWait = waits.find((wait) => wait.nodeId === "failed");
    assertExists(failedWait);
    await backend.resolvePendingEventWait(handle.runId, failedWait.id, "expired");
    await backend.updateRun(handle.runId, {
      status: "failed",
      error: { message: "retryable sibling failure" },
      nodeStates: {
        failed: {
          nodeId: "failed",
          status: "failed",
          attempt: 1,
          error: "retryable sibling failure",
          completedAt: new Date(),
        },
      },
    });

    await client.getEventWaitManager().checkExpiredEventWaits();

    assertEquals(
      (await client.getPendingEventWaits(handle.runId)).map((wait) => wait.nodeId),
      ["sibling"],
      "terminal cleanup must not cancel live sibling waits on a retryable failed run",
    );

    assertEquals(
      await client.publishEvent(handle.runId, "sibling.ready", { duringFailure: true }),
      "buffered",
      "a failed run must retain mail that its retryable sibling wait can still consume",
    );
    await client.retry(handle.runId);
    await waitFor(
      async () =>
        (await client.getPendingEventWaits(handle.runId)).some((wait) => wait.nodeId === "failed"),
    );
    await client.publishEvent(handle.runId, "failed.ready", {});
    await waitFor(async () => (await client.getRun(handle.runId))?.status === "completed", {
      message: "retry did not consume the sibling event published while the run was failed",
    });
  });

  it("keeps an expired deadline replayable when failing the run does not commit", async () => {
    const flaky = new RefusingRunFailureBackend();
    const flakyClient = createWorkflowClient({
      backend: flaky,
      eventWait: { expirationCheckInterval: 3_600_000 },
    });
    try {
      flakyClient.register(workflow({
        id: "replayable-timeout-workflow",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 30 }),
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
        ],
      }));
      const handle = await flakyClient.start("replayable-timeout-workflow", {});
      await handle.settled();
      const [wait] = await flakyClient.getPendingEventWaits(handle.runId);
      assertExists(wait?.expiresAt);

      flaky.refuseRunFailures = true;
      await waitFor(() => flaky.refusedFailures > 0, {
        message: "the deadline timer never attempted to fail the run",
      });
      await waitFor(
        async () => (await flakyClient.getPendingEventWaits(handle.runId)).length === 1,
        {
          message: "an expired claim whose run failure did not commit must be given " +
            "back, or the run stays parked forever with no live record",
        },
      );
      assertEquals(
        (await flakyClient.getRun(handle.runId))?.status,
        "waiting",
        "the run must still be waiting: the wait is expired but its failure never committed",
      );

      flaky.refuseRunFailures = false;
      await flakyClient.getEventWaitManager().checkExpiredEventWaits();
      assertEquals(
        (await flakyClient.getRun(handle.runId))?.status,
        "failed",
        "the sweep must replay the expired deadline once the run transition can commit",
      );
    } finally {
      await flakyClient.destroy();
    }
  });

  it("re-arms an elapsed deadline when the periodic sweep is disabled", async () => {
    const flaky = new RefusingRunFailureBackend();
    flaky.refuseRunFailures = true;
    const flakyClient = createWorkflowClient({
      backend: flaky,
      eventWait: { expirationCheckInterval: 0 },
    });
    try {
      flakyClient.register(workflow({
        id: "timer-only-timeout-recovery",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 30 }),
        ],
      }));
      const handle = await flakyClient.start("timer-only-timeout-recovery", {});
      await handle.settled();
      await waitFor(() => flaky.refusedFailures > 0, {
        message: "the initial deadline did not attempt the run failure",
      });
      assertEquals((await flakyClient.getPendingEventWaits(handle.runId)).length, 1);

      flaky.refuseRunFailures = false;
      await waitFor(async () => (await flakyClient.getRun(handle.runId))?.status === "failed", {
        timeout: 2_500,
        message: "an elapsed wait restored without a sweep was never re-armed",
      });
    } finally {
      await flakyClient.destroy();
    }
  });

  it("re-arms a deadline timer when claiming the expired wait throws", async () => {
    const flaky = new RejectOnceEventWaitResolutionBackend();
    const flakyClient = createWorkflowClient({
      backend: flaky,
      eventWait: { expirationCheckInterval: 0 },
    });
    try {
      flakyClient.register(workflow({
        id: "timer-resolution-recovery",
        steps: [
          waitForEvent("await-payment", { eventName: "payment.confirmed", timeout: 30 }),
        ],
      }));
      const handle = await flakyClient.start("timer-resolution-recovery", {});
      await handle.settled();
      await waitFor(() => flaky.rejectedResolutions === 1, {
        message: "the deadline timer never attempted to claim the expired wait",
      });

      await waitFor(async () => (await flakyClient.getRun(handle.runId))?.status === "failed", {
        timeout: 2_500,
        message: "a transient wait-resolution error permanently disarmed the deadline",
      });
    } finally {
      await flakyClient.destroy();
    }
  });

  it("reports run-terminal for a run that finished between the check and the append", async () => {
    const racing = new TerminalDuringAppendBackend();
    const racingClient = createWorkflowClient({ backend: racing });
    try {
      racingClient.register(eventWorkflow);
      const handle = await racingClient.start("event-workflow", {});
      await handle.settled();
      racing.cancelBeforeNextAppend = true;

      const outcome = await racingClient.publishEvent(handle.runId, "audit.recorded", {});

      assertEquals(
        outcome,
        "run-terminal",
        "a run that turned terminal mid-publish must report run-terminal, not a " +
          "buffered delivery that can never happen",
      );
      assertEquals(
        await racing.takeRunEvent(handle.runId, "audit.recorded"),
        null,
        "the unconsumable envelope must be reclaimed rather than left buffered forever",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("reports run-terminal when an observed run is deleted before append", async () => {
    const racing = new DeleteDuringAppendBackend();
    const racingClient = createWorkflowClient({ backend: racing });
    try {
      racingClient.register(eventWorkflow);
      const handle = await racingClient.start("event-workflow", {});
      await handle.settled();
      racing.deleteBeforeNextAppend = true;

      assertEquals(
        await racingClient.publishEvent(handle.runId, "audit.recorded", {}),
        "run-terminal",
        "an initially observed run cannot revert to the never-created mailbox case",
      );
      assertEquals(
        await racing.takeRunEvent(handle.runId, "audit.recorded"),
        null,
        "deletion racing the append must not leave an orphan envelope",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("rechecks a failed run after append before deferring delivery", async () => {
    const racing = new ReactivateFailedDuringAppendBackend();
    const racingClient = createWorkflowClient({ backend: racing });
    try {
      racingClient.register(workflow({
        id: "failed-publish-reactivation",
        steps: [waitForEvent("gate", { eventName: "gate.ready" })],
      }));
      const runId = "run-failed-publish-reactivation";
      await racing.createRun({
        id: runId,
        workflowId: "failed-publish-reactivation",
        status: "failed",
        input: {},
        nodeStates: { gate: { nodeId: "gate", status: "running", attempt: 1 } },
        currentNodes: ["gate"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        error: { message: "retryable" },
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await racing.savePendingEventWait(runId, {
        id: "evw-reactivated",
        runId,
        nodeId: "gate",
        eventName: "gate.ready",
        waitKind: "event",
        requestedAt: new Date(),
        status: "pending",
      });
      racing.reactivateOnAppend = true;

      assertEquals(await racingClient.publishEvent(runId, "gate.ready", {}), "delivered");
    } finally {
      await racingClient.destroy();
    }
  });

  it("reclaims only its own terminal envelope when the run is retried concurrently", async () => {
    const racing = new RetryDuringTerminalCleanupBackend();
    const racingClient = createWorkflowClient({ backend: racing });
    try {
      racingClient.register(eventWorkflow);
      const handle = await racingClient.start("event-workflow", {});
      await handle.settled();
      racing.armTerminalReadAfterInitialCheck();

      assertEquals(
        await racingClient.publishEvent(handle.runId, "audit.recorded", { original: true }),
        "run-terminal",
      );
      assertEquals(
        (await racing.takeRunEvent(handle.runId, "audit.recorded"))?.id,
        "evt-retry-publish",
        "terminal cleanup must not discard an envelope accepted after retry reactivated the run",
      );
    } finally {
      await racingClient.destroy();
    }
  });

  it("reconstructs a missing wait record on resume instead of failing the run", async () => {
    client.register(eventWorkflow);
    const handle = await client.start("event-workflow", {});
    await handle.settled();
    const [wait] = await client.getPendingEventWaits(handle.runId);
    assertExists(wait);
    // Simulate the crash window: the record was consumed (or never persisted)
    // while the node is still recorded running and the run is parked.
    await backend.resolvePendingEventWait(handle.runId, wait.id, "delivered");
    assertEquals((await client.getPendingEventWaits(handle.runId)).length, 0);

    await client.resume(handle.runId);

    const run = await client.getRun(handle.runId);
    assertEquals(
      run?.status,
      "waiting",
      "a parked run whose record is missing must be re-parked with a fresh record, " +
        "not destroyed by the only nudge callers have",
    );
    const restored = await client.getPendingEventWaits(handle.runId);
    assertEquals(
      restored.length,
      1,
      "resume must reconstruct the wait from the registered definition",
    );
    assert(restored[0]!.id !== wait.id, "the reconstructed record is a new wait");

    await client.publishEvent(handle.runId, "payment.confirmed", { amount: 5 });
    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      { message: "the reconstructed wait could not be woken by its event" },
    );
  });

  it("reconstructs a later missing wait when an earlier parked sibling is still live", async () => {
    client.register(workflow({
      id: "parked-wait-batch-recovery",
      steps: [
        { ...waitForEvent("first", { eventName: "first.ready" }), dependsOn: [] },
        { ...waitForEvent("second", { eventName: "second.ready" }), dependsOn: [] },
      ],
    }));
    const handle = await client.start("parked-wait-batch-recovery", {});
    await handle.settled();
    const waits = await client.getPendingEventWaits(handle.runId);
    const first = waits.find((wait) => wait.nodeId === "first");
    const second = waits.find((wait) => wait.nodeId === "second");
    assertExists(first);
    assertExists(second);
    await backend.resolvePendingEventWait(handle.runId, second.id, "delivered");

    await client.resume(handle.runId);

    const restored = await client.getPendingEventWaits(handle.runId);
    assertEquals(restored.map((wait) => wait.nodeId).sort(), ["first", "second"]);
    assertEquals(restored.find((wait) => wait.nodeId === "first")?.id, first.id);
    assert(
      restored.find((wait) => wait.nodeId === "second")?.id !== second.id,
      "the later missing member of the stalled batch must be reconstructed",
    );
  });

  it("reconstructs a dynamic event wait from its persisted node input", async () => {
    client.register(workflow({
      id: "dynamic-event-wait-recovery",
      steps: () => [
        waitForEvent("dynamic-wait", {
          eventName: "dynamic.ready",
          timeout: "1h",
        }),
      ],
    }));
    const handle = await client.start("dynamic-event-wait-recovery", {});
    await handle.settled();
    const [wait] = await client.getPendingEventWaits(handle.runId);
    assertExists(wait);
    await backend.resolvePendingEventWait(handle.runId, wait.id, "delivered");

    await client.resume(handle.runId);

    const [restored] = await client.getPendingEventWaits(handle.runId);
    assertExists(restored);
    assertEquals(restored.eventName, "dynamic.ready");
    assertExists(restored.expiresAt, "the persisted timeout must survive dynamic recovery");
  });

  it("preserves dynamic approval policy when reconstructing a missing wait", async () => {
    client.register(workflow({
      id: "dynamic-approval-wait-recovery",
      steps: [
        loop("review-loop", {
          while: (_context, loopContext) => loopContext.isFirstIteration,
          maxIterations: 1,
          steps: () => [
            waitForApproval("review", {
              message: "Review the dynamic change",
              timeout: "1h",
              approvers: ["alice"],
              responseSchema: defineSchema((v) => v.object({ confirmed: v.boolean() }))(),
            }),
          ],
        }),
      ],
    }));
    const handle = await client.start("dynamic-approval-wait-recovery", {});
    await handle.settled();
    const [original] = await backend.getPendingApprovals(handle.runId);
    assertExists(original);
    assertEquals(original.nodeId, "review-loop/review");

    // Simulate a process dying after the node parked but before its durable
    // approval append became observable. The stale record is deliberately not
    // a decision claim, so recovery must recreate it from the DAG descriptor.
    await backend.updatePendingApproval(handle.runId, original.id, {
      status: "rejected",
      reconciliationPending: false,
    });
    await client.resume(handle.runId);

    const [restored] = await backend.getPendingApprovals(handle.runId);
    assertExists(restored);
    assert(restored.id !== original.id);
    assertEquals(restored.nodeId, "review-loop/review");
    assertExists(restored.expiresAt, "the dynamic timeout must survive reconstruction");
    await assertRejects(
      () => client.approve(handle.runId, restored.id, "bob"),
      VeryfrontError,
      "Not authorized to approve this request",
    );
    await assertRejects(() =>
      client.approve(handle.runId, restored.id, "alice", undefined, {
        confirmed: "yes",
      })
    );
    assertEquals((await backend.getPendingApprovals(handle.runId))[0]?.status, "pending");
  });

  it("completes a delay that went through definition capture", async () => {
    const captured = captureWorkflowDefinition(
      workflow({
        id: "captured-delay-workflow",
        steps: [
          delayNode("pause", 50),
          step("after", { tool: createMockTool("after-tool", { done: true }) }),
        ],
      }).definition,
    );
    client.register(captured);
    const handle = await client.start("captured-delay-workflow", {});

    await waitFor(
      async () => (await client.getRun(handle.runId))?.status === "completed",
      {
        message: "a captured delay() was persisted as an event wait, so its deadline " +
          "failed the run instead of completing the node",
      },
    );
    assertEquals(
      (await client.getRun(handle.runId))?.nodeStates["after"]?.status,
      "completed",
    );
  });
});
