/**
 * Workflow Job Entrypoint
 *
 * Runs inside an ephemeral K8s Job container.
 * Executes a single workflow run in complete isolation.
 *
 * Environment variables:
 * - WORKFLOW_RUN_ID: The workflow run to execute
 * - TENANT_PROJECT_SLUG: Tenant's project slug
 * - TENANT_TOKEN: Tenant's API token
 * - TENANT_PROJECT_ID: Tenant's project ID
 * - TENANT_PRODUCTION_MODE: Whether running in production mode
 * - TENANT_RELEASE_ID: Current release ID (optional)
 * - REDIS_URL: Redis connection URL
 *
 * Exit codes:
 * - 0: Workflow completed successfully
 * - 1: Workflow failed
 * - 2: Configuration error
 * - 3: Workflow not found
 */

import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { CapturedTenantContext, WorkflowDefinition } from "../types.ts";

const logger = baseLogger.component("workflow-job");

/**
 * Configuration for the job entrypoint
 */
export interface JobEntrypointConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

  /** Workflow executor */
  executor: WorkflowExecutor;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Exit codes for the job
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  WORKFLOW_FAILED: 1,
  CONFIG_ERROR: 2,
  NOT_FOUND: 3,
} as const;

/**
 * Get tenant context from environment variables
 */
function getTenantFromEnv(): CapturedTenantContext | undefined {
  const projectSlug = getEnv("TENANT_PROJECT_SLUG");
  const token = getEnv("TENANT_TOKEN");

  if (!projectSlug || !token) {
    return undefined;
  }

  return {
    projectSlug,
    token,
    projectId: getEnv("TENANT_PROJECT_ID") || undefined,
    productionMode: getEnv("TENANT_PRODUCTION_MODE") === "1",
    releaseId: getEnv("TENANT_RELEASE_ID") || undefined,
  };
}

/**
 * Run the workflow job
 *
 * This function is the main entrypoint for workflow execution in a K8s Job.
 * It should be called from your container's main script.
 *
 * @example
 * ```typescript
 * // job-main.ts - Container entrypoint
 * import { RedisBackend } from "veryfront/workflow";
 * import { WorkflowExecutor } from "veryfront/workflow";
 * import { runWorkflowJob } from "veryfront/workflow/worker";
 * import { workflows } from "./workflows.ts";
 *
 * const backend = new RedisBackend({ url: Deno.env.get("REDIS_URL")! });
 * const executor = new WorkflowExecutor({ backend });
 *
 * // Register all workflows
 * for (const wf of workflows) {
 *   executor.register(wf);
 * }
 *
 * // Run the job
 * const exitCode = await runWorkflowJob({ backend, executor });
 * Deno.exit(exitCode);
 * ```
 */
export async function runWorkflowJob(config: JobEntrypointConfig): Promise<number> {
  const { backend, executor, debug = false } = config;

  // Get workflow run ID from environment
  const runId = getEnv("WORKFLOW_RUN_ID");
  if (!runId) {
    logger.error("Missing WORKFLOW_RUN_ID environment variable");
    return EXIT_CODES.CONFIG_ERROR;
  }

  if (debug) {
    logger.info(`Starting execution for run: ${runId}`);
  }

  try {
    // Fetch the workflow run
    const run = await backend.getRun(runId);
    if (!run) {
      logger.error(`Workflow run not found: ${runId}`);
      return EXIT_CODES.NOT_FOUND;
    }

    // Get tenant context (from env or from stored run)
    const tenant = getTenantFromEnv() ?? run._tenant;

    if (debug) {
      logger.info(`Executing workflow: ${run.workflowId}`);
      logger.info(`Tenant: ${tenant?.projectSlug ?? "none"}`);
    }

    // Execute workflow and determine exit code based on final status
    const executeWorkflow = async (): Promise<number> => {
      await executor.resume(runId);

      const finalRun = await backend.getRun(runId);
      const status = finalRun?.status;

      switch (status) {
        case "completed":
          if (debug) {
            logger.info(`Workflow completed successfully: ${runId}`);
          }
          return EXIT_CODES.SUCCESS;

        case "failed":
          logger.error(`Workflow failed: ${runId}`, finalRun?.error);
          return EXIT_CODES.WORKFLOW_FAILED;

        case "waiting":
          if (debug) {
            logger.info(`Workflow paused (waiting): ${runId}`);
          }
          return EXIT_CODES.SUCCESS;

        default:
          logger.warn(`Unexpected final status: ${status}`);
          return EXIT_CODES.SUCCESS;
      }
    };

    // Wrapper that handles execution errors
    const safeExecute = async (): Promise<number> => {
      try {
        return await executeWorkflow();
      } catch (error) {
        logger.error(`Execution error:`, error);

        await backend.updateRun(runId, {
          status: "failed",
          error: {
            message: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            stack: error instanceof Error ? error.stack : undefined,
          },
          completedAt: new Date(),
        });

        return EXIT_CODES.WORKFLOW_FAILED;
      }
    };

    // Run with tenant context if available
    if (tenant) {
      return await runWithRequestContext(
        {
          projectSlug: tenant.projectSlug,
          token: tenant.token,
          projectId: tenant.projectId,
          productionMode: tenant.productionMode,
          releaseId: tenant.releaseId,
        },
        safeExecute,
      );
    }

    return await safeExecute();
  } catch (error) {
    logger.error(`Fatal error:`, error);
    return EXIT_CODES.WORKFLOW_FAILED;
  }
}

/**
 * Create a simple job entrypoint script
 *
 * This is a convenience function that creates the entire entrypoint
 * with Redis backend and executor setup.
 *
 * @example
 * ```typescript
 * // job-main.ts
 * import { createJobEntrypoint } from "veryfront/workflow/worker";
 * import { workflows } from "./workflows.ts";
 *
 * const run = createJobEntrypoint({
 *   redisUrl: Deno.env.get("REDIS_URL")!,
 *   workflows,
 * });
 *
 * const exitCode = await run();
 * Deno.exit(exitCode);
 * ```
 */
export interface CreateJobEntrypointOptions {
  /** Redis URL for backend */
  redisUrl: string;

  /** Workflows to register */
  workflows: Array<{ definition: WorkflowDefinition }>;

  /** Enable debug logging */
  debug?: boolean;
}

export async function createJobEntrypoint(
  options: CreateJobEntrypointOptions,
): Promise<() => Promise<number>> {
  // Dynamic imports to avoid loading Redis if not needed
  const { RedisBackend } = await import("../backends/redis.ts");
  const { WorkflowExecutor } = await import("../executor/workflow-executor.ts");

  const backend = new RedisBackend({
    url: options.redisUrl,
    debug: options.debug,
  });

  const executor = new WorkflowExecutor({
    backend,
    debug: options.debug,
  });

  // Register workflows
  for (const wf of options.workflows) {
    executor.register(wf.definition);
  }

  return () =>
    runWorkflowJob({
      backend,
      executor,
      debug: options.debug,
    });
}
