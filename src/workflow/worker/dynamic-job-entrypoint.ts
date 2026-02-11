/**
 * Dynamic Workflow Job Entrypoint
 *
 * Runs inside an ephemeral K8s Job or process container.
 * Dynamically discovers and loads workflow definitions from the user's project
 * using the Veryfront API backend.
 *
 * This is the recommended entrypoint for multi-tenant deployments where
 * user code is stored in the Veryfront API and not bundled into the container.
 *
 * Environment variables:
 * - WORKFLOW_RUN_ID: The workflow run to execute
 * - TENANT_PROJECT_SLUG: Tenant's project slug
 * - TENANT_TOKEN: Tenant's API token
 * - TENANT_PROJECT_ID: Tenant's project ID
 * - TENANT_PRODUCTION_MODE: Whether running in production mode
 * - TENANT_RELEASE_ID: Current release ID (optional)
 * - REDIS_URL: Redis connection URL
 * - VERYFRONT_API_URL: Veryfront API URL (default: https://api.veryfront.com)
 *
 * Exit codes:
 * - 0: Workflow completed successfully
 * - 1: Workflow failed
 * - 2: Configuration error
 * - 3: Workflow not found
 */

import { logger } from "#veryfront/utils";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { discoverWorkflows } from "../discovery/index.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { CapturedTenantContext } from "../types.ts";

const log = logger.component("dynamic-job");

/**
 * Exit codes for the job
 */
export const DYNAMIC_EXIT_CODES = {
  SUCCESS: 0,
  WORKFLOW_FAILED: 1,
  CONFIG_ERROR: 2,
  NOT_FOUND: 3,
  DISCOVERY_FAILED: 4,
} as const;

/**
 * Configuration for the dynamic job entrypoint
 */
export interface DynamicJobEntrypointConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Get tenant context from environment variables
 */
function getTenantFromEnv(): CapturedTenantContext | undefined {
  const projectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
  const token = Deno.env.get("TENANT_TOKEN");

  if (!projectSlug || !token) {
    return undefined;
  }

  return {
    projectSlug,
    token,
    projectId: Deno.env.get("TENANT_PROJECT_ID"),
    productionMode: Deno.env.get("TENANT_PRODUCTION_MODE") === "1",
    releaseId: Deno.env.get("TENANT_RELEASE_ID") || undefined,
  };
}

/**
 * Run a workflow job with dynamic discovery
 *
 * This function:
 * 1. Gets the run from Redis
 * 2. Sets up tenant context
 * 3. Initializes FS adapter with Veryfront API backend
 * 4. Discovers workflows from user's project files
 * 5. Finds the matching workflow
 * 6. Executes the workflow
 */
export async function runDynamicWorkflowJob(
  config: DynamicJobEntrypointConfig,
): Promise<number> {
  const { backend, debug = false } = config;

  // Get workflow run ID from environment
  const runId = Deno.env.get("WORKFLOW_RUN_ID");
  if (!runId) {
    log.error("Missing WORKFLOW_RUN_ID environment variable");
    return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
  }

  if (debug) {
    log.info(`Starting execution for run: ${runId}`);
  }

  try {
    // Fetch the workflow run
    const run = await backend.getRun(runId);
    if (!run) {
      log.error(`Workflow run not found: ${runId}`);
      return DYNAMIC_EXIT_CODES.NOT_FOUND;
    }

    // Get tenant context (from env or from stored run)
    const tenant = getTenantFromEnv() ?? run._tenant;

    if (!tenant) {
      log.error("No tenant context available");
      return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
    }

    if (debug) {
      log.info(`Executing workflow: ${run.workflowId}`);
      log.info(`Tenant: ${tenant.projectSlug}`);
    }

    // Execute with tenant context
    return await runWithRequestContext(
      {
        projectSlug: tenant.projectSlug,
        token: tenant.token,
        projectId: tenant.projectId,
        productionMode: tenant.productionMode,
        releaseId: tenant.releaseId,
      },
      async () => {
        // Set up FS adapter with Veryfront API backend
        const apiUrl = Deno.env.get("VERYFRONT_API_URL") || "https://api.veryfront.com";

        const fsConfig = {
          fs: {
            type: "veryfront-api" as const,
            veryfront: {
              baseUrl: apiUrl,
              proxyMode: false, // We're setting context directly
              projectSlug: tenant.projectSlug,
            },
          },
        };

        const adapter = await enhanceAdapterWithFS(denoAdapter, fsConfig);

        if (debug) {
          log.info("FS adapter initialized");
        }

        // Discover workflows from user's project
        const discoveryResult = await discoverWorkflows({
          projectDir: "", // Root of project (relative paths with API)
          adapter,
          config: fsConfig as any,
          debug,
        });

        if (discoveryResult.errors.length > 0 && debug) {
          log.warn("Some workflow files failed to load:", discoveryResult.errors);
        }

        if (discoveryResult.workflows.length === 0) {
          log.error("No workflows discovered");
          return DYNAMIC_EXIT_CODES.DISCOVERY_FAILED;
        }

        if (debug) {
          logger.info(
            `[DynamicJob] Discovered ${discoveryResult.workflows.length} workflows:`,
            discoveryResult.workflows.map((w) => w.id),
          );
        }

        // Find the matching workflow
        const workflow = discoveryResult.workflows.find((w) => w.id === run.workflowId);
        if (!workflow) {
          log.error(`Workflow not found: ${run.workflowId}`);
          logger.error(
            `[DynamicJob] Available workflows: ${
              discoveryResult.workflows.map((w) => w.id).join(", ")
            }`,
          );
          return DYNAMIC_EXIT_CODES.NOT_FOUND;
        }

        if (debug) {
          log.info(`Found workflow "${workflow.id}" at ${workflow.filePath}`);
        }

        // Create executor and register the workflow
        const executor = new WorkflowExecutor({
          backend,
          debug,
        });

        executor.register(workflow.definition);

        // Execute the workflow
        try {
          await executor.resume(runId);

          const finalRun = await backend.getRun(runId);
          const status = finalRun?.status;

          switch (status) {
            case "completed":
              if (debug) {
                log.info(`Workflow completed successfully: ${runId}`);
              }
              return DYNAMIC_EXIT_CODES.SUCCESS;

            case "failed":
              log.error(`Workflow failed: ${runId}`, finalRun?.error);
              return DYNAMIC_EXIT_CODES.WORKFLOW_FAILED;

            case "waiting":
              if (debug) {
                log.info(`Workflow paused (waiting): ${runId}`);
              }
              return DYNAMIC_EXIT_CODES.SUCCESS;

            default:
              log.warn(`Unexpected final status: ${status}`);
              return DYNAMIC_EXIT_CODES.SUCCESS;
          }
        } catch (error) {
          log.error("Execution error:", error);

          await backend.updateRun(runId, {
            status: "failed",
            error: {
              message: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
              stack: error instanceof Error ? error.stack : undefined,
            },
            completedAt: new Date(),
          });

          return DYNAMIC_EXIT_CODES.WORKFLOW_FAILED;
        }
      },
    );
  } catch (error) {
    log.error("Fatal error:", error);
    return DYNAMIC_EXIT_CODES.WORKFLOW_FAILED;
  }
}

/**
 * Create a dynamic job entrypoint
 *
 * This is a convenience function that sets up Redis backend
 * and returns a function to run the job.
 *
 * @example
 * ```typescript
 * // job-main.ts
 * import { createDynamicJobEntrypoint } from "veryfront/workflow/worker";
 *
 * const run = await createDynamicJobEntrypoint({
 *   redisUrl: Deno.env.get("REDIS_URL")!,
 * });
 *
 * const exitCode = await run();
 * Deno.exit(exitCode);
 * ```
 */
export interface CreateDynamicJobEntrypointOptions {
  /** Redis URL for backend */
  redisUrl: string;

  /** Enable debug logging */
  debug?: boolean;
}

export async function createDynamicJobEntrypoint(
  options: CreateDynamicJobEntrypointOptions,
): Promise<() => Promise<number>> {
  // Dynamic import to avoid loading Redis if not needed
  const { RedisBackend } = await import("../backends/redis.ts");

  const backend = new RedisBackend({
    url: options.redisUrl,
    debug: options.debug,
  });

  return () =>
    runDynamicWorkflowJob({
      backend,
      debug: options.debug,
    });
}
