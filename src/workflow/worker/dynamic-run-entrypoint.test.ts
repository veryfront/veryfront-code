import "#veryfront/schemas/_test-setup.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { waitForApproval, workflow } from "../dsl/index.ts";
import type { WorkflowRun } from "../types.ts";
import {
  createDynamicWorkflowRunEntrypoint,
  createDynamicWorkflowRunEntrypointWithDependencies,
  DYNAMIC_EXIT_CODES,
  type DynamicWorkflowRunDependencies,
  runDynamicWorkflowRun,
  runDynamicWorkflowRunWithDependencies,
} from "./dynamic-run-entrypoint.ts";
import { createIsolatedWorkflowRuntime } from "./shared.ts";
import { WORKFLOW_RUNTIME_STATE_VERSION } from "../runtime-state.ts";

const ENV_KEYS = [
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "WORKFLOW_LOCK_DURATION_MS",
  "WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS",
  "WORKFLOW_LOCK_RETRY_INTERVAL_MS",
  "VERYFRONT_TASK_ENV_JSON",
  "VERYFRONT_API_URL",
  "TENANT_PROJECT_SLUG",
  "TENANT_TOKEN",
  "TENANT_BRANCH_ID",
  "VERYFRONT_BRANCH_REF",
] as const;

const savedEnv = new Map<string, string | undefined>();

function rememberEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, Deno.env.get(key));
  }
  Deno.env.set("VERYFRONT_API_URL", "https://api.example.test");
  Deno.env.set("WORKFLOW_LOCK_DURATION_MS", "1000");
  Deno.env.set("WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS", "1000");
  Deno.env.set("WORKFLOW_LOCK_RETRY_INTERVAL_MS", "5");
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  savedEnv.clear();
}

const SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createClaimedRun(
  id: string,
  options: {
    workflowId?: string;
    workerId?: string;
  } = {},
): WorkflowRun {
  return {
    id,
    workflowId: options.workflowId ?? "workflow-1",
    version: "1",
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: SOURCE_INTEGRATION_POLICY,
    _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
    _workflowProjection: { context: {} },
    workerId: options.workerId ?? "run-execution:current-owner",
    _tenant: {
      projectSlug: "acme",
      token: "tenant-token",
      projectId: "project-123",
      productionMode: false,
      branch: "feature/test",
    },
  };
}

function createDependencies(options: {
  workflows?: Map<string, unknown>;
  enhanceError?: Error;
  discoveryError?: Error;
  discoveryErrors?: Array<{ file: string; error: Error }>;
  onFSConfig?: (config: unknown) => void;
  createIsolatedWorkflowRuntime?: DynamicWorkflowRunDependencies["createIsolatedWorkflowRuntime"];
} = {}): DynamicWorkflowRunDependencies {
  return {
    enhanceAdapterWithFS: async (adapter, config) => {
      options.onFSConfig?.(config);
      if (options.enhanceError) throw options.enhanceError;
      return adapter;
    },
    discoverProjectAgentRuntime: async () => {
      if (options.discoveryError) throw options.discoveryError;
      return {
        tools: new Map(),
        agents: new Map(),
        skills: new Map(),
        resources: new Map(),
        prompts: new Map(),
        workflows: options.workflows ?? new Map(),
        tasks: new Map(),
        schedules: new Map(),
        webhooks: new Map(),
        evals: new Map(),
        errors: options.discoveryErrors ?? [],
        sourceIntegrationPolicy: SOURCE_INTEGRATION_POLICY,
      } as never;
    },
    createIsolatedWorkflowRuntime: options.createIsolatedWorkflowRuntime ??
      createIsolatedWorkflowRuntime,
  };
}

class EntrypointLifecycleBackend extends MemoryBackend {
  initializeCalls = 0;
  destroyCalls = 0;
  initializeError?: Error;
  destroyError?: Error;

  override initialize(): Promise<void> {
    this.initializeCalls++;
    return this.initializeError ? Promise.reject(this.initializeError) : Promise.resolve();
  }

  override destroy(): Promise<void> {
    this.destroyCalls++;
    return this.destroyError ? Promise.reject(this.destroyError) : Promise.resolve();
  }
}

function createDistributedProvider(backend: MemoryBackend): DistributedRuntimeProvider {
  const unavailable = () => {
    throw new Error("not used by the dynamic entrypoint lifecycle test");
  };
  return {
    id: "dynamic-entrypoint-test-provider",
    createCacheBackend: unavailable,
    createRenderCacheStore: unavailable,
    createWorkflowBackend: () => backend,
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
): Promise<T> {
  const previous = tryResolve<DistributedRuntimeProvider>(DistributedRuntimeProviderName);
  register(DistributedRuntimeProviderName, createDistributedProvider(backend));
  try {
    return await operation();
  } finally {
    unregister(DistributedRuntimeProviderName);
    if (previous !== undefined) register(DistributedRuntimeProviderName, previous);
  }
}

describe("runDynamicWorkflowRun", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("does not hydrate state after the run is reassigned to a new execution", async () => {
    rememberEnv();
    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-dynamic-stale-execution",
      workflowId: "workflow-1",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      workerId: "run-execution:new-owner",
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "old-owner");
    Deno.env.set(
      "VERYFRONT_TASK_ENV_JSON",
      JSON.stringify({ SHOULD_NOT_BE_PERSISTED: "stale" }),
    );

    assertEquals(
      await runDynamicWorkflowRun({ backend }),
      DYNAMIC_EXIT_CODES.WORKFLOW_FAILED,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.context.env, undefined);
  });

  it("fails the current owner when tenant context is missing", async () => {
    rememberEnv();
    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");

    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "run-dynamic-missing-tenant",
      workflowId: "workflow-1",
      status: "running",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      workerId: "run-execution:current-owner",
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRun({ backend }),
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message,
      "EXECUTION_ERROR: No tenant context available",
    );
  });

  it("fails closed when the API endpoint is not explicitly composed", async () => {
    rememberEnv();
    Deno.env.delete("VERYFRONT_API_URL");
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-missing-api-url");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies(),
      ),
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
    );
    assertEquals(
      (await backend.getRun(run.id))?.error?.message.includes(
        "requires an explicit VERYFRONT_API_URL",
      ),
      true,
    );
  });

  it("fails closed when a preview run has no branch authority", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-missing-branch");
    run._tenant = { ...run._tenant!, branch: null };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies(),
      ),
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
    );
    assertEquals(
      (await backend.getRun(run.id))?.error?.message.includes(
        "requires an explicit branch",
      ),
      true,
    );
  });

  it("fails the current owner when discovery returns no workflows", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-no-workflows");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies(),
      ),
      DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message,
      "EXECUTION_ERROR: No workflows discovered",
    );
  });

  it("fails the current owner when the requested workflow is not discovered", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-workflow-not-found");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    const otherWorkflow = {
      id: "other-workflow",
      definition: { id: "other-workflow", steps: [] },
    };
    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies({
          workflows: new Map([[otherWorkflow.id, otherWorkflow]]),
        }),
      ),
      DYNAMIC_EXIT_CODES.NOT_FOUND,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message,
      'EXECUTION_ERROR: Workflow not found: "workflow-1"',
    );
  });

  it("preserves adapter configuration failures and their exit code", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-adapter-config-error");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies({ enhanceError: new Error("adapter configuration failed") }),
      ),
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message,
      "EXECUTION_ERROR: adapter configuration failed",
    );
  });

  it("preserves discovery failures and their exit code", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-discovery-error");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies({ discoveryError: new Error("discovery failed") }),
      ),
      DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message,
      "EXECUTION_ERROR: discovery failed",
    );
  });

  it("fails closed when discovery returns partial results with errors", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-partial-discovery");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    const matchingWorkflow = {
      id: run.workflowId,
      definition: { id: run.workflowId, steps: [] },
    };

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies({
          workflows: new Map([[matchingWorkflow.id, matchingWorkflow]]),
          discoveryErrors: [{
            file: "workflows/unrelated.ts",
            error: new Error("unrelated workflow module failed"),
          }],
        }),
      ),
      DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
    );
    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "failed");
    assertEquals(
      persisted?.error?.message.includes("Project discovery was incomplete"),
      true,
    );
  });

  it("does not fail a run reassigned before an empty discovery result", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-stale-discovery", {
      workerId: "run-execution:new-owner",
    });
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "old-owner");

    assertEquals(
      await runDynamicWorkflowRunWithDependencies(
        { backend },
        createDependencies(),
      ),
      DYNAMIC_EXIT_CODES.WORKFLOW_FAILED,
    );

    const persisted = await backend.getRun(run.id);
    assertEquals(persisted?.status, "running");
    assertEquals(persisted?.workerId, "run-execution:new-owner");
    assertEquals(persisted?.error, undefined);
  });

  it("configures dynamic project storage from the captured tenant", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-storage-config");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    Deno.env.set("VERYFRONT_API_URL", "https://api.example.test");

    let observedConfig: unknown;
    await runDynamicWorkflowRunWithDependencies(
      { backend },
      createDependencies({
        onFSConfig: (config) => {
          observedConfig = config;
        },
      }),
    );

    assertEquals(observedConfig, {
      fs: {
        type: "veryfront-api",
        veryfront: {
          apiBaseUrl: "https://api.example.test",
          apiToken: "tenant-token",
          projectSlug: "acme",
          projectId: "project-123",
          proxyMode: false,
          contentSource: { type: "branch", branch: "feature/test" },
        },
      },
    });
  });

  it("does not let process tenant variables override persisted run authority", async () => {
    rememberEnv();
    const backend = new MemoryBackend();
    const run = createClaimedRun("run-dynamic-persisted-authority");
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    Deno.env.set("TENANT_PROJECT_SLUG", "foreign-project");
    Deno.env.set("TENANT_TOKEN", "foreign-token");
    Deno.env.set("VERYFRONT_BRANCH_REF", "foreign-branch");

    let observedConfig: unknown;
    await runDynamicWorkflowRunWithDependencies(
      { backend },
      createDependencies({ onFSConfig: (config) => observedConfig = config }),
    );

    assertEquals(
      (observedConfig as {
        fs: {
          veryfront: {
            apiBaseUrl: string;
            apiToken: string;
            projectSlug: string;
            projectId: string;
            proxyMode: boolean;
            contentSource: unknown;
          };
        };
      }).fs.veryfront,
      {
        apiBaseUrl: "https://api.example.test",
        apiToken: "tenant-token",
        projectSlug: "acme",
        projectId: "project-123",
        proxyMode: false,
        contentSource: { type: "branch", branch: "feature/test" },
      },
    );
  });

  it("disposes the dynamic runtime while preserving its borrowed backend", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const run = createClaimedRun("run-dynamic-runtime-cleanup");
    const workflowDefinition = workflow({
      id: run.workflowId,
      version: "1",
      steps: [waitForApproval("review", { message: "Review dynamic run" })],
    });
    await backend.createRun(run);
    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    let runtimeDestroyCalls = 0;

    const exitCode = await runDynamicWorkflowRunWithDependencies(
      { backend },
      createDependencies({
        workflows: new Map([[workflowDefinition.id, workflowDefinition]]),
        createIsolatedWorkflowRuntime: (backend, debug, stepExecutor) => {
          const runtime = createIsolatedWorkflowRuntime(backend, debug, stepExecutor);
          return Object.freeze({
            executor: runtime.executor,
            async destroy(): Promise<void> {
              runtimeDestroyCalls++;
              await runtime.destroy();
            },
          });
        },
      }),
    );

    assertEquals(exitCode, DYNAMIC_EXIT_CODES.SUCCESS);
    assertEquals((await backend.getRun(run.id))?.status, "waiting");
    assertEquals((await backend.getPendingApprovals(run.id)).length, 1);
    assertEquals(runtimeDestroyCalls, 1);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("disposes the dynamic runtime after executor failure", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const run = createClaimedRun("run-dynamic-runtime-failure");
    await backend.createRun(run);
    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    let runtimeDestroyCalls = 0;
    const discoveredWorkflow = {
      id: run.workflowId,
      definition: {
        id: run.workflowId,
        steps: [{ id: "step", config: { type: "step", tool: "unused" } }],
      },
    };

    const exitCode = await runDynamicWorkflowRunWithDependencies(
      { backend },
      createDependencies({
        workflows: new Map([[discoveredWorkflow.id, discoveredWorkflow]]),
        createIsolatedWorkflowRuntime: () => ({
          executor: {
            register: () => undefined,
            resume: () => Promise.reject(new Error("resume failed")),
          } as never,
          destroy: () => {
            runtimeDestroyCalls++;
            return Promise.resolve();
          },
        }),
      }),
    );

    assertEquals(exitCode, DYNAMIC_EXIT_CODES.WORKFLOW_FAILED);
    assertEquals((await backend.getRun(run.id))?.status, "failed");
    assertEquals(runtimeDestroyCalls, 1);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("rejects borrowed execution when dynamic runtime cleanup fails", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const run = createClaimedRun("run-dynamic-runtime-cleanup-failure");
    await backend.createRun(run);
    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    let runtimeDestroyCalls = 0;
    const discoveredWorkflow = {
      id: run.workflowId,
      definition: { id: run.workflowId, steps: [] },
    };

    await assertRejects(
      () =>
        runDynamicWorkflowRunWithDependencies(
          { backend },
          createDependencies({
            workflows: new Map([[discoveredWorkflow.id, discoveredWorkflow]]),
            createIsolatedWorkflowRuntime: (runtimeBackend) => ({
              executor: {
                register: () => undefined,
                resume: async (runId: string) => {
                  await runtimeBackend.updateRun(runId, { status: "completed" });
                },
              } as never,
              destroy: () => {
                runtimeDestroyCalls++;
                return Promise.reject(new Error("runtime cleanup failed"));
              },
            }),
          }),
        ),
      Error,
      "runtime cleanup failed",
    );

    assertEquals(runtimeDestroyCalls, 1);
    assertEquals(backend.initializeCalls, 0);
    assertEquals(backend.destroyCalls, 0);
  });

  it("retries retained runtime cleanup before closing a managed dynamic backend", async () => {
    rememberEnv();
    const backend = new EntrypointLifecycleBackend();
    const run = createClaimedRun("run-managed-dynamic-runtime-cleanup-retry");
    await backend.createRun(run);
    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "current-owner");
    let runtimeDestroyCalls = 0;
    const discoveredWorkflow = {
      id: run.workflowId,
      definition: { id: run.workflowId, steps: [] },
    };

    await withDistributedProvider(backend, async () => {
      const entrypoint = await createDynamicWorkflowRunEntrypointWithDependencies(
        {},
        createDependencies({
          workflows: new Map([[discoveredWorkflow.id, discoveredWorkflow]]),
          createIsolatedWorkflowRuntime: (runtimeBackend) => ({
            executor: {
              register: () => undefined,
              resume: async (runId: string) => {
                await runtimeBackend.updateRun(runId, { status: "completed" });
              },
            } as never,
            destroy: () => {
              runtimeDestroyCalls++;
              return runtimeDestroyCalls < 3
                ? Promise.reject(
                  new Error(`runtime cleanup failed ${runtimeDestroyCalls}`),
                )
                : Promise.resolve();
            },
          }),
        }),
      );

      const failure = await assertRejects(
        () => entrypoint(),
        AggregateError,
        "execution and cleanup failed",
      ) as AggregateError;
      assertEquals(
        failure.errors.map((error) => error instanceof Error ? error.message : String(error)),
        ["runtime cleanup failed 1", "runtime cleanup failed 2"],
      );
      assertEquals(runtimeDestroyCalls, 2);
      assertEquals(backend.destroyCalls, 0);

      await entrypoint.destroy();
      assertEquals(runtimeDestroyCalls, 3);
      assertEquals(backend.destroyCalls, 1);
    });
    assertEquals(backend.initializeCalls, 1);
  });

  it("initializes and auto-destroys the backend owned by the dynamic factory", async () => {
    rememberEnv();
    Deno.env.delete("WORKFLOW_RUN_ID");
    const backend = new EntrypointLifecycleBackend();

    await withDistributedProvider(backend, async () => {
      const entrypoint = await createDynamicWorkflowRunEntrypoint({});
      assertEquals(backend.initializeCalls, 1);
      assertEquals(await entrypoint(), DYNAMIC_EXIT_CODES.CONFIG_ERROR);
      assertEquals(backend.destroyCalls, 1);
      await entrypoint.destroy();
      assertEquals(backend.destroyCalls, 1);
    });
  });

  it("rolls back dynamic factory initialization and preserves cleanup failure", async () => {
    const backend = new EntrypointLifecycleBackend();
    backend.initializeError = new Error("initialization failed");
    backend.destroyError = new Error("cleanup failed");

    await withDistributedProvider(backend, async () => {
      const failure = await assertRejects(
        () => createDynamicWorkflowRunEntrypoint({}),
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
});
