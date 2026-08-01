import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { createWorkflowClient, WorkflowClient } from "./workflow-client.ts";
import type { WorkflowBackendOwnership as ApiBackendOwnership } from "./index.ts";
import type { WorkflowBackendOwnership as PublicBackendOwnership } from "../index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { dependsOn, workflow } from "../dsl/workflow.ts";
import { step } from "../dsl/step.ts";
import { waitForApproval } from "../dsl/wait.ts";
import type { ApprovalDecision, PendingApproval, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { ApprovalDecisionTiming, WorkflowRunUpdate } from "../backends/types.ts";
import { WORKFLOW_RUNTIME_STATE_VERSION } from "../runtime-state.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);
const BORROWED_BACKEND_OWNERSHIP: ApiBackendOwnership & PublicBackendOwnership = "borrowed";

class RejectingApprovalPersistenceBackend extends MemoryBackend {
  unconditionalApprovalSaves = 0;
  ownerFencedApprovalSaves = 0;
  ownerFencedWorkers: string[] = [];

  override savePendingApproval(
    runId: string,
    approval: PendingApproval,
  ): Promise<void> {
    this.unconditionalApprovalSaves++;
    return super.savePendingApproval(runId, approval);
  }

  override savePendingApprovalIfStatusAndWorker(
    _runId: string,
    _expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    _approval: PendingApproval,
  ): Promise<boolean> {
    this.ownerFencedApprovalSaves++;
    this.ownerFencedWorkers.push(expectedWorkerId);
    return Promise.resolve(false);
  }
}

class DestroyOrderBackend extends MemoryBackend {
  statusesAtDestroy: WorkflowRun["status"][] = [];
  workerIdsAtDestroy: Array<string | undefined> = [];
  destroyCalls = 0;

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    const runs = await this.listRuns({});
    this.statusesAtDestroy = runs.map((run) => run.status);
    this.workerIdsAtDestroy = runs.map((run) => run.workerId);
    await super.destroy();
  }
}

class GatedReadDestroyBackend extends MemoryBackend {
  interceptNextRead = false;
  readonly readStarted = Promise.withResolvers<void>();
  readonly releaseRead = Promise.withResolvers<void>();
  destroyCalls = 0;
  destroyedWhileReading = false;
  private readInFlight = false;

  override async getRun(runId: string): Promise<WorkflowRun | null> {
    if (this.interceptNextRead) {
      this.interceptNextRead = false;
      this.readInFlight = true;
      this.readStarted.resolve();
      await this.releaseRead.promise;
      this.readInFlight = false;
    }
    return await super.getRun(runId);
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    this.destroyedWhileReading ||= this.readInFlight;
    await super.destroy();
  }
}

class GatedApprovalDecisionBackend extends MemoryBackend {
  readonly decisionPersisted = Promise.withResolvers<void>();
  readonly releaseDecision = Promise.withResolvers<void>();

  override async updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
    timing: ApprovalDecisionTiming,
  ): Promise<boolean> {
    const updated = await super.updateApproval(runId, approvalId, decision, timing);
    if (updated) {
      this.decisionPersisted.resolve();
      await this.releaseDecision.promise;
    }
    return updated;
  }
}

class HostilePersistedWaitBackend extends MemoryBackend {
  injectNextWaitingInput: unknown;

  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    const nodeState = run?.nodeStates.review;
    if (run?.status === "waiting" && nodeState && this.injectNextWaitingInput !== undefined) {
      nodeState.input = this.injectNextWaitingInput;
      this.injectNextWaitingInput = undefined;
    }
    return run;
  }
}

class RetryableClientShutdownBackend extends DestroyOrderBackend {
  rejectShutdownWrites = false;

  override updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    if (this.rejectShutdownWrites) {
      return Promise.reject(new Error("shutdown run store unavailable"));
    }
    return super.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }

  override updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (this.rejectShutdownWrites) {
      return Promise.reject(new Error("shutdown run store unavailable"));
    }
    return super.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      lockId,
      patch,
      expectedWorkerId,
    );
  }
}

class FailsFirstBackendDestroy extends MemoryBackend {
  destroyCalls = 0;

  override destroy(): Promise<void> {
    this.destroyCalls++;
    if (this.destroyCalls === 1) {
      return Promise.reject(new Error("transient backend close failure"));
    }
    return super.destroy();
  }
}

class GatedInitializeBackend extends MemoryBackend {
  readonly initializeStarted = Promise.withResolvers<void>();
  readonly releaseInitialize = Promise.withResolvers<void>();
  readonly firstExpirationCheck = Promise.withResolvers<void>();
  initializeCalls = 0;
  destroyCalls = 0;
  getRunCalls = 0;
  expirationChecks = 0;
  initialized = false;

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    this.initializeStarted.resolve();
    await this.releaseInitialize.promise;
    this.initialized = true;
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    this.getRunCalls++;
    if (!this.initialized) {
      return Promise.reject(new Error("persistence used before initialization"));
    }
    return super.getRun(runId);
  }

  override listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    this.expirationChecks++;
    this.firstExpirationCheck.resolve();
    if (!this.initialized) {
      return Promise.reject(new Error("expiration checked before initialization"));
    }
    return super.listPendingApprovals(filter);
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    await super.destroy();
  }
}

class FailsFirstInitializeBackend extends MemoryBackend {
  initializeCalls = 0;
  destroyCalls = 0;

  override initialize(): Promise<void> {
    this.initializeCalls++;
    if (this.initializeCalls === 1) {
      return Promise.reject(new Error("transient initialization failure"));
    }
    return Promise.resolve();
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    await super.destroy();
  }
}

class OwnershipTrackingBackend extends MemoryBackend {
  initializeCalls = 0;
  destroyCalls = 0;

  override initialize(): Promise<void> {
    this.initializeCalls++;
    return Promise.resolve();
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    await super.destroy();
  }
}

class DestroyReleasesInitializeBackend extends MemoryBackend {
  readonly initializeStarted = Promise.withResolvers<void>();
  private readonly releaseInitialize = Promise.withResolvers<void>();
  initializeCalls = 0;
  destroyCalls = 0;
  createRunCalls = 0;
  getRunCalls = 0;

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    this.initializeStarted.resolve();
    await this.releaseInitialize.promise;
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    this.getRunCalls++;
    return super.getRun(runId);
  }

  override createRun(run: WorkflowRun): Promise<void> {
    this.createRunCalls++;
    return super.createRun(run);
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    this.releaseInitialize.resolve();
    await super.destroy();
  }
}

class DestroySettlesHostileInitializeBackend extends MemoryBackend {
  readonly initializeStarted = Promise.withResolvers<void>();
  readonly initializationError = new Error("late owned initialization failure");
  readonly events: string[] = [];
  private readonly releaseInitialize = Promise.withResolvers<void>();
  private terminalDestroyFailed = false;
  initializeCalls = 0;
  destroyCalls = 0;
  resourceState: "new" | "initializing" | "open" | "rejected" | "destroyed" = "new";

  constructor(
    private readonly outcome: "success" | "reject",
    readonly terminalDestroyError?: Error,
    readonly provisionalDestroyError?: Error,
  ) {
    super();
  }

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    this.resourceState = "initializing";
    this.events.push("initialize-started");
    this.initializeStarted.resolve();
    await this.releaseInitialize.promise;
    if (this.outcome === "reject") {
      this.resourceState = "rejected";
      this.events.push("initialize-rejected");
      throw this.initializationError;
    }
    this.resourceState = "open";
    this.events.push("initialize-reopened");
  }

  override destroy(): Promise<void> {
    const call = ++this.destroyCalls;
    this.events.push(`destroy-${call}`);
    if (call === 1) {
      this.resourceState = "destroyed";
      this.releaseInitialize.resolve();
      if (this.provisionalDestroyError) {
        return Promise.reject(this.provisionalDestroyError);
      }
      return super.destroy();
    }
    if (call === 2 && this.terminalDestroyError && !this.terminalDestroyFailed) {
      this.terminalDestroyFailed = true;
      return Promise.reject(this.terminalDestroyError);
    }
    this.resourceState = "destroyed";
    return super.destroy();
  }
}

class ExternallySettledInitializeBackend extends MemoryBackend {
  readonly initializeStarted = Promise.withResolvers<void>();
  readonly initializeSettlement = Promise.withResolvers<void>();
  initializeCalls = 0;
  destroyCalls = 0;

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    this.initializeStarted.resolve();
    await this.initializeSettlement.promise;
  }

  override async destroy(): Promise<void> {
    this.destroyCalls++;
    await super.destroy();
  }
}

class RecoverableInitializeBackend extends MemoryBackend {
  initializeCalls = 0;
  ready = false;

  override initialize(): Promise<void> {
    this.initializeCalls++;
    this.ready = true;
    return Promise.resolve();
  }

  invalidate(): void {
    this.ready = false;
  }

  override getRun(runId: string): Promise<WorkflowRun | null> {
    if (!this.ready) return Promise.reject(new Error("backend is not ready"));
    return super.getRun(runId);
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
    version: "1",
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

  describe("composition authority", () => {
    it("keeps execution and approvals on the client backend", async () => {
      const authoritativeBackend = new MemoryBackend();
      const foreignBackend = new MemoryBackend();
      const foreignExecutor = new WorkflowExecutor({ backend: foreignBackend });
      const authoritativeClient = createWorkflowClient({
        backend: authoritativeBackend,
        // Exercise the runtime boundary as an untyped JavaScript caller could.
        // Neither nested collaborator is allowed to replace client authority.
        executor: { backend: foreignBackend },
        approval: {
          backend: foreignBackend,
          executor: foreignExecutor,
          expirationCheckInterval: 0,
        },
      });
      authoritativeClient.register(
        workflow({
          id: "authoritative-client-backend",
          version: "1",
          steps: [waitForApproval("review")],
        }),
      );

      try {
        const handle = await authoritativeClient.start("authoritative-client-backend", {});
        await handle.settled();

        assertEquals((await authoritativeBackend.getRun(handle.runId))?.status, "waiting");
        assertEquals((await authoritativeBackend.getPendingApprovals(handle.runId)).length, 1);
        assertEquals(await foreignBackend.getRun(handle.runId), null);
        assertEquals(await foreignBackend.getPendingApprovals(handle.runId), []);
      } finally {
        await authoritativeClient.destroy();
        await foreignBackend.destroy();
      }
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
      const run = await client.getRun(handle.runId);
      const internalRun = await backend.getRun(handle.runId);

      assertExists(run);
      assertExists(internalRun);
      assertEquals(internalRun._tenant?.token, "internal-runtime-token");
      assertEquals(internalRun.context._tenant?.token, "internal-runtime-token");
      assertEquals(run._tenant, undefined);
      assertEquals((output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.output as Record<string, unknown>)["_tenant"], undefined);
      assertEquals((run.context as Record<string, unknown>)["_tenant"], undefined);
      assertEquals(run.output, { "tenant-step": { result: "ok" } });
    });

    it("projects framework metadata from handles, callbacks, and every client run read", async () => {
      const originalTaskEnvJson = Deno.env.get("VERYFRONT_TASK_ENV_JSON");
      const sensitiveBackend = new MemoryBackend();
      let startCallbackRun: WorkflowRun | undefined;
      let completeCallbackRun: WorkflowRun | undefined;
      let workflowCallbackContext: WorkflowRun["context"] | undefined;
      const sensitiveClient = createWorkflowClient({
        backend: sensitiveBackend,
        executor: {
          onStart: (run) => {
            startCallbackRun = run;
          },
          onComplete: (run) => {
            completeCallbackRun = run;
          },
        },
      });
      const nestedUserOutput = {
        env: { visible: "user-owned" },
        _tenant: { visible: "user-owned" },
      };
      sensitiveClient.register(
        workflow({
          id: "public-run-projection",
          steps: [
            step("safe-step", {
              checkpoint: true,
              tool: createMockTool("safe-tool", nestedUserOutput),
            }),
          ],
          onComplete: (_result, context) => {
            workflowCallbackContext = context;
          },
        }),
      );

      try {
        Deno.env.set(
          "VERYFRONT_TASK_ENV_JSON",
          JSON.stringify({ PROJECT_SECRET: "project-secret" }),
        );
        const handle = await runWithRequestContext(
          {
            projectSlug: "private-project",
            projectId: "project-1",
            token: "tenant-secret",
            productionMode: false,
            branch: "preview-branch",
          },
          () => sensitiveClient.start("public-run-projection", {}),
        );

        await handle.settled();
        const output = await handle.result();
        const rawCheckpoint = await sensitiveBackend.getLatestCheckpoint(handle.runId);
        assertExists(rawCheckpoint);
        const internalRun = await sensitiveBackend.getRun(handle.runId);
        assertExists(internalRun);
        await sensitiveBackend.createRun({
          ...internalRun,
          id: "embedded-checkpoint-public-projection",
          checkpoints: [rawCheckpoint],
          createdAt: new Date(),
        });

        const publicRuns = [
          await handle.status(),
          await sensitiveClient.getRun(handle.runId),
          (await sensitiveClient.listRuns()).find((run) => run.id === handle.runId),
          (await sensitiveClient.getRunsByStatus("completed")).find((run) =>
            run.id === handle.runId
          ),
          (await sensitiveClient.getRunsForWorkflow("public-run-projection")).find((run) =>
            run.id === handle.runId
          ),
        ];
        const expectedOutput = { "safe-step": nestedUserOutput };

        assertEquals(output, expectedOutput);
        for (const publicRun of publicRuns) {
          assertExists(publicRun);
          assertEquals(publicRun._tenant, undefined);
          assertEquals(publicRun.context.env, undefined);
          assertEquals(publicRun.context._tenant, undefined);
          assertEquals(publicRun.output, expectedOutput);
        }

        const publicCheckpointRun = await sensitiveClient.getRun(
          "embedded-checkpoint-public-projection",
        );
        assertExists(publicCheckpointRun);
        assertEquals(publicCheckpointRun.checkpoints[0]?.context.env, undefined);
        assertEquals(publicCheckpointRun.checkpoints[0]?.context._tenant, undefined);
        assertEquals(publicCheckpointRun.checkpoints[0]?.context["safe-step"], nestedUserOutput);

        assertExists(startCallbackRun);
        assertEquals(startCallbackRun._tenant, undefined);
        assertEquals(startCallbackRun.context.env, undefined);
        assertEquals(startCallbackRun.context._tenant, undefined);
        assertExists(completeCallbackRun);
        assertEquals(completeCallbackRun._tenant, undefined);
        assertEquals(completeCallbackRun.context.env, undefined);
        assertEquals(completeCallbackRun.context._tenant, undefined);
        assertExists(workflowCallbackContext);
        assertEquals(workflowCallbackContext.env, undefined);
        assertEquals(workflowCallbackContext._tenant, undefined);
        assertEquals(workflowCallbackContext["safe-step"], nestedUserOutput);

        assertEquals(internalRun._tenant?.token, "tenant-secret");
        assertEquals(internalRun.context.env, { PROJECT_SECRET: "project-secret" });
        assertEquals(internalRun.output, expectedOutput);
        assertEquals(rawCheckpoint.context.env, { PROJECT_SECRET: "project-secret" });
        assertEquals(rawCheckpoint.context._tenant, {
          projectSlug: "private-project",
          token: "tenant-secret",
          projectId: "project-1",
          productionMode: false,
          releaseId: null,
          branch: "preview-branch",
          environmentName: null,
        });
      } finally {
        if (originalTaskEnvJson === undefined) {
          Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
        } else {
          Deno.env.set("VERYFRONT_TASK_ENV_JSON", originalTaskEnvJson);
        }
        await sensitiveClient.destroy();
      }
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
          version: "1",
          steps: [step("tenant-step", { tool: "scoped-tool" })],
        });
        scopedClient.register(tenantWorkflow);

        const run: WorkflowRun = {
          id: "run-scoped-tool",
          workflowId: tenantWorkflow.id,
          version: "1",
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
          _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
          _workflowProjection: { context: {} },
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
        version: "1",
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
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

    it("fails closed on hostile persisted wait state without invoking hooks", async () => {
      const hostileBackend = new HostilePersistedWaitBackend();
      const hostileClient = createWorkflowClient({ backend: hostileBackend });
      const workflowId = "hostile-persisted-wait";
      hostileClient.register(
        workflow({ id: workflowId, version: "1", steps: [waitForApproval("review")] }),
      );
      let hooks = 0;
      hostileBackend.injectNextWaitingInput = new Proxy({}, {
        get() {
          hooks++;
          throw new Error("must not run");
        },
        getOwnPropertyDescriptor() {
          hooks++;
          throw new Error("must not run");
        },
        getPrototypeOf() {
          hooks++;
          throw new Error("must not run");
        },
        ownKeys() {
          hooks++;
          throw new Error("must not run");
        },
      });

      try {
        const handle = await hostileClient.start(workflowId, {});
        await handle.settled();

        const persisted = await hostileBackend.getRun(handle.runId);
        assertEquals(persisted?.status, "failed");
        assertEquals(await hostileBackend.getPendingApprovals(handle.runId), []);
        assertEquals(hooks, 0);
      } finally {
        await hostileClient.destroy();
      }
    });

    it("should approve a pending approval", async () => {
      // Create run directly in waiting state (avoid async execution race)
      const runId = "test-run-approval";
      await createWaitingApprovalRun(runId, "approval-1");

      await client.approve(runId, "approval-1", "admin@test.com", "Looks good!");

      const approval = await backend.getApproval(runId, "approval-1");
      assertEquals(approval?.status, "approved");
      assertEquals(approval?.decidedBy, "admin@test.com");
      assertEquals(approval?.comment, "Looks good!");
    });

    it("persists approval allowlists and expiry before accepting a decision", async () => {
      const restrictedBackend = new MemoryBackend();
      const restrictedClient = createWorkflowClient({
        backend: restrictedBackend,
        approval: { expirationCheckInterval: 0 },
      });
      const workflowId = "restricted-approval-policy-workflow";
      restrictedClient.register(
        workflow({
          id: workflowId,
          version: "1",
          steps: [
            waitForApproval("review", {
              approvers: ["alice@example.com"],
              timeout: 60_000,
            }),
          ],
        }),
      );
      const requestedAfter = Date.now();

      try {
        const handle = await restrictedClient.start(workflowId, {});
        await handle.settled();

        const [approval] = await restrictedClient.getPendingApprovals(handle.runId);
        assertExists(approval);
        assertEquals(approval.approvers, ["alice@example.com"]);
        assertEquals(
          approval.expiresAt !== undefined &&
            approval.expiresAt.getTime() >= requestedAfter + 59_000 &&
            approval.expiresAt.getTime() <= Date.now() + 60_000,
          true,
        );

        await assertRejects(
          () =>
            restrictedClient.approve(
              handle.runId,
              approval.id,
              "mallory@example.com",
            ),
          VeryfrontError,
          "Not authorized",
        );
        assertEquals(
          (await restrictedBackend.getApproval(handle.runId, approval.id))
            ?.status,
          "pending",
        );

        await restrictedClient.approve(
          handle.runId,
          approval.id,
          "alice@example.com",
        );
        assertEquals(
          (await restrictedBackend.getApproval(handle.runId, approval.id))
            ?.status,
          "approved",
        );
      } finally {
        await restrictedClient.destroy();
      }
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
          version: "1",
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
        version: "1",
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
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
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

    it("fails an owner-bound wait when fenced approval persistence is rejected", async () => {
      const rejectingBackend = new RejectingApprovalPersistenceBackend();
      const rejectingClient = createWorkflowClient({ backend: rejectingBackend });
      const workflowId = "approval-persistence-failure-workflow";
      rejectingClient.register(
        workflow({ id: workflowId, version: "1", steps: [waitForApproval("review")] }),
      );
      const run: WorkflowRun = {
        id: "run-approval-persistence-failure",
        workflowId,
        version: "1",
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
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
      };
      await rejectingBackend.createRun(run);

      try {
        await assertRejects(
          () => rejectingClient.resume(run.id, run.workerId),
          Error,
          "ownership changed before approval persistence",
        );

        assertEquals(rejectingBackend.ownerFencedApprovalSaves, 1);
        assertEquals(rejectingBackend.ownerFencedWorkers, [run.workerId]);
        assertEquals(rejectingBackend.unconditionalApprovalSaves, 0);
        const failedRun = await rejectingBackend.getRun(run.id);
        assertEquals(failedRun?.status, "failed");
        assertEquals(
          failedRun?.error?.message,
          "Workflow execution ownership changed before approval persistence",
        );
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

      const approval = await backend.getApproval(runId, "approval-2");
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

    it("rejects status when the durable run no longer exists", async () => {
      const handle = await client.start("test-workflow", {});
      await backend.deleteRun(handle.runId);

      await assertRejects(
        () => handle.status(),
        VeryfrontError,
        `Run not found: ${handle.runId}`,
      );
    });
  });

  describe("initialize()", () => {
    it("captures start input and options before readiness can yield", async () => {
      const initializationBackend = new GatedInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      initializationClient.register(
        workflow({
          id: "captured-readiness-start",
          steps: [step("complete", { tool: createMockTool("captured-input-tool", "done") })],
        }),
      );
      const input = { nested: { value: "admitted" } };
      const options = { runId: "admitted-run-id" };
      const startPromise = initializationClient.start(
        "captured-readiness-start",
        input,
        options,
      );

      try {
        await initializationBackend.initializeStarted.promise;
        input.nested.value = "mutated";
        options.runId = "mutated-run-id";
        initializationBackend.releaseInitialize.resolve();

        const handle = await startPromise;
        await handle.settled();
        const persisted = await initializationBackend.getRun("admitted-run-id");
        assertExists(persisted);
        assertEquals(persisted.input, { nested: { value: "admitted" } });
        assertEquals(persisted.context.input, { nested: { value: "admitted" } });
        assertEquals(await initializationBackend.getRun("mutated-run-id"), null);
      } finally {
        initializationBackend.releaseInitialize.resolve();
        await Promise.allSettled([startPromise, initializationClient.destroy()]);
      }
    });

    it("rejects hostile start inputs and options without invoking hooks", async () => {
      const initializationClient = createWorkflowClient({ backend: new MemoryBackend() });
      initializationClient.register(
        workflow({
          id: "hostile-start-admission",
          steps: [step("complete", { tool: createMockTool("hostile-start-tool", "done") })],
        }),
      );
      let hooks = 0;
      const hostile = new Proxy({}, {
        get() {
          hooks++;
          throw new Error("must not run");
        },
        getOwnPropertyDescriptor() {
          hooks++;
          throw new Error("must not run");
        },
        getPrototypeOf() {
          hooks++;
          throw new Error("must not run");
        },
        ownKeys() {
          hooks++;
          throw new Error("must not run");
        },
      });

      try {
        await assertRejects(
          () => initializationClient.start("hostile-start-admission", hostile),
          Error,
          "non-Proxy structured-cloneable data",
        );
        await assertRejects(
          () =>
            initializationClient.start(
              "hostile-start-admission",
              {},
              hostile as { runId?: string },
            ),
          Error,
          "options must be a plain record",
        );
        assertEquals(hooks, 0);
        assertEquals(await initializationClient.getBackend().listRuns({}), []);
      } finally {
        await initializationClient.destroy();
      }
    });

    it("shares one attempt and gates persistence without initializing sync APIs", async () => {
      const initializationBackend = new GatedInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      initializationClient.register(
        workflow({
          id: "initialization-gating",
          steps: [step("complete", { tool: createMockTool("initialization-tool", "done") })],
        }),
      );

      assertEquals(initializationClient.getBackend(), initializationBackend);
      assertExists(initializationClient.getExecutor());
      assertExists(initializationClient.getApprovalManager());
      assertEquals(initializationBackend.initializeCalls, 0);

      const firstInitialize = initializationClient.initialize();
      const secondInitialize = initializationClient.initialize();
      const read = initializationClient.getRun("missing-run");

      try {
        assertEquals(secondInitialize, firstInitialize);
        await initializationBackend.initializeStarted.promise;
        assertEquals(initializationBackend.initializeCalls, 1);
        assertEquals(initializationBackend.getRunCalls, 0);

        initializationBackend.releaseInitialize.resolve();
        await Promise.all([firstInitialize, read]);
        assertEquals(initializationBackend.getRunCalls, 1);
        const laterInitialize = initializationClient.initialize();
        assertEquals(laterInitialize === firstInitialize, false);
        await laterInitialize;
        assertEquals(initializationBackend.initializeCalls, 2);
      } finally {
        initializationBackend.releaseInitialize.resolve();
        await Promise.allSettled([
          firstInitialize,
          read,
          initializationClient.destroy(),
        ]);
      }
    });

    it("retains initialization failure until an explicit retry succeeds", async () => {
      const initializationBackend = new FailsFirstInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      const firstInitialize = initializationClient.initialize();

      try {
        assertEquals(initializationClient.initialize(), firstInitialize);
        const firstError = await assertRejects(
          () => firstInitialize,
          Error,
          "transient initialization failure",
        );
        const replayedError = await assertRejects(
          () => initializationClient.getRun("missing-run"),
          Error,
          "transient initialization failure",
        );
        assertStrictEquals(replayedError, firstError);
        assertEquals(initializationBackend.initializeCalls, 1);

        const retryInitialize = initializationClient.initialize();
        assertEquals(retryInitialize === firstInitialize, false);
        await retryInitialize;
        assertEquals(initializationBackend.initializeCalls, 2);

        await initializationClient.getRun("missing-run");
        assertEquals(initializationBackend.initializeCalls, 2);
        const laterInitialize = initializationClient.initialize();
        assertEquals(laterInitialize === retryInitialize, false);
        await laterInitialize;
        assertEquals(initializationBackend.initializeCalls, 3);
      } finally {
        await Promise.allSettled([initializationClient.destroy()]);
      }
    });

    it("releases a reserved start when readiness fails before consumption", async () => {
      const initializationBackend = new FailsFirstInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      initializationClient.register(
        workflow({
          id: "failed-readiness-reservation",
          steps: [step("complete", { tool: createMockTool("failed-ready-tool", "done") })],
        }),
      );
      const startPromise = initializationClient.start("failed-readiness-reservation", {});
      let watchdogId: ReturnType<typeof setTimeout> | undefined;

      try {
        await assertRejects(
          () => startPromise,
          Error,
          "transient initialization failure",
        );
        assertEquals(await initializationBackend.listRuns({}), []);

        const outcome = await Promise.race([
          initializationClient.destroy().then(() => "destroyed" as const),
          new Promise<"timed-out">((resolve) => {
            watchdogId = setTimeout(() => resolve("timed-out"), 200);
          }),
        ]);
        assertEquals(outcome, "destroyed");
      } finally {
        if (watchdogId !== undefined) clearTimeout(watchdogId);
        await Promise.allSettled([startPromise, initializationClient.destroy()]);
      }
    });

    it("observes in-flight initialization before terminal owned-backend teardown", async () => {
      const initializationBackend = new GatedInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      const initializePromise = initializationClient.initialize();
      await initializationBackend.initializeStarted.promise;
      let destroySettled = false;
      const destroyPromise = initializationClient.destroy().finally(() => {
        destroySettled = true;
      });

      try {
        await Promise.resolve();
        assertEquals(destroySettled, false);
        assertEquals(initializationBackend.destroyCalls, 0);

        await assertRejects(
          () => initializePromise,
          Error,
          "Workflow client is closing",
        );
        initializationBackend.releaseInitialize.resolve();
        await destroyPromise;
        assertEquals(initializationBackend.destroyCalls, 2);
        assertThrows(
          () => initializationClient.initialize(),
          Error,
          "workflow client is closed",
        );
      } finally {
        initializationBackend.releaseInitialize.resolve();
        await Promise.allSettled([initializePromise, destroyPromise]);
      }
    });

    it("lets owned backend teardown cancel an otherwise blocked initializer", async () => {
      const initializationBackend = new DestroyReleasesInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      const readPromise = initializationClient.getRun("missing-run");
      await initializationBackend.initializeStarted.promise;
      const destroyPromise = initializationClient.destroy();
      let watchdogId: ReturnType<typeof setTimeout> | undefined;

      try {
        await assertRejects(
          () => readPromise,
          Error,
          "Workflow client is closing",
        );
        const outcome = await Promise.race([
          destroyPromise.then(() => "destroyed" as const),
          new Promise<"timed-out">((resolve) => {
            watchdogId = setTimeout(() => resolve("timed-out"), 200);
          }),
        ]);

        assertEquals(outcome, "destroyed");
        assertEquals(initializationBackend.destroyCalls, 2);
        assertEquals(initializationBackend.getRunCalls, 0);
      } finally {
        if (watchdogId !== undefined) clearTimeout(watchdogId);
        await Promise.allSettled([readPromise, destroyPromise]);
      }
    });

    it("re-destroys an owned backend after late initialization reopens resources", async () => {
      const initializationBackend = new DestroySettlesHostileInitializeBackend("success");
      const initializationClient = createWorkflowClient({ backend: initializationBackend });
      const initializePromise = initializationClient.initialize();
      const initializeRejection = assertRejects(
        () => initializePromise,
        Error,
        "Workflow client is closing",
      );
      await initializationBackend.initializeStarted.promise;
      const destroyPromise = initializationClient.destroy();

      await Promise.all([initializeRejection, destroyPromise]);
      assertEquals(initializationBackend.events, [
        "initialize-started",
        "destroy-1",
        "initialize-reopened",
        "destroy-2",
      ]);
      assertEquals(initializationBackend.destroyCalls, 2);
      assertEquals(initializationBackend.resourceState, "destroyed");
      assertStrictEquals(initializationClient.destroy(), destroyPromise);
      assertEquals(initializationBackend.destroyCalls, 2);
    });

    it("observes a late owned initialization rejection before terminal teardown", async () => {
      const initializationBackend = new DestroySettlesHostileInitializeBackend("reject");
      const initializationClient = createWorkflowClient({ backend: initializationBackend });
      const initializePromise = initializationClient.initialize();
      const initializeRejection = assertRejects(
        () => initializePromise,
        Error,
        "Workflow client is closing",
      );
      await initializationBackend.initializeStarted.promise;
      const destroyPromise = initializationClient.destroy();

      await Promise.all([initializeRejection, destroyPromise]);
      assertEquals(initializationBackend.events, [
        "initialize-started",
        "destroy-1",
        "initialize-rejected",
        "destroy-2",
      ]);
      assertEquals(initializationBackend.destroyCalls, 2);
      assertEquals(initializationBackend.resourceState, "destroyed");
    });

    it("preserves terminal cleanup errors and retries without another provisional destroy", async () => {
      const terminalDestroyError = new Error("terminal owned backend cleanup failed");
      const initializationBackend = new DestroySettlesHostileInitializeBackend(
        "success",
        terminalDestroyError,
      );
      const initializationClient = createWorkflowClient({ backend: initializationBackend });
      const initializePromise = initializationClient.initialize();
      const initializeRejection = assertRejects(
        () => initializePromise,
        Error,
        "Workflow client is closing",
      );
      await initializationBackend.initializeStarted.promise;
      const firstDestroy = initializationClient.destroy();

      try {
        assertStrictEquals(initializationClient.destroy(), firstDestroy);
        const failure = await assertRejects(
          () => firstDestroy,
          AggregateError,
          "Failed to destroy workflow client cleanly",
        );
        await initializeRejection;
        assertStrictEquals((failure as AggregateError).errors[0], terminalDestroyError);
        assertEquals(initializationBackend.destroyCalls, 2);
        assertEquals(initializationBackend.resourceState, "open");

        const retryDestroy = initializationClient.destroy();
        assertEquals(retryDestroy === firstDestroy, false);
        assertStrictEquals(initializationClient.destroy(), retryDestroy);
        await retryDestroy;
        assertEquals(initializationBackend.destroyCalls, 3);
        assertEquals(initializationBackend.resourceState, "destroyed");
        assertEquals(initializationBackend.events, [
          "initialize-started",
          "destroy-1",
          "initialize-reopened",
          "destroy-2",
          "destroy-3",
        ]);
      } finally {
        await Promise.allSettled([initializePromise, initializationClient.destroy()]);
      }
    });

    it("attempts terminal cleanup and reports both errors after provisional destroy fails", async () => {
      const provisionalDestroyError = new Error("provisional owned backend cleanup failed");
      const terminalDestroyError = new Error("terminal owned backend cleanup also failed");
      const initializationBackend = new DestroySettlesHostileInitializeBackend(
        "success",
        terminalDestroyError,
        provisionalDestroyError,
      );
      const initializationClient = createWorkflowClient({ backend: initializationBackend });
      const initializePromise = initializationClient.initialize();
      const initializeRejection = assertRejects(
        () => initializePromise,
        Error,
        "Workflow client is closing",
      );
      await initializationBackend.initializeStarted.promise;
      const firstDestroy = initializationClient.destroy();

      try {
        const failure = await assertRejects(
          () => firstDestroy,
          AggregateError,
          "Failed to destroy workflow client cleanly",
        );
        await initializeRejection;
        assertEquals((failure as AggregateError).errors.length, 2);
        assertStrictEquals((failure as AggregateError).errors[0], provisionalDestroyError);
        assertStrictEquals((failure as AggregateError).errors[1], terminalDestroyError);
        assertEquals(initializationBackend.events, [
          "initialize-started",
          "destroy-1",
          "initialize-reopened",
          "destroy-2",
        ]);
        assertEquals(initializationBackend.destroyCalls, 2);
        assertEquals(initializationBackend.resourceState, "open");

        const retryDestroy = initializationClient.destroy();
        assertEquals(retryDestroy === firstDestroy, false);
        await retryDestroy;
        assertEquals(initializationBackend.destroyCalls, 3);
        assertEquals(initializationBackend.resourceState, "destroyed");
      } finally {
        await Promise.allSettled([initializePromise, initializationClient.destroy()]);
      }
    });

    it("releases pending start, resume, and cancel admissions when close wins readiness", async () => {
      const initializationBackend = new DestroyReleasesInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });
      initializationClient.register(
        workflow({
          id: "pending-initialize-start",
          steps: [step("complete", { tool: createMockTool("pending-init-tool", "done") })],
        }),
      );

      const startPromise = initializationClient.start("pending-initialize-start", {});
      const resumePromise = initializationClient.resume("pending-resume-run");
      const cancelPromise = initializationClient.cancel("pending-cancel-run");
      const destroyPromise = initializationClient.destroy();
      try {
        await Promise.all([
          assertRejects(
            () => startPromise,
            Error,
            "Workflow client is closing",
          ),
          assertRejects(
            () => resumePromise,
            Error,
            "Workflow client is closing",
          ),
          assertRejects(
            () => cancelPromise,
            Error,
            "Workflow client is closing",
          ),
        ]);
        await destroyPromise;

        assertEquals(initializationBackend.initializeCalls, 1);
        assertEquals(initializationBackend.destroyCalls, 2);
        assertEquals(initializationBackend.createRunCalls, 0);
        assertEquals(initializationBackend.getRunCalls, 0);
      } finally {
        await Promise.allSettled([
          startPromise,
          resumePromise,
          cancelPromise,
          destroyPromise,
        ]);
      }
    });

    it("closes over a borrowed initializer without destroying or leaking its rejection", async () => {
      const initializationBackend = new ExternallySettledInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
        backendOwnership: "borrowed",
      });
      const initializePromise = initializationClient.initialize();
      await initializationBackend.initializeStarted.promise;

      await Promise.all([
        assertRejects(
          () => initializePromise,
          Error,
          "Workflow client is closing",
        ),
        initializationClient.destroy(),
      ]);
      assertEquals(initializationBackend.destroyCalls, 0);

      initializationBackend.initializeSettlement.reject(
        new Error("late borrowed initialization failure"),
      );
      await Promise.resolve();
      await initializationBackend.destroy();
    });

    it("revalidates backend readiness after an earlier successful attempt", async () => {
      const initializationBackend = new RecoverableInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
      });

      try {
        await initializationClient.initialize();
        assertEquals(initializationBackend.initializeCalls, 1);

        initializationBackend.invalidate();
        await assertRejects(
          () => initializationClient.getRun("missing-run"),
          Error,
          "backend is not ready",
        );
        assertEquals(initializationBackend.initializeCalls, 1);
        assertEquals(initializationBackend.ready, false);

        await initializationClient.initialize();
        assertEquals(initializationBackend.initializeCalls, 2);
        assertEquals(initializationBackend.ready, true);
        assertEquals(await initializationClient.getRun("missing-run"), null);
        assertEquals(initializationBackend.initializeCalls, 2);

        await initializationClient.initialize();
        assertEquals(initializationBackend.initializeCalls, 3);
      } finally {
        await initializationClient.destroy();
      }
    });

    it("starts approval expiration checks only after backend readiness", async () => {
      const initializationBackend = new GatedInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
        approval: { expirationCheckInterval: 1 },
      });
      const initializePromise = initializationClient.initialize();

      try {
        await initializationBackend.initializeStarted.promise;
        await new Promise((resolve) => setTimeout(resolve, 10));
        assertEquals(initializationBackend.expirationChecks, 0);

        initializationBackend.releaseInitialize.resolve();
        await initializePromise;
        await initializationBackend.firstExpirationCheck.promise;
        assertEquals(initializationBackend.expirationChecks > 0, true);
      } finally {
        initializationBackend.releaseInitialize.resolve();
        await Promise.allSettled([initializePromise, initializationClient.destroy()]);
      }
    });

    it("does not start approval expiration checks when close wins readiness", async () => {
      const initializationBackend = new GatedInitializeBackend();
      const initializationClient = createWorkflowClient({
        backend: initializationBackend,
        approval: { expirationCheckInterval: 1 },
      });
      const initializePromise = initializationClient.initialize();
      await initializationBackend.initializeStarted.promise;
      const destroyPromise = initializationClient.destroy();

      try {
        await assertRejects(
          () => initializePromise,
          Error,
          "Workflow client is closing",
        );
        initializationBackend.releaseInitialize.resolve();
        await destroyPromise;
        await new Promise((resolve) => setTimeout(resolve, 10));
        assertEquals(initializationBackend.expirationChecks, 0);
      } finally {
        initializationBackend.releaseInitialize.resolve();
        await Promise.allSettled([initializePromise, destroyPromise]);
      }
    });

    it("destroys owned backends but leaves borrowed backends open", async () => {
      const ownedBackend = new OwnershipTrackingBackend();
      const ownedClient = createWorkflowClient({ backend: ownedBackend });
      await ownedClient.initialize();
      await ownedClient.destroy();
      assertEquals(ownedBackend.initializeCalls, 1);
      assertEquals(ownedBackend.destroyCalls, 1);

      const borrowedBackend = new OwnershipTrackingBackend();
      const borrowedClient = createWorkflowClient({
        backend: borrowedBackend,
        backendOwnership: BORROWED_BACKEND_OWNERSHIP,
      });
      const borrowedApprovalManager = borrowedClient.getApprovalManager();
      await borrowedClient.initialize();
      await borrowedClient.destroy();

      assertEquals(borrowedBackend.initializeCalls, 1);
      assertEquals(borrowedBackend.destroyCalls, 0);
      await assertRejects(
        () => borrowedApprovalManager.approve("run", "approval", "reviewer"),
        Error,
        "Approval manager is stopped",
      );
      await borrowedBackend.createRun({
        id: "borrowed-backend-still-open",
        workflowId: "external-workflow",
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      });
      assertExists(await borrowedBackend.getRun("borrowed-backend-still-open"));
      await borrowedBackend.destroy();
    });

    it("rejects invalid ownership and borrowed implicit backends", () => {
      assertThrows(
        () =>
          createWorkflowClient({
            backendOwnership: "shared" as never,
          }),
        VeryfrontError,
        'backendOwnership must be either "owned" or "borrowed"',
      );
      assertThrows(
        () => createWorkflowClient({ backendOwnership: "borrowed" }),
        VeryfrontError,
        "borrowed backendOwnership requires an explicit backend",
      );
    });
  });

  describe("destroy()", () => {
    it("stops leaked approval-manager references at the close boundary", async () => {
      const lifecycleClient = createWorkflowClient({ backend: new MemoryBackend() });
      const leakedApprovalManager = lifecycleClient.getApprovalManager();
      const destroyPromise = lifecycleClient.destroy();

      await assertRejects(
        () => leakedApprovalManager.approve("missing-run", "missing-approval", "reviewer"),
        Error,
        "Approval manager is stopped",
      );
      await destroyPromise;
    });

    it("closes leaked executor and handle admission in the destroy call stack", async () => {
      const lifecycleClient = createWorkflowClient({ backend: new MemoryBackend() });
      const definition = workflow({
        id: "client-leaked-executor-close",
        steps: [step("complete", { tool: createMockTool("leaked-close-tool", "done") })],
      });
      lifecycleClient.register(definition);
      await lifecycleClient.initialize();
      const handle = await lifecycleClient.start("client-leaked-executor-close", {});
      await handle.settled();
      const leakedExecutor = lifecycleClient.getExecutor();
      const destroyPromise = lifecycleClient.destroy();

      assertThrows(
        () => leakedExecutor.start("client-leaked-executor-close", {}),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => leakedExecutor.resume(handle.runId),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => leakedExecutor.cancel(handle.runId),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => leakedExecutor.register(definition.definition),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => handle.status(),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => handle.result(),
        Error,
        "workflow executor is closing",
      );
      assertThrows(
        () => handle.cancel(),
        Error,
        "workflow executor is closing",
      );

      await destroyPromise;
    });

    it("is single-flight and quiesces active runs before destroying its backend", async () => {
      const lifecycleBackend = new DestroyOrderBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        executor: { cancellationGracePeriod: 20 },
      });
      const started = Promise.withResolvers<void>();
      let observedAbort = false;
      const blockingTool: Tool = {
        id: "client-destroy-blocker",
        type: "function",
        description: "Wait for workflow client teardown",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: (_input, context) => {
          started.resolve();
          return new Promise((_resolve, reject) => {
            context?.abortSignal?.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(context.abortSignal?.reason);
              },
              { once: true },
            );
          });
        },
      };
      lifecycleClient.register(
        workflow({
          id: "client-destroy-lifecycle",
          steps: [step("block", { tool: blockingTool })],
        }),
      );

      const handle = await lifecycleClient.start("client-destroy-lifecycle", {});
      await started.promise;
      const firstDestroy = lifecycleClient.destroy();
      assertEquals(lifecycleClient.destroy(), firstDestroy);
      await firstDestroy;
      await handle.settled();

      assertEquals(observedAbort, true);
      assertEquals(lifecycleBackend.statusesAtDestroy, ["cancelled"]);
      assertEquals(lifecycleBackend.destroyCalls, 1);
      assertThrows(
        () => lifecycleClient.getBackend(),
        Error,
        "workflow client is closed",
      );
      assertThrows(
        () => lifecycleClient.start("client-destroy-lifecycle", {}),
        Error,
        "workflow client is closed",
      );
    });

    it("drains an admitted handle status read before backend teardown", async () => {
      const lifecycleBackend = new GatedReadDestroyBackend();
      const lifecycleClient = createWorkflowClient({ backend: lifecycleBackend });
      lifecycleClient.register(
        workflow({
          id: "client-handle-status-lifecycle",
          steps: [step("complete", { tool: createMockTool("status-tool", "done") })],
        }),
      );
      let destroyPromise: Promise<void> | undefined;

      try {
        const handle = await lifecycleClient.start("client-handle-status-lifecycle", {});
        await handle.settled();
        lifecycleBackend.interceptNextRead = true;
        const statusPromise = handle.status();
        await lifecycleBackend.readStarted.promise;

        destroyPromise = lifecycleClient.destroy();
        await Promise.resolve();
        assertEquals(lifecycleBackend.destroyCalls, 0);

        lifecycleBackend.releaseRead.resolve();
        assertEquals((await statusPromise).id, handle.runId);
        await destroyPromise;

        assertEquals(lifecycleBackend.destroyCalls, 1);
        assertEquals(lifecycleBackend.destroyedWhileReading, false);
        assertThrows(
          () => handle.status(),
          Error,
          "workflow executor is closed",
        );
        assertThrows(
          () => handle.result(),
          Error,
          "workflow executor is closed",
        );
      } finally {
        lifecycleBackend.releaseRead.resolve();
        await Promise.allSettled([destroyPromise ?? lifecycleClient.destroy()]);
      }
    });

    it("actively aborts an admitted result waiter before backend teardown", async () => {
      const lifecycleBackend = new DestroyOrderBackend();
      const lifecycleClient = createWorkflowClient({ backend: lifecycleBackend });
      lifecycleClient.register(
        workflow({
          id: "client-result-waiter-lifecycle",
          version: "1",
          steps: [waitForApproval("review")],
        }),
      );
      let destroyPromise: Promise<void> | undefined;

      try {
        const handle = await lifecycleClient.start("client-result-waiter-lifecycle", {});
        await handle.settled();
        const resultPromise = handle.result();
        const resultRejection = assertRejects(
          () => resultPromise,
          Error,
          "Workflow executor is closing",
        );

        destroyPromise = lifecycleClient.destroy();
        await Promise.all([resultRejection, destroyPromise]);

        assertEquals(lifecycleBackend.destroyCalls, 1);
        assertThrows(
          () => handle.result(),
          Error,
          "workflow executor is closed",
        );
      } finally {
        await Promise.allSettled([destroyPromise ?? lifecycleClient.destroy()]);
      }
    });

    it("cancels a blocking resumed run before draining the resume operation", async () => {
      const lifecycleBackend = new DestroyOrderBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        executor: { cancellationGracePeriod: 20 },
      });
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<unknown>();
      let observedAbort = false;
      const blockingTool: Tool = {
        id: "client-resume-destroy-blocker",
        type: "function",
        description: "Wait for resumed workflow teardown",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: (_input, context) => {
          started.resolve();
          return new Promise((resolve, reject) => {
            const abort = () => {
              observedAbort = true;
              reject(context?.abortSignal?.reason);
            };
            if (context?.abortSignal?.aborted) abort();
            else context?.abortSignal?.addEventListener("abort", abort, { once: true });
            release.promise.then(resolve, reject);
          });
        },
      };
      lifecycleClient.register(
        workflow({
          id: "client-resume-destroy",
          version: "1",
          steps: [step("block", { tool: blockingTool })],
        }),
      );
      await lifecycleBackend.createRun({
        id: "client-resume-destroy-run",
        workflowId: "client-resume-destroy",
        version: "1",
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
      });
      const resumePromise = lifecycleClient.resume("client-resume-destroy-run");
      let destroyPromise: Promise<void> | undefined;

      try {
        await started.promise;
        destroyPromise = lifecycleClient.destroy();
        await destroyPromise;
        await Promise.allSettled([resumePromise]);

        assertEquals(observedAbort, true);
        assertEquals(lifecycleBackend.statusesAtDestroy, ["cancelled"]);
      } finally {
        release.resolve(undefined);
        await Promise.allSettled([resumePromise, destroyPromise ?? lifecycleClient.destroy()]);
      }
    });

    it("does not let teardown of a stale resume cancel its replacement worker", async () => {
      const lifecycleBackend = new DestroyOrderBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        executor: { cancellationGracePeriod: 20, enableLocking: false },
      });
      const started = Promise.withResolvers<void>();
      const blockingTool: Tool = {
        id: "client-stale-resume-blocker",
        type: "function",
        description: "Wait for stale resume teardown",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: (_input, context) => {
          started.resolve();
          return new Promise((_resolve, reject) => {
            const abort = () => reject(context?.abortSignal?.reason);
            if (context?.abortSignal?.aborted) abort();
            else context?.abortSignal?.addEventListener("abort", abort, { once: true });
          });
        },
      };
      lifecycleClient.register(
        workflow({
          id: "client-stale-resume",
          version: "1",
          steps: [step("block", { tool: blockingTool })],
        }),
      );
      const runId = "client-stale-resume-run";
      const admittedWorkerId = "run-execution:stale-owner";
      const replacementWorkerId = "run-execution:replacement-owner";
      await lifecycleBackend.createRun({
        id: runId,
        workflowId: "client-stale-resume",
        version: "1",
        status: "pending",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        workerId: admittedWorkerId,
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
      });

      const resumePromise = lifecycleClient.resume(runId, admittedWorkerId);
      let destroyPromise: Promise<void> | undefined;
      try {
        await started.promise;
        await lifecycleBackend.updateRun(runId, { workerId: replacementWorkerId });
        destroyPromise = lifecycleClient.destroy();
        await Promise.all([resumePromise, destroyPromise]);

        assertEquals(lifecycleBackend.statusesAtDestroy, ["running"]);
        assertEquals(lifecycleBackend.workerIdsAtDestroy, [replacementWorkerId]);
      } finally {
        await Promise.allSettled([resumePromise, destroyPromise ?? lifecycleClient.destroy()]);
      }
    });

    it("cancels an admitted same-tick start instead of losing it during close", async () => {
      const lifecycleBackend = new DestroyOrderBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        executor: { cancellationGracePeriod: 20 },
      });
      let toolStarted = false;
      let observedAbort = false;
      const blockingTool: Tool = {
        id: "client-same-tick-start-blocker",
        type: "function",
        description: "Wait for same-tick client teardown",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: (_input, context) => {
          toolStarted = true;
          return new Promise((_resolve, reject) => {
            const abort = () => {
              observedAbort = true;
              reject(context?.abortSignal?.reason);
            };
            if (context?.abortSignal?.aborted) abort();
            else context?.abortSignal?.addEventListener("abort", abort, { once: true });
          });
        },
      };
      lifecycleClient.register(
        workflow({
          id: "client-same-tick-start",
          steps: [step("block", { tool: blockingTool })],
        }),
      );

      const startPromise = lifecycleClient.start("client-same-tick-start", {});
      const destroyPromise = lifecycleClient.destroy();
      try {
        const handle = await startPromise;
        await destroyPromise;
        await handle.settled();

        assertEquals(toolStarted && !observedAbort, false);
        assertEquals(lifecycleBackend.statusesAtDestroy, ["cancelled"]);
      } finally {
        await Promise.allSettled([startPromise, destroyPromise]);
      }
    });

    it("leaves a replacement-owned durable decision repairable after teardown", async () => {
      const lifecycleBackend = new GatedApprovalDecisionBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        backendOwnership: "borrowed",
      });
      const approvalWorkflow = workflow({
        id: "client-approval-destroy",
        version: "1",
        steps: [waitForApproval("review")],
      });
      lifecycleClient.register(approvalWorkflow);
      const lifecycleExecutor = lifecycleClient.getExecutor();
      const runId = "client-approval-destroy-run";
      const approvalId = "client-approval-destroy-approval";
      const replacementWorkerId = "run-execution:decision-replacement";
      await lifecycleBackend.createRun({
        id: runId,
        workflowId: "client-approval-destroy",
        version: "1",
        status: "waiting",
        input: {},
        nodeStates: {},
        currentNodes: ["review"],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        workerId: "run-execution:decision-original",
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
        _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
        _workflowProjection: { context: {} },
      });
      await lifecycleBackend.savePendingApproval(runId, {
        id: approvalId,
        nodeId: "review",
        status: "pending",
        message: "Please review",
        payload: {},
        requestedAt: new Date(),
      });

      const approvalPromise = lifecycleClient.approve(
        runId,
        approvalId,
        "reviewer@example.com",
      );
      let destroyPromise: Promise<void> | undefined;
      let retryClient: WorkflowClient | undefined;
      try {
        await lifecycleBackend.decisionPersisted.promise;
        await lifecycleBackend.updateRun(runId, { workerId: replacementWorkerId });
        destroyPromise = lifecycleClient.destroy();
        await Promise.resolve();
        assertThrows(
          () => lifecycleExecutor.getStatus(runId),
          Error,
          "workflow executor is closing",
        );

        lifecycleBackend.releaseDecision.resolve();
        const [approvalOutcome] = await Promise.all([
          Promise.allSettled([approvalPromise]),
          destroyPromise,
        ]);
        assertEquals(approvalOutcome[0]?.status, "rejected");

        const waitingRun = await lifecycleBackend.getRun(runId);
        assertEquals(waitingRun?.status, "waiting");
        assertEquals(waitingRun?.workerId, replacementWorkerId);
        assertEquals(
          (await lifecycleBackend.getApproval(runId, approvalId))?.status,
          "approved",
        );

        retryClient = createWorkflowClient({
          backend: lifecycleBackend,
          backendOwnership: "borrowed",
        });
        retryClient.register(approvalWorkflow);
        await retryClient.approve(runId, approvalId, "reviewer@example.com");

        assertEquals((await lifecycleBackend.getRun(runId))?.status, "completed");
      } finally {
        lifecycleBackend.releaseDecision.resolve();
        await Promise.allSettled([
          approvalPromise,
          destroyPromise ?? lifecycleClient.destroy(),
          ...(retryClient ? [retryClient.destroy()] : []),
        ]);
        await lifecycleBackend.destroy();
      }
    });

    it("retains its backend and retries unresolved executor cancellation", async () => {
      const lifecycleBackend = new RetryableClientShutdownBackend();
      const lifecycleClient = createWorkflowClient({
        backend: lifecycleBackend,
        executor: { cancellationGracePeriod: 20, enableLocking: false },
      });
      const started = Promise.withResolvers<void>();
      const blockingTool: Tool = {
        id: "client-retryable-shutdown-blocker",
        type: "function",
        description: "Wait for a retryable client shutdown",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: (_input, context) => {
          started.resolve();
          return new Promise((_resolve, reject) => {
            const abort = () => reject(context?.abortSignal?.reason);
            if (context?.abortSignal?.aborted) abort();
            else context?.abortSignal?.addEventListener("abort", abort, { once: true });
          });
        },
      };
      lifecycleClient.register(
        workflow({
          id: "client-retryable-shutdown",
          steps: [step("block", { tool: blockingTool })],
        }),
      );

      const handle = await lifecycleClient.start("client-retryable-shutdown", {});
      await started.promise;
      lifecycleBackend.rejectShutdownWrites = true;
      const firstDestroy = lifecycleClient.destroy();

      try {
        assertEquals(lifecycleClient.destroy(), firstDestroy);
        await assertRejects(
          () => firstDestroy,
          AggregateError,
          "Failed to destroy workflow client cleanly",
        );
        await handle.settled();

        assertEquals(lifecycleBackend.destroyCalls, 0);
        assertEquals((await lifecycleBackend.getRun(handle.runId))?.status, "running");
        assertThrows(
          () => lifecycleClient.getBackend(),
          Error,
          "workflow client is closing",
        );

        lifecycleBackend.rejectShutdownWrites = false;
        const retryDestroy = lifecycleClient.destroy();
        assertEquals(retryDestroy === firstDestroy, false);
        await retryDestroy;

        assertEquals(lifecycleBackend.destroyCalls, 1);
        assertEquals(lifecycleBackend.statusesAtDestroy, ["cancelled"]);
        assertEquals(lifecycleClient.destroy(), retryDestroy);
      } finally {
        lifecycleBackend.rejectShutdownWrites = false;
        await Promise.allSettled([handle.settled(), lifecycleClient.destroy()]);
      }
    });

    it("retries a transient backend destroy failure", async () => {
      const lifecycleBackend = new FailsFirstBackendDestroy();
      const lifecycleClient = createWorkflowClient({ backend: lifecycleBackend });
      const firstDestroy = lifecycleClient.destroy();

      try {
        assertEquals(lifecycleClient.destroy(), firstDestroy);
        await assertRejects(
          () => firstDestroy,
          AggregateError,
          "Failed to destroy workflow client cleanly",
        );
        assertEquals(lifecycleBackend.destroyCalls, 1);
        assertThrows(
          () => lifecycleClient.getBackend(),
          Error,
          "workflow client is closing",
        );

        const retryDestroy = lifecycleClient.destroy();
        assertEquals(retryDestroy === firstDestroy, false);
        await retryDestroy;

        assertEquals(lifecycleBackend.destroyCalls, 2);
        assertEquals(lifecycleClient.destroy(), retryDestroy);
      } finally {
        await Promise.allSettled([lifecycleClient.destroy()]);
      }
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
