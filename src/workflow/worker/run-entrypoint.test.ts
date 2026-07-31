import "#veryfront/schemas/_test-setup.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { MemoryBackend } from "../backends/memory.ts";
import { delay, dependsOn, step, waitForApproval, workflow } from "../dsl/index.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES } from "../limits.ts";
import type { WorkflowRun } from "../types.ts";
import { createWorkflowRunEntrypoint, EXIT_CODES, runWorkflowRun } from "./run-entrypoint.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

const ENV_KEYS = [
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "WORKFLOW_LOCK_DURATION_MS",
  "WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS",
  "WORKFLOW_LOCK_RETRY_INTERVAL_MS",
  "VERYFRONT_TASK_ENV_JSON",
  "VERYFRONT_PROJECT_API_URL",
  "TENANT_TOKEN",
  "TENANT_PROJECT_SLUG",
] as const;

const savedEnv = new Map<string, string | undefined>();

function rememberEnv(): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, Deno.env.get(key));
    }
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  savedEnv.clear();
}

function setManagedExecutionEnv(runId: string, executionId: string): void {
  Deno.env.set("WORKFLOW_RUN_ID", runId);
  Deno.env.set("RUN_EXECUTION_ID", executionId);
  Deno.env.set("WORKFLOW_LOCK_DURATION_MS", "1000");
  Deno.env.set("WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS", "1000");
  Deno.env.set("WORKFLOW_LOCK_RETRY_INTERVAL_MS", "5");
}

async function prepareManagedExecution(
  backend: MemoryBackend,
  run: WorkflowRun,
  executionId = "entrypoint-test",
): Promise<void> {
  await backend.updateRun(run.id, { workerId: `run-execution:${executionId}` });
  setManagedExecutionEnv(run.id, executionId);
}

function createMockTool(name: string, handler: (input: unknown) => unknown): Tool {
  return {
    id: name,
    type: "function",
    description: `Mock tool: ${name}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: (input) => Promise.resolve(handler(input)),
  };
}

function createTrapCountingProxy<T extends object>(
  target: T,
  onHook: () => void,
): T {
  return new Proxy(target, {
    get() {
      onHook();
      throw new Error("get trap must not run");
    },
    getOwnPropertyDescriptor() {
      onHook();
      throw new Error("descriptor trap must not run");
    },
    getPrototypeOf() {
      onHook();
      throw new Error("prototype trap must not run");
    },
    ownKeys() {
      onHook();
      throw new Error("ownKeys trap must not run");
    },
  });
}

class MissingPolicyOnReadBackend extends MemoryBackend {
  override async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await super.getRun(runId);
    if (!run) return null;
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = run;
    return missingSnapshot as unknown as WorkflowRun;
  }
}

class EntrypointLifecycleBackend extends MemoryBackend {
  initializeCalls = 0;
  destroyCalls = 0;
  initializeError?: Error;
  initializeGate?: Promise<void>;
  destroyError?: Error;

  override async initialize(): Promise<void> {
    this.initializeCalls++;
    if (this.initializeError) throw this.initializeError;
    await this.initializeGate;
  }

  override destroy(): Promise<void> {
    this.destroyCalls++;
    return this.destroyError ? Promise.reject(this.destroyError) : Promise.resolve();
  }
}

function createDistributedProvider(
  backend: MemoryBackend,
  onWorkflowBackendCreate?: () => void,
): DistributedRuntimeProvider {
  const unavailable = () => {
    throw new Error("not used by the static entrypoint test");
  };
  return {
    id: "static-entrypoint-test-provider",
    createCacheBackend: unavailable,
    createRenderCacheStore: unavailable,
    createWorkflowBackend: () => {
      onWorkflowBackendCreate?.();
      return backend;
    },
    getWorkflowWorkerEnvironment: () => ({}),
    createRateLimitStore: unavailable,
    createAgentMemory: unavailable,
    createEventPublisher: unavailable,
    startRoutingInvalidationBus: unavailable,
    getCacheAdministration: unavailable,
  } as unknown as DistributedRuntimeProvider;
}

async function withDistributedProvider<T>(
  backend: MemoryBackend,
  operation: () => Promise<T>,
  onWorkflowBackendCreate?: () => void,
): Promise<T> {
  const previous = tryResolve<DistributedRuntimeProvider>(DistributedRuntimeProviderName);
  register(
    DistributedRuntimeProviderName,
    createDistributedProvider(backend, onWorkflowBackendCreate),
  );
  try {
    return await operation();
  } finally {
    unregister(DistributedRuntimeProviderName);
    if (previous !== undefined) register(DistributedRuntimeProviderName, previous);
  }
}

describe("runWorkflowRun", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("rejects a proxied static run config without evaluating traps or calling the backend", async () => {
    class AdmissionBackend extends MemoryBackend {
      getRunCalls = 0;

      override getRun(runId: string): Promise<WorkflowRun | null> {
        this.getRunCalls++;
        return super.getRun(runId);
      }
    }

    const backend = new AdmissionBackend();
    let hookCalls = 0;
    const config = createTrapCountingProxy(
      { backend, executor: {} as WorkflowExecutor },
      () => {
        hookCalls++;
      },
    );

    await assertRejects(
      () => runWorkflowRun(config),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(hookCalls, 0);
    assertEquals(backend.getRunCalls, 0);
  });

  it("restores the persisted source integration policy for the static entrypoint", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: {
        confluence: { allowedTools: ["search_content"] },
      },
    });
    const run = {
      id: "run-source-policy",
      workflowId: "test-workflow",
      status: "pending",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy,
    } as unknown as WorkflowRun;
    await backend.createRun(run);
    await prepareManagedExecution(backend, run);

    let observedPolicy: unknown;
    const exitCode = await runWorkflowRun({
      backend,
      executor: {
        resume: async (runId: string) => {
          observedPolicy = getActiveSourceIntegrationPolicy();
          await backend.updateRun(runId, { status: "completed" });
        },
      } as never,
    });

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertEquals(observedPolicy, sourceIntegrationPolicy);
  });

  it("fails closed without invoking the static entrypoint executor when the snapshot is missing", async () => {
    rememberEnv();

    const backend = new MissingPolicyOnReadBackend();
    const run = {
      id: "run-missing-source-policy",
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
    } as unknown as WorkflowRun;
    await backend.createRun(run);
    await prepareManagedExecution(backend, run);

    let resumed = false;
    const exitCode = await runWorkflowRun({
      backend,
      executor: {
        resume: () => {
          resumed = true;
          return Promise.resolve();
        },
      } as never,
    });

    const storedRun = await backend.getRun(run.id);
    assertEquals(exitCode, EXIT_CODES.WORKFLOW_FAILED);
    assertEquals(resumed, false);
    assertExists(storedRun);
    assertEquals(storedRun.status, "failed");
    assertEquals(
      storedRun.error?.message.includes("source integration policy snapshot"),
      true,
    );
  });

  it("hydrates the workflow run context env from injected project env before resume", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-1",
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
    };
    await backend.createRun(run);

    await prepareManagedExecution(backend, run);
    Deno.env.set(
      "VERYFRONT_TASK_ENV_JSON",
      JSON.stringify({
        SERVICENOW_USERNAME: "automation@example.com",
        AI_GATEWAY_TOKEN: "project-token",
        VERYFRONT_API_TOKEN: "should-be-filtered",
      }),
    );
    Deno.env.set("VERYFRONT_PROJECT_API_URL", "https://api.veryfront.com");

    let observedEnv: Record<string, string> | undefined;
    const executor = {
      resume: async (runId: string) => {
        const currentRun = await backend.getRun(runId);
        observedEnv = currentRun?.context.env;
        await backend.updateRun(runId, { status: "completed" });
      },
    };

    const exitCode = await runWorkflowRun({
      backend,
      executor: executor as never,
    });

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertEquals(observedEnv, {
      SERVICENOW_USERNAME: "automation@example.com",
      AI_GATEWAY_TOKEN: "project-token",
    });
  });

  it("fails the run without resuming when injected project env is malformed", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-invalid-project-env",
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
    };
    await backend.createRun(run);

    await prepareManagedExecution(backend, run);
    Deno.env.set("VERYFRONT_TASK_ENV_JSON", "not-json");
    let resumed = false;

    const exitCode = await runWorkflowRun({
      backend,
      executor: {
        resume: () => {
          resumed = true;
          return Promise.resolve();
        },
      } as never,
    });

    const storedRun = await backend.getRun(run.id);
    assertEquals(exitCode, EXIT_CODES.WORKFLOW_FAILED);
    assertEquals(resumed, false);
    assertExists(storedRun);
    assertEquals(storedRun.status, "failed");
    assertEquals(
      storedRun.error?.message.includes("VERYFRONT_TASK_ENV_JSON"),
      true,
    );
  });

  it("uses the stored tenant context when tenant env vars are absent", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-tenant",
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
      _tenant: {
        projectSlug: "acme",
        token: "tenant-token",
        projectId: "project-123",
        productionMode: true,
        releaseId: "release-1",
      },
    };
    await backend.createRun(run);

    await prepareManagedExecution(backend, run);
    Deno.env.delete("TENANT_TOKEN");
    Deno.env.delete("TENANT_PROJECT_SLUG");

    let observedContext = getCurrentRequestContext();
    const executor = {
      resume: async (runId: string) => {
        observedContext = getCurrentRequestContext();
        await backend.updateRun(runId, { status: "waiting" });
      },
    };

    const exitCode = await runWorkflowRun({
      backend,
      executor: executor as never,
    });

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertExists(observedContext);
    assertEquals(observedContext.projectSlug, "acme");
    assertEquals(observedContext.projectId, "project-123");
    assertEquals(observedContext.token, "tenant-token");
    assertEquals(observedContext.productionMode, true);
    assertEquals(observedContext.releaseId, "release-1");
  });

  it("marks the run as failed when the executor throws", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-failure",
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
    };
    await backend.createRun(run);

    await prepareManagedExecution(backend, run);

    const exitCode = await runWorkflowRun({
      backend,
      executor: {
        resume: async () => {
          throw new Error("boom");
        },
      } as never,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.WORKFLOW_FAILED);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "failed");
    assertEquals(updatedRun.error?.message, "EXECUTION_ERROR: boom");
  });

  it("does not start an isolated execution after persisted ownership changes", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-stale-execution",
      workflowId: "test-workflow",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      workerId: "run-execution:new-owner",
    };
    await backend.createRun(run);

    setManagedExecutionEnv(run.id, "old-owner");
    Deno.env.set(
      "VERYFRONT_TASK_ENV_JSON",
      JSON.stringify({ SHOULD_NOT_BE_PERSISTED: "stale" }),
    );

    let observedWorkerId: string | undefined;
    const exitCode = await runWorkflowRun({
      backend,
      executor: {
        resume: async (
          _runId: string,
          _fromCheckpoint?: string,
          expectedWorkerId?: string,
        ) => {
          observedWorkerId = expectedWorkerId;
          throw new Error("stale execution");
        },
      } as never,
    });

    const persisted = await backend.getRun(run.id);
    assertEquals(exitCode, EXIT_CODES.WORKFLOW_FAILED);
    assertEquals(observedWorkerId, undefined);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.error, undefined);
    assertEquals(persisted?.context.env, undefined);
  });

  it("executes workflow runs already marked running by the run manager", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    const workflowDefinition = workflow({
      id: "running-workflow",
      steps: [
        step("finish", {
          tool: createMockTool("finish-tool", () => ({ ok: true })),
        }),
      ],
    });
    executor.register(workflowDefinition.definition);

    const run: WorkflowRun = {
      id: "run-running",
      workflowId: "running-workflow",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      startedAt: new Date(),
      workerId: "run-execution:run-exec-1",
    };
    await backend.createRun(run);

    setManagedExecutionEnv(run.id, "run-exec-1");

    const exitCode = await runWorkflowRun({
      backend,
      executor,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "completed");
    assertEquals(updatedRun.output, { finish: { ok: true } });
  });

  it("resumes run-manager workflow runs from the latest checkpoint", async () => {
    rememberEnv();

    const backend = new MemoryBackend();
    const executor = new WorkflowExecutor({ backend });
    let firstExecuted = false;
    let secondExecuted = false;
    const workflowDefinition = workflow({
      id: "checkpointed-workflow",
      steps: [
        step("first", {
          tool: createMockTool("first-tool", () => {
            firstExecuted = true;
            return { first: true };
          }),
        }),
        dependsOn(
          step("second", {
            tool: createMockTool("second-tool", () => {
              secondExecuted = true;
              return { second: true };
            }),
          }),
          "first",
        ),
      ],
    });
    executor.register(workflowDefinition.definition);

    const firstNodeState = {
      nodeId: "first",
      status: "completed" as const,
      output: { first: true },
      attempt: 1,
    };
    const run: WorkflowRun = {
      id: "run-checkpointed",
      workflowId: "checkpointed-workflow",
      status: "running",
      input: {},
      nodeStates: { first: firstNodeState },
      currentNodes: [],
      context: { input: {}, first: { first: true } },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      startedAt: new Date(),
      workerId: "run-execution:run-exec-2",
    };
    await backend.createRun(run);
    await backend.saveCheckpoint(run.id, {
      id: "cp-first",
      nodeId: "first",
      timestamp: new Date(),
      context: { input: {}, first: { first: true } },
      nodeStates: { first: firstNodeState },
    });

    setManagedExecutionEnv(run.id, "run-exec-2");

    const exitCode = await runWorkflowRun({
      backend,
      executor,
    });

    const updatedRun = await backend.getRun(run.id);

    assertEquals(exitCode, EXIT_CODES.SUCCESS);
    assertEquals(firstExecuted, false);
    assertEquals(secondExecuted, true);
    assertExists(updatedRun);
    assertEquals(updatedRun.status, "completed");
    assertEquals(updatedRun.output, { first: { first: true }, second: { second: true } });
  });

  it("persists waitForApproval through the canonical static entrypoint", async () => {
    rememberEnv();

    const backend = new EntrypointLifecycleBackend();
    const workflowDefinition = workflow({
      id: "static-approval-workflow",
      steps: [waitForApproval("review", { message: "Review static run" })],
    });

    await withDistributedProvider(backend, async () => {
      const runEntrypoint = await createWorkflowRunEntrypoint({
        workflows: [workflowDefinition],
      });
      const run: WorkflowRun = {
        id: "run-static-approval",
        workflowId: workflowDefinition.id,
        status: "running",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        startedAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      await backend.createRun(run);
      await prepareManagedExecution(backend, run, "static-approval-execution");

      const exitCode = await runEntrypoint();

      assertEquals(exitCode, EXIT_CODES.SUCCESS);
      assertEquals((await backend.getRun(run.id))?.status, "waiting");
      const approvals = await backend.getPendingApprovals(run.id);
      assertEquals(approvals.length, 1);
      assertEquals(approvals[0]?.nodeId, "review");
      assertEquals(approvals[0]?.message, "Review static run");
      assertEquals(backend.initializeCalls, 1);
      assertEquals(backend.destroyCalls, 1);
    });
  });

  it("leaves a timed delay waiting after canonical static entrypoint cleanup", async () => {
    rememberEnv();

    const backend = new EntrypointLifecycleBackend();
    const workflowDefinition = workflow({
      id: "static-timed-wait-workflow",
      steps: [delay("pause", 60_000)],
    });

    await withDistributedProvider(backend, async () => {
      const runEntrypoint = await createWorkflowRunEntrypoint({
        workflows: [workflowDefinition],
      });
      const run: WorkflowRun = {
        id: "run-static-timed-wait",
        workflowId: workflowDefinition.id,
        status: "running",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        startedAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      await backend.createRun(run);
      await prepareManagedExecution(backend, run, "static-timed-wait-execution");

      const exitCode = await runEntrypoint();

      const persisted = await backend.getRun(run.id);
      assertEquals(exitCode, EXIT_CODES.SUCCESS);
      assertEquals(persisted?.status, "waiting");
      assertEquals(persisted?.nodeStates.pause?.status, "running");
      assertEquals(backend.destroyCalls, 1);
    });
  });

  it("does not destroy an owned backend underneath an active static entrypoint", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const executionStarted = Promise.withResolvers<void>();
    const executionGate = Promise.withResolvers<void>();
    const workflowDefinition = workflow({
      id: "static-lifecycle-gate",
      steps: [
        step("gated", {
          tool: createMockTool("gated-tool", async () => {
            executionStarted.resolve();
            await executionGate.promise;
            return { ok: true };
          }),
        }),
      ],
    });

    await withDistributedProvider(backend, async () => {
      const entrypoint = await createWorkflowRunEntrypoint({
        workflows: [workflowDefinition],
      });
      const run: WorkflowRun = {
        id: "run-static-lifecycle-gate",
        workflowId: workflowDefinition.id,
        status: "running",
        input: {},
        nodeStates: {},
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
      };
      await backend.createRun(run);
      await prepareManagedExecution(backend, run, "static-lifecycle-gate");

      const execution = entrypoint();
      await executionStarted.promise;
      let destroySettled = false;
      const destroy = entrypoint.destroy().then(() => {
        destroySettled = true;
      });
      await Promise.resolve();
      assertEquals(destroySettled, false);
      assertEquals(backend.destroyCalls, 0);

      executionGate.resolve();
      assertEquals(await execution, EXIT_CODES.SUCCESS);
      await destroy;
      assertEquals(backend.destroyCalls, 1);
    });
  });

  it("rolls back static entrypoint initialization and preserves cleanup failure", async () => {
    const backend = new EntrypointLifecycleBackend();
    backend.initializeError = new Error("initialization failed");
    backend.destroyError = new Error("cleanup failed");
    const workflowDefinition = workflow({
      id: "initialization-failure",
      steps: [waitForApproval("review")],
    });

    await withDistributedProvider(backend, async () => {
      const failure = await assertRejects(
        () => createWorkflowRunEntrypoint({ workflows: [workflowDefinition] }),
        AggregateError,
        "initialization and cleanup failed",
      ) as AggregateError;
      assertEquals(
        failure.errors.map((error) => error instanceof Error ? error.message : String(error)),
        ["initialization failed", "cleanup failed"],
      );
    });
    assertEquals(backend.initializeCalls, 1);
    assertEquals(backend.destroyCalls, 1);
  });

  it("rejects invalid definitions before resolving an owned backend", async () => {
    const backend = new EntrypointLifecycleBackend();
    let backendResolutionCalls = 0;

    await withDistributedProvider(
      backend,
      async () => {
        await assertRejects(
          () =>
            createWorkflowRunEntrypoint({
              workflows: [{ definition: { id: "invalid-empty", steps: [] } }],
            }),
          Error,
          "must have at least one step",
        );
        const duplicate = workflow({
          id: "duplicate-entrypoint-workflow",
          steps: [waitForApproval("review")],
        });
        await assertRejects(
          () =>
            createWorkflowRunEntrypoint({
              workflows: [duplicate, duplicate],
            }),
          Error,
          "Workflow already registered",
        );
        await assertRejects(
          () => createWorkflowRunEntrypoint({ workflows: [] }),
          Error,
          "must contain at least one workflow",
        );
      },
      () => {
        backendResolutionCalls++;
        void backend.initialize();
      },
    );
    assertEquals(backendResolutionCalls, 0);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("rejects proxied static factory structures without hooks or provider calls", async () => {
    const backend = new EntrypointLifecycleBackend();
    const validWorkflow = workflow({
      id: "hostile-admission-proxy-control",
      steps: [waitForApproval("review")],
    });
    let hookCalls = 0;
    let providerCalls = 0;
    const onHook = () => {
      hookCalls++;
    };
    const cases: unknown[] = [
      createTrapCountingProxy({ workflows: [validWorkflow] }, onHook),
      { workflows: createTrapCountingProxy([validWorkflow], onHook) },
      { workflows: [createTrapCountingProxy(validWorkflow, onHook)] },
    ];

    await withDistributedProvider(
      backend,
      async () => {
        for (const options of cases) {
          await assertRejects(
            () => createWorkflowRunEntrypoint(options as never),
            Error,
            "non-Proxy",
          );
        }
      },
      () => {
        providerCalls++;
      },
    );

    assertEquals(hookCalls, 0);
    assertEquals(providerCalls, 0);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("rejects inexact or unbounded static factory structures before provider calls", async () => {
    const backend = new EntrypointLifecycleBackend();
    const validWorkflow = workflow({
      id: "exact-admission-control",
      steps: [waitForApproval("review")],
    });
    let getterCalls = 0;
    let providerCalls = 0;

    const accessorOptions = Object.defineProperty({}, "debug", {
      enumerable: true,
      get() {
        getterCalls++;
        return false;
      },
    });
    Object.defineProperty(accessorOptions, "workflows", {
      enumerable: true,
      value: [validWorkflow],
    });
    const hiddenOptions = Object.defineProperty({}, "workflows", {
      value: [validWorkflow],
    });
    const sparseWorkflows = new Array(2);
    sparseWorkflows[0] = validWorkflow;
    const workflowsWithCustomField = [validWorkflow] as Array<typeof validWorkflow> & {
      extra?: boolean;
    };
    workflowsWithCustomField.extra = true;
    const accessorWorkflows: unknown[] = [];
    Object.defineProperty(accessorWorkflows, "0", {
      enumerable: true,
      get() {
        getterCalls++;
        return validWorkflow;
      },
    });
    const accessorWrapper = Object.defineProperty({}, "definition", {
      enumerable: true,
      get() {
        getterCalls++;
        return validWorkflow.definition;
      },
    });
    const hiddenWrapper = Object.defineProperty({}, "definition", {
      value: validWorkflow.definition,
    });
    const oversizedWorkflows = new Array(
      MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES + 1,
    ).fill(validWorkflow);

    const cases: Array<readonly [unknown, string]> = [
      [{ workflows: [validWorkflow], unsupported: true }, "unsupported field"],
      [accessorOptions, "enumerable own data property"],
      [hiddenOptions, "enumerable own data property"],
      [{ workflows: sparseWorkflows }, "must be dense"],
      [{ workflows: workflowsWithCustomField }, "must be dense"],
      [{ workflows: accessorWorkflows }, "enumerable own data property"],
      [{ workflows: [{ ...validWorkflow, unsupported: true }] }, "unsupported field"],
      [{ workflows: [accessorWrapper] }, "enumerable own data property"],
      [{ workflows: [hiddenWrapper] }, "enumerable own data property"],
      [{ workflows: oversizedWorkflows }, "cannot contain more than"],
    ];

    await withDistributedProvider(
      backend,
      async () => {
        for (const [options, message] of cases) {
          await assertRejects(
            () => createWorkflowRunEntrypoint(options as never),
            Error,
            message,
          );
        }
      },
      () => {
        providerCalls++;
      },
    );

    assertEquals(getterCalls, 0);
    assertEquals(providerCalls, 0);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("captures workflow admission before awaiting backend readiness", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const initializationGate = Promise.withResolvers<void>();
    backend.initializeGate = initializationGate.promise;
    let originalExecuted = false;
    let replacementExecuted = false;
    const admittedWorkflow = workflow({
      id: "static-admission-snapshot",
      steps: [
        step("admitted", {
          tool: createMockTool("admitted-tool", () => {
            originalExecuted = true;
            return { admitted: true };
          }),
        }),
      ],
    });
    const replacementWorkflow = workflow({
      id: "replacement-workflow",
      steps: [
        step("replacement", {
          tool: createMockTool("replacement-tool", () => {
            replacementExecuted = true;
            return { replacement: true };
          }),
        }),
      ],
    });
    const wrapper = { definition: admittedWorkflow.definition };
    const options = { workflows: [wrapper], debug: false };
    let sourcesMutated = false;
    const mutateAdmissionSources = () => {
      wrapper.definition = replacementWorkflow.definition;
      options.workflows.length = 0;
      options.debug = true;
      const admittedSteps = admittedWorkflow.definition.steps;
      const replacementSteps = replacementWorkflow.definition.steps;
      if (!Array.isArray(admittedSteps) || !Array.isArray(replacementSteps)) {
        throw new Error("Admission snapshot test requires static workflow steps");
      }
      admittedSteps.splice(0, admittedSteps.length, ...replacementSteps);
      sourcesMutated = true;
    };

    await withDistributedProvider(
      backend,
      async () => {
        const entrypointPromise = createWorkflowRunEntrypoint(options);
        assertEquals(sourcesMutated, true);
        assertEquals(backend.initializeCalls, 1);

        initializationGate.resolve();
        const entrypoint = await entrypointPromise;
        const run: WorkflowRun = {
          id: "run-static-admission-snapshot",
          workflowId: admittedWorkflow.id,
          status: "running",
          input: {},
          nodeStates: {},
          currentNodes: [],
          context: { input: {} },
          checkpoints: [],
          pendingApprovals: [],
          createdAt: new Date(),
          sourceIntegrationPolicy: UNRESTRICTED_SOURCE_INTEGRATION_POLICY,
        };
        await backend.createRun(run);
        await prepareManagedExecution(backend, run, "static-admission-snapshot");

        assertEquals(await entrypoint(), EXIT_CODES.SUCCESS);
        assertEquals(originalExecuted, true);
        assertEquals(replacementExecuted, false);
        assertEquals((await backend.getRun(run.id))?.output, {
          admitted: { admitted: true },
        });
      },
      mutateAdmissionSources,
    );
  });

  it("validates static factory options before resolving a backend", async () => {
    await assertRejects(
      () => createWorkflowRunEntrypoint(null as never),
      Error,
      "options must be an object",
    );
    await assertRejects(
      () => createWorkflowRunEntrypoint({ workflows: "invalid" } as never),
      Error,
      "workflows must be an array",
    );
    await assertRejects(
      () => createWorkflowRunEntrypoint({ workflows: [], debug: "yes" } as never),
      Error,
      "debug must be a boolean",
    );
    await assertRejects(
      () => createWorkflowRunEntrypoint({ workflows: [{}] } as never),
      Error,
      "must contain an own definition data property",
    );
    await assertRejects(
      () => createWorkflowRunEntrypoint({ workflows: [] }),
      Error,
      "must contain at least one workflow",
    );
  });

  it("destroys an unused static entrypoint exactly once", async () => {
    const backend = new EntrypointLifecycleBackend();
    const workflowDefinition = workflow({
      id: "unused-static-entrypoint",
      steps: [waitForApproval("review")],
    });

    await withDistributedProvider(backend, async () => {
      const entrypoint = await createWorkflowRunEntrypoint({
        workflows: [workflowDefinition],
      });
      await entrypoint.destroy();
      await entrypoint.destroy();
      await assertRejects(() => entrypoint(), Error, "it is closed");
    });
    assertEquals(backend.initializeCalls, 1);
    assertEquals(backend.destroyCalls, 1);
  });
});
