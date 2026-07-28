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
 * - RUN_EXECUTION_ID: Immutable execution identity assigned by the run manager
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
import {
  enhanceAdapterWithFS as defaultEnhanceAdapterWithFS,
} from "#veryfront/platform/adapters/fs/integration.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import {
  discoverProjectAgentRuntime as defaultDiscoverProjectAgentRuntime,
  runWithProjectAgentRuntime,
} from "#veryfront/agent/project/agent-runtime.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import {
  createIsolatedWorkflowExecutor,
  failRunExecution,
  getFinalRunExitCode,
  getRunExecutionWorkerId,
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

/** @internal Injectable runtime seams for deterministic entrypoint tests. */
export interface DynamicWorkflowRunDependencies {
  enhanceAdapterWithFS: typeof defaultEnhanceAdapterWithFS;
  discoverProjectAgentRuntime: typeof defaultDiscoverProjectAgentRuntime;
}

const DEFAULT_DYNAMIC_WORKFLOW_RUN_DEPENDENCIES: DynamicWorkflowRunDependencies = {
  enhanceAdapterWithFS: defaultEnhanceAdapterWithFS,
  discoverProjectAgentRuntime: defaultDiscoverProjectAgentRuntime,
};

async function failDynamicWorkflowRun(
  backend: WorkflowBackend,
  runId: string,
  error: unknown,
  expectedWorkerId: string | undefined,
  exitCode: number,
): Promise<number> {
  await failRunExecution(
    backend,
    logger,
    DYNAMIC_EXIT_CODES,
    runId,
    error,
    expectedWorkerId,
  );
  return exitCode;
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
  return await runDynamicWorkflowRunWithDependencies(
    config,
    DEFAULT_DYNAMIC_WORKFLOW_RUN_DEPENDENCIES,
  );
}

/** @internal Execute with explicit dependencies without changing the public worker surface. */
export async function runDynamicWorkflowRunWithDependencies(
  config: DynamicWorkflowRunEntrypointConfig,
  dependencies: DynamicWorkflowRunDependencies,
): Promise<number> {
  const { backend, debug = false } = config;

  // Get workflow run ID from environment
  const runId = getEnv("WORKFLOW_RUN_ID");
  if (!runId) {
    logger.error("Missing WORKFLOW_RUN_ID environment variable");
    return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
  }
  const expectedWorkerId = getRunExecutionWorkerId();

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
    const run = await hydrateRunContextEnv(backend, runId, storedRun, expectedWorkerId);

    // Get tenant context (from env or from stored run)
    const tenant = getTenantFromEnv() ?? run._tenant;

    if (!tenant) {
      return await failDynamicWorkflowRun(
        backend,
        runId,
        new Error("No tenant context available"),
        expectedWorkerId,
        DYNAMIC_EXIT_CODES.CONFIG_ERROR,
      );
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
        const contentSource = tenant.productionMode && tenant.releaseId
          ? { type: "release" as const, releaseId: tenant.releaseId }
          : tenant.productionMode && tenant.environmentName
          ? { type: "environment" as const, name: tenant.environmentName }
          : { type: "branch" as const, branch: tenant.branch ?? "main" };

        const fsConfig = {
          fs: {
            type: "veryfront-api" as const,
            veryfront: {
              apiBaseUrl: apiUrl,
              apiToken: tenant.token,
              proxyMode: false, // We're setting context directly
              projectSlug: tenant.projectSlug,
              projectId: tenant.projectId,
              contentSource,
            },
          },
        };

        let adapter;
        try {
          adapter = await dependencies.enhanceAdapterWithFS(denoAdapter, fsConfig);
        } catch (error) {
          return await failDynamicWorkflowRun(
            backend,
            runId,
            error,
            expectedWorkerId,
            DYNAMIC_EXIT_CODES.CONFIG_ERROR,
          );
        }

        if (debug) {
          logger.info("FS adapter initialized");
        }

        // Discover workflows and the project-local agent/tool registries they may reference.
        let discoveryResult;
        try {
          discoveryResult = await dependencies.discoverProjectAgentRuntime({
            projectDir: "", // Root of project (relative paths with API)
            adapter,
            fsAdapter: adapter.fs,
            cacheKey: tenant.projectId ?? tenant.projectSlug,
            verbose: debug,
            sourceIntegrationPolicy,
          });
        } catch (error) {
          return await failDynamicWorkflowRun(
            backend,
            runId,
            error,
            expectedWorkerId,
            DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
          );
        }

        if (discoveryResult.errors.length > 0 && debug) {
          logger.warn("Some workflow files failed to load:", discoveryResult.errors);
        }

        const workflows = [...discoveryResult.workflows.values()];

        if (workflows.length === 0) {
          return await failDynamicWorkflowRun(
            backend,
            runId,
            new Error("No workflows discovered"),
            expectedWorkerId,
            DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
          );
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
          logger.error(
            `[DynamicWorkflowRun] Available workflows: ${workflows.map((w) => w.id).join(", ")}`,
          );
          return await failDynamicWorkflowRun(
            backend,
            runId,
            new Error(`Workflow not found: "${run.workflowId}"`),
            expectedWorkerId,
            DYNAMIC_EXIT_CODES.NOT_FOUND,
          );
        }

        if (debug) {
          logger.info(`Found workflow "${workflow.id}"`);
        }

        return await runWithWorkflowSourceIntegrationPolicy(
          storedRun,
          () =>
            runWithProjectAgentRuntime(discoveryResult, async () => {
              const executor = createIsolatedWorkflowExecutor(
                backend,
                debug,
                {
                  agentRegistry,
                  toolRegistry,
                },
              );

              executor.register(workflow.definition);

              try {
                await executor.resume(runId, undefined, expectedWorkerId);
                return getFinalRunExitCode(
                  logger,
                  DYNAMIC_EXIT_CODES,
                  runId,
                  await backend.getRun(runId),
                  debug,
                );
              } catch (error) {
                return await failRunExecution(
                  backend,
                  logger,
                  DYNAMIC_EXIT_CODES,
                  runId,
                  error,
                  expectedWorkerId,
                );
              }
            }),
        );
      },
    );
  } catch (error) {
    return await failRunExecution(
      backend,
      logger,
      DYNAMIC_EXIT_CODES,
      runId,
      error,
      expectedWorkerId,
    );
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
