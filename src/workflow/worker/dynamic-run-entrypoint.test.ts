import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRun } from "../types.ts";
import {
  DYNAMIC_EXIT_CODES,
  type DynamicWorkflowRunDependencies,
  runDynamicWorkflowRun,
  runDynamicWorkflowRunWithDependencies,
} from "./dynamic-run-entrypoint.ts";

const ENV_KEYS = [
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "VERYFRONT_TASK_ENV_JSON",
  "VERYFRONT_API_URL",
  "TENANT_PROJECT_SLUG",
  "TENANT_TOKEN",
] as const;

const savedEnv = new Map<string, string | undefined>();

function rememberEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, Deno.env.get(key));
  }
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
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: SOURCE_INTEGRATION_POLICY,
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
  onFSConfig?: (config: unknown) => void;
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
        errors: [],
        sourceIntegrationPolicy: SOURCE_INTEGRATION_POLICY,
      } as never;
    },
  };
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
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
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
      DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
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
});
