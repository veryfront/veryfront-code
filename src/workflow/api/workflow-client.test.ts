import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createWorkflowClient, WorkflowClient } from "./workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { PersistedPendingApproval } from "../backends/types.ts";
import { branch } from "../dsl/branch.ts";
import { dependsOn, workflow } from "../dsl/workflow.ts";
import { loop } from "../dsl/loop.ts";
import { map } from "../dsl/map.ts";
import { parallel } from "../dsl/parallel.ts";
import { step } from "../dsl/step.ts";
import { subWorkflow } from "../dsl/sub-workflow.ts";
import { waitForApproval } from "../dsl/wait.ts";
import {
  getPendingApprovalResponseSchemaId,
  projectPendingApproval,
} from "../runtime/pending-approval-metadata.ts";
import type { PendingApproval, WaitNodeConfig, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

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
        currentNodes: ["review"],
        context: { input: {}, runId, workflowId: loopWorkflow.id },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      await backend.savePendingApproval(runId, {
        id: "apr-static-loop",
        nodeId: "review",
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
