import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { WorkflowRun } from "../types.ts";
import { DYNAMIC_EXIT_CODES, runDynamicWorkflowRun } from "./dynamic-run-entrypoint.ts";

const ENV_KEYS = [
  "WORKFLOW_RUN_ID",
  "RUN_EXECUTION_ID",
  "VERYFRONT_TASK_ENV_JSON",
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

class DeleteOnHydrateBackend extends MemoryBackend {
  override async updateRunIfStatusAndWorker(
    runId: string,
    _expectedStatuses: WorkflowRun["status"][],
    _expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    if (patch.context?.env) await this.deleteRun(runId);
    return false;
  }
}

describe("runDynamicWorkflowRun", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("stops before tenant setup when the run is deleted during env hydration", async () => {
    rememberEnv();
    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");

    const backend = new DeleteOnHydrateBackend();
    const run: WorkflowRun = {
      id: "run-dynamic-hydrate-deleted",
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
      workerId: "run-execution:hydrate-deleted",
    };
    await backend.createRun(run);

    Deno.env.set("WORKFLOW_RUN_ID", run.id);
    Deno.env.set("RUN_EXECUTION_ID", "hydrate-deleted");
    Deno.env.set("VERYFRONT_TASK_ENV_JSON", JSON.stringify({ MODE: "new" }));

    assertEquals(
      await runDynamicWorkflowRun({ backend }),
      DYNAMIC_EXIT_CODES.NOT_FOUND,
    );
    assertEquals(await backend.getRun(run.id), null);
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

  it("maps a vanished run to the NOT_FOUND exit code", async () => {
    rememberEnv();
    Deno.env.delete("RUN_EXECUTION_ID");
    Deno.env.delete("VERYFRONT_TASK_ENV_JSON");
    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");

    const backend = new MemoryBackend();
    Deno.env.set("WORKFLOW_RUN_ID", "run-never-created");

    assertEquals(
      await runDynamicWorkflowRun({ backend }),
      DYNAMIC_EXIT_CODES.NOT_FOUND,
      "a missing run must be distinguishable from a misconfigured container",
    );

    Deno.env.delete("WORKFLOW_RUN_ID");

    assertEquals(
      await runDynamicWorkflowRun({ backend }),
      DYNAMIC_EXIT_CODES.CONFIG_ERROR,
      "a missing run id is a config error, not a missing run",
    );
  });
});
