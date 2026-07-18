/**
 * Dynamic workflow run entrypoint
 *
 * Runs inside an ephemeral run execution container or process.
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

import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { enhanceAdapterWithFS } from "#veryfront/platform/adapters/fs/integration.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import {
  discoverProjectAgentRuntime,
  runWithProjectAgentRuntime,
} from "#veryfront/agent/project/agent-runtime.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import {
  failRunExecution,
  getFinalRunExitCode,
  getTenantFromEnv,
  hydrateRunContextEnv,
  runWithTenantContext,
} from "./shared.ts";

const logger = baseLogger.component("dynamic-workflow-run-entrypoint");

/**
 * Exit codes for the dynamic workflow run entrypoint.
 */
export const DYNAMIC_EXIT_CODES = {
  SUCCESS: 0,
  WORKFLOW_FAILED: 1,
  CONFIG_ERROR: 2,
  NOT_FOUND: 3,
  DISCOVERY_FAILED: 4,
} as const;

/**
 * Configuration for the dynamic workflow run entrypoint.
 */
export interface DynamicWorkflowRunEntrypointConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Run a workflow run with dynamic discovery.
 *
 * This function:
 * 1. Gets the run from Redis
 * 2. Sets up tenant context
 * 3. Initializes FS adapter with Veryfront API backend
 * 4. Discovers workflows from user's project files
 * 5. Finds the matching workflow
 * 6. Executes the workflow
 */
export async function runDynamicWorkflowRun(
  config: DynamicWorkflowRunEntrypointConfig,
): Promise<number> {
  const { backend, debug = false } = config;

  // Get workflow run ID from environment
  const runId = getEnv("WORKFLOW_RUN_ID");
  if (!runId) {
    logger.error("Missing WORKFLOW_RUN_ID environment variable");
    return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
  }

  if (debug) {
    logger.info(`Starting execution for run: ${runId}`);
  }

  try {
    // Fetch the workflow run
    const storedRun = await backend.getRun(runId);
    if (!storedRun) {
      logger.error(`Workflow run not found: ${runId}`);
      return DYNAMIC_EXIT_CODES.NOT_FOUND;
    }

    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(storedRun);
    const run = await hydrateRunContextEnv(backend, runId, storedRun);

    // Get tenant context (from env or from stored run)
    const tenant = getTenantFromEnv() ?? run._tenant;

    if (!tenant) {
      logger.error("No tenant context available");
      return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
    }

    if (debug) {
      logger.info(`Executing workflow: ${run.workflowId}`);
      logger.info(`Tenant: ${tenant.projectSlug}`);
    }

    // Execute with tenant context
    return await runWithTenantContext(
      tenant,
      async () => {
        // Set up FS adapter with Veryfront API backend
        const apiUrl = getEnv("VERYFRONT_API_URL") || "https://api.veryfront.com";

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
          logger.info("FS adapter initialized");
        }

        // Discover workflows and the project-local agent/tool registries they may reference.
        const discoveryResult = await discoverProjectAgentRuntime({
          projectDir: "", // Root of project (relative paths with API)
          adapter,
          fsAdapter: adapter.fs,
          cacheKey: tenant.projectId ?? tenant.projectSlug,
          verbose: debug,
          sourceIntegrationPolicy,
        });

        if (discoveryResult.errors.length > 0 && debug) {
          logger.warn("Some workflow files failed to load:", discoveryResult.errors);
        }

        const workflows = [...discoveryResult.workflows.values()];

        if (workflows.length === 0) {
          logger.error("No workflows discovered");
          return DYNAMIC_EXIT_CODES.DISCOVERY_FAILED;
        }

        if (debug) {
          logger.info(
            `[DynamicWorkflowRun] Discovered ${workflows.length} workflows:`,
            workflows.map((w) => w.id),
          );
        }

        // Find the matching workflow
        const workflow = workflows.find((w) => w.id === run.workflowId);
        if (!workflow) {
          logger.error(`Workflow not found: ${run.workflowId}`);
          logger.error(
            `[DynamicWorkflowRun] Available workflows: ${workflows.map((w) => w.id).join(", ")}`,
          );
          return DYNAMIC_EXIT_CODES.NOT_FOUND;
        }

        if (debug) {
          logger.info(`Found workflow "${workflow.id}"`);
        }

        return await runWithWorkflowSourceIntegrationPolicy(
          storedRun,
          () =>
            runWithProjectAgentRuntime(discoveryResult, async () => {
              const executor = new WorkflowExecutor({
                backend,
                debug,
                stepExecutor: {
                  agentRegistry,
                  toolRegistry,
                },
              });

              executor.register(workflow.definition);

              try {
                await executor.resume(runId);
                return getFinalRunExitCode(
                  logger,
                  DYNAMIC_EXIT_CODES,
                  runId,
                  await backend.getRun(runId),
                  debug,
                );
              } catch (error) {
                return await failRunExecution(backend, logger, DYNAMIC_EXIT_CODES, runId, error);
              }
            }),
        );
      },
    );
  } catch (error) {
    return await failRunExecution(backend, logger, DYNAMIC_EXIT_CODES, runId, error);
  }
}

/**
 * Create a dynamic workflow run entrypoint.
 *
 * This is a convenience function that sets up Redis backend
 * and returns a function to run the workflow run.
 *
 * @example
 * ```typescript
 * // workflow-runner.ts
 * import { createDynamicWorkflowRunEntrypoint } from "veryfront/workflow/worker";
 * import { getEnv } from "veryfront";
 *
 * const run = await createDynamicWorkflowRunEntrypoint({
 *   redisUrl: getEnv("REDIS_URL")!,
 * });
 *
 * const exitCode = await run();
 * if (exitCode !== 0) throw new Error(`Workflow run failed: ${exitCode}`);
 * ```
 */
export interface CreateDynamicWorkflowRunEntrypointOptions {
  /** Redis URL for backend */
  redisUrl: string;

  /** Enable debug logging */
  debug?: boolean;
}

/** Create a dynamic workflow run entrypoint. */
export async function createDynamicWorkflowRunEntrypoint(
  options: CreateDynamicWorkflowRunEntrypointOptions,
): Promise<() => Promise<number>> {
  // Dynamic import to avoid loading Redis if not needed
  const { RedisBackend } = await import("../backends/redis.ts");

  const backend = new RedisBackend({
    url: options.redisUrl,
    debug: options.debug,
  });

  return () =>
    runDynamicWorkflowRun({
      backend,
      debug: options.debug,
    });
}
