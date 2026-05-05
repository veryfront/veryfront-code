import { env as getProcessEnv } from "#veryfront/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { mergeInjectedWorkflowEnv } from "#veryfront/jobs/runtime-env.ts";
import type { WorkflowBackend } from "../backends/types.ts";
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

export function getTenantFromEnv(): CapturedTenantContext | undefined {
  const projectSlug = getEnv("TENANT_PROJECT_SLUG");
  const token = getEnv("TENANT_TOKEN");

  if (!projectSlug || !token) {
    return undefined;
  }

  return {
    projectSlug,
    token,
    projectId: getEnv("TENANT_PROJECT_ID"),
    productionMode: getEnv("TENANT_PRODUCTION_MODE") === "1",
    releaseId: getEnv("TENANT_RELEASE_ID"),
  };
}

export async function hydrateRunContextEnv(
  backend: WorkflowBackend,
  runId: string,
  run: WorkflowRun,
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

  await backend.updateRun(runId, {
    context: {
      ...run.context,
      env: injectedEnv,
    },
  });

  return (await backend.getRun(runId)) ?? run;
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
): Promise<number> {
  logger.error("Execution error:", error);

  await backend.updateRun(runId, {
    status: "failed",
    error: {
      message: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack : undefined,
    },
    completedAt: new Date(),
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
    },
    fn,
  );
}
