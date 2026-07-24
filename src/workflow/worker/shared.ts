import { env as getProcessEnv } from "#veryfront/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { mergeInjectedWorkflowEnv } from "#veryfront/runs/runtime-env.ts";
import { WorkflowClient } from "../api/workflow-client.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type { StepExecutorConfig } from "../executor/step-executor.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { reconcileWorkflowRunControl } from "../runtime/workflow-run-control.ts";
import type { CapturedTenantContext, WorkflowRun } from "../types.ts";

interface EntrypointLogger {
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

interface EntrypointExitCodes {
  SUCCESS: number;
  WORKFLOW_FAILED: number;
}

/** Return the immutable worker owner assigned to this isolated run execution. */
export function getRunExecutionWorkerId(): string | undefined {
  const executionId = getEnv("RUN_EXECUTION_ID");
  return executionId ? `run-execution:${executionId}` : undefined;
}

/** Create an isolated executor with durable approval handling and no background timer. */
export function createIsolatedWorkflowExecutor(
  backend: WorkflowBackend,
  debug = false,
  stepExecutor?: StepExecutorConfig,
): WorkflowExecutor {
  const client = new WorkflowClient({
    backend,
    debug,
    executor: stepExecutor ? { stepExecutor } : undefined,
    approval: { expirationCheckInterval: 0 },
  });
  return client.getExecutor();
}

export function getTenantFromEnv(): CapturedTenantContext | undefined {
  const projectSlug = getEnv("TENANT_PROJECT_SLUG");
  const token = getEnv("TENANT_TOKEN");
  const branch = getEnv("VERYFRONT_BRANCH_REF") || getEnv("TENANT_BRANCH_ID");
  const environmentName = getEnv("VERYFRONT_ENVIRONMENT_NAME") ||
    getEnv("TENANT_ENVIRONMENT_NAME");

  if (!projectSlug || !token) {
    return undefined;
  }

  return {
    projectSlug,
    token,
    projectId: getEnv("TENANT_PROJECT_ID"),
    productionMode: getEnv("TENANT_PRODUCTION_MODE") === "1",
    releaseId: getEnv("TENANT_RELEASE_ID"),
    ...(branch ? { branch } : {}),
    ...(environmentName ? { environmentName } : {}),
  };
}

export async function hydrateRunContextEnv(
  backend: WorkflowBackend,
  runId: string,
  run: WorkflowRun,
  expectedWorkerId?: string,
): Promise<WorkflowRun> {
  const injectedEnv = mergeInjectedWorkflowEnv(run.context.env, getProcessEnv());
  if (!injectedEnv) {
    return run;
  }

  const currentSerialized = run.context.env ? JSON.stringify(run.context.env) : "";
  const nextSerialized = JSON.stringify(injectedEnv);
  if (currentSerialized === nextSerialized) {
    return run;
  }

  const outcome = await reconcileWorkflowRunControl({
    backend,
    operation: {
      type: "hydrate-env",
      run,
      env: injectedEnv,
      expectedWorkerId,
    },
  });
  return outcome.run ?? (await backend.getRun(runId)) ?? run;
}

export function getFinalRunExitCode(
  logger: EntrypointLogger,
  exitCodes: EntrypointExitCodes,
  runId: string,
  finalRun: WorkflowRun | null,
  debug = false,
): number {
  switch (finalRun?.status) {
    case "completed":
      if (debug) {
        logger.info(`Workflow completed successfully: ${runId}`);
      }
      return exitCodes.SUCCESS;

    case "failed":
      logger.error(`Workflow failed: ${runId}`, finalRun.error);
      return exitCodes.WORKFLOW_FAILED;

    case "waiting":
      if (debug) {
        logger.info(`Workflow paused (waiting): ${runId}`);
      }
      return exitCodes.SUCCESS;

    default:
      logger.warn(`Unexpected final status: ${finalRun?.status}`);
      return exitCodes.SUCCESS;
  }
}

export async function failRunExecution(
  backend: WorkflowBackend,
  logger: EntrypointLogger,
  exitCodes: EntrypointExitCodes,
  runId: string,
  error: unknown,
  expectedWorkerId?: string,
): Promise<number> {
  logger.error("Execution error:", error);

  await reconcileWorkflowRunControl({
    backend,
    operation: {
      type: "fail-execution",
      runId,
      error,
      expectedWorkerId,
    },
  });

  return exitCodes.WORKFLOW_FAILED;
}

export function runWithTenantContext<T>(
  tenant: CapturedTenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    {
      projectSlug: tenant.projectSlug,
      token: tenant.token,
      projectId: tenant.projectId,
      productionMode: tenant.productionMode,
      releaseId: tenant.releaseId,
      branch: tenant.branch,
      environmentName: tenant.environmentName,
    },
    fn,
  );
}
