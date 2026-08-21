import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createWorkflowClient, WorkflowClient } from "./workflow-client.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { branch } from "../dsl/branch.ts";
import { dependsOn, workflow } from "../dsl/workflow.ts";
import { loop } from "../dsl/loop.ts";
import { step } from "../dsl/step.ts";
import { subWorkflow } from "../dsl/sub-workflow.ts";
import { waitForApproval } from "../dsl/wait.ts";
import type { PendingApproval, WorkflowRun } from "../types.ts";
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

    it("leaves dynamically declared loop approval steps unvalidated", async () => {
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
      const observation = await client.observeRunEvents(run.id);
      assertExists(observation);
      assertEquals(observation.supported, true);
      if (!observation.supported) throw new Error("expected observation support");
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
