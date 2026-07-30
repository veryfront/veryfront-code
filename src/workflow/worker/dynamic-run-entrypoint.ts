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
 * - VERYFRONT_API_URL: Required Veryfront API URL
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
import { createDistributedWorkflowBackend } from "../backends/distributed.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import {
  acquireRunExecutionLock,
  captureWorkflowRunEntrypointOptions,
  createIsolatedWorkflowRuntime as defaultCreateIsolatedWorkflowRuntime,
  createWorkflowRunEntrypointHandle,
  destroyOwnedWorkflowRunEntrypointResources,
  failRunExecution,
  getFinalRunExitCode,
  getRunExecutionWorkerId,
  hydrateRunContextEnv,
  type IsolatedWorkflowRuntime,
  releaseRunExecutionLock,
  type RunExecutionLockLease,
  runWithTenantContext,
  settleWorkflowEntrypointOperation,
  type WorkflowRunEntrypoint,
} from "./shared.ts";
import { requireWorkflowApiBaseUrl, requireWorkflowContentSource } from "../source-authority.ts";

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
  /** Pre-initialized borrowed backend for workflow persistence. */
  backend: WorkflowBackend;

  /** Enable debug logging */
  debug?: boolean;
}

/** @internal Injectable runtime seams for deterministic entrypoint tests. */
export interface DynamicWorkflowRunDependencies {
  enhanceAdapterWithFS: typeof defaultEnhanceAdapterWithFS;
  discoverProjectAgentRuntime: typeof defaultDiscoverProjectAgentRuntime;
  createIsolatedWorkflowRuntime: typeof defaultCreateIsolatedWorkflowRuntime;
}

const DEFAULT_DYNAMIC_WORKFLOW_RUN_DEPENDENCIES: DynamicWorkflowRunDependencies = {
  enhanceAdapterWithFS: defaultEnhanceAdapterWithFS,
  discoverProjectAgentRuntime: defaultDiscoverProjectAgentRuntime,
  createIsolatedWorkflowRuntime: defaultCreateIsolatedWorkflowRuntime,
};

async function failDynamicWorkflowRun(
  backend: WorkflowBackend,
  runId: string,
  error: unknown,
  expectedWorkerId: string | undefined,
  lockLease: RunExecutionLockLease | undefined,
  exitCode: number,
): Promise<number> {
  try {
    await lockLease?.stop();
  } catch (heartbeatError) {
    logger.error("Lost isolated workflow startup lock:", heartbeatError);
  }
  await failRunExecution(
    backend,
    logger,
    DYNAMIC_EXIT_CODES,
    runId,
    error,
    expectedWorkerId,
    lockLease?.lockId,
  );
  return exitCode;
}

/**
 * Run a workflow run with dynamic discovery.
 *
 * The configured backend is borrowed. Its caller must initialize it before
 * invocation and remains responsible for destroying it afterward.
 *
 * This function:
 * 1. Gets the run from the configured workflow backend
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
  let expectedWorkerId: string;
  try {
    expectedWorkerId = getRunExecutionWorkerId();
  } catch (error) {
    logger.error("Invalid managed workflow execution identity:", error);
    return DYNAMIC_EXIT_CODES.CONFIG_ERROR;
  }

  if (debug) {
    logger.info(`Starting execution for run: ${runId}`);
  }

  let lockLease: RunExecutionLockLease | undefined;
  let startupLockId: string | undefined;
  let runtimeCleanupFailed = false;
  try {
    lockLease = await acquireRunExecutionLock(backend, runId, expectedWorkerId);
    startupLockId = lockLease?.lockId;
  } catch (error) {
    logger.error("Could not acquire isolated workflow execution lock:", error);
    return DYNAMIC_EXIT_CODES.WORKFLOW_FAILED;
  }

  try {
    // Fetch the workflow run
    const storedRun = await backend.getRun(runId);
    if (!storedRun) {
      logger.error(`Workflow run not found: ${runId}`);
      return DYNAMIC_EXIT_CODES.NOT_FOUND;
    }

    const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(storedRun);
    const run = await hydrateRunContextEnv(
      backend,
      runId,
      storedRun,
      expectedWorkerId,
      startupLockId,
    );

    // The durable run is the sole tenant/source authority. Process environment
    // variables are transport details and cannot replace persisted ownership.
    const tenant = run._tenant;

    if (!tenant) {
      return await failDynamicWorkflowRun(
        backend,
        runId,
        new Error("No tenant context available"),
        expectedWorkerId,
        lockLease,
        DYNAMIC_EXIT_CODES.CONFIG_ERROR,
      );
    }

    if (debug) {
      logger.info(`Executing workflow: ${run.workflowId}`);
      logger.info(`Tenant: ${tenant.projectSlug}`);
    }

    let apiUrl: string;
    let contentSource: ReturnType<typeof requireWorkflowContentSource>;
    try {
      apiUrl = requireWorkflowApiBaseUrl(getEnv("VERYFRONT_API_URL"));
      contentSource = requireWorkflowContentSource(tenant);
    } catch (error) {
      return await failDynamicWorkflowRun(
        backend,
        runId,
        error,
        expectedWorkerId,
        lockLease,
        DYNAMIC_EXIT_CODES.CONFIG_ERROR,
      );
    }

    // Execute with tenant context
    return await runWithTenantContext(
      tenant,
      async () => {
        // Set up FS adapter with Veryfront API backend
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
            lockLease,
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
            lockLease,
            DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
          );
        }

        if (discoveryResult.errors.length > 0) {
          const firstError = discoveryResult.errors[0];
          return await failDynamicWorkflowRun(
            backend,
            runId,
            new Error(
              `Project discovery was incomplete (${discoveryResult.errors.length} error${
                discoveryResult.errors.length === 1 ? "" : "s"
              })${firstError ? ` in ${firstError.file}: ${firstError.error.message}` : ""}`,
            ),
            expectedWorkerId,
            lockLease,
            DYNAMIC_EXIT_CODES.DISCOVERY_FAILED,
          );
        }

        const workflows = [...discoveryResult.workflows.values()];

        if (workflows.length === 0) {
          return await failDynamicWorkflowRun(
            backend,
            runId,
            new Error("No workflows discovered"),
            expectedWorkerId,
            lockLease,
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
            lockLease,
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
              const runtime = dependencies.createIsolatedWorkflowRuntime(
                backend,
                debug,
                {
                  agentRegistry,
                  toolRegistry,
                },
              );

              const execution = (async (): Promise<number> => {
                runtime.executor.register(workflow.definition);

                try {
                  await lockLease?.stop();
                  await runtime.executor.resume(
                    runId,
                    undefined,
                    expectedWorkerId,
                    startupLockId,
                  );
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
                    startupLockId,
                  );
                }
              })();

              return await settleWorkflowEntrypointOperation(
                execution,
                async () => {
                  try {
                    await runtime.destroy();
                  } catch (error) {
                    runtimeCleanupFailed = true;
                    throw error;
                  }
                },
                "Dynamic workflow run execution and runtime cleanup failed",
              );
            }),
        );
      },
    );
  } catch (error) {
    // Runtime cleanup is an ownership failure, not a workflow exit status. The
    // caller must see it so a managed entrypoint can retry cleanup before it
    // closes the backend borrowed by that runtime.
    if (runtimeCleanupFailed) throw error;

    try {
      await lockLease?.stop();
    } catch (heartbeatError) {
      logger.error("Lost isolated workflow startup lock:", heartbeatError);
    }
    return await failRunExecution(
      backend,
      logger,
      DYNAMIC_EXIT_CODES,
      runId,
      error,
      expectedWorkerId,
      startupLockId,
    );
  } finally {
    try {
      await lockLease?.stop();
    } catch (error) {
      logger.error("Could not stop isolated workflow startup heartbeat:", error);
    }
    try {
      await releaseRunExecutionLock(backend, runId, startupLockId);
    } catch (error) {
      logger.error("Could not release isolated workflow execution lock:", error);
    }
  }
}

/**
 * Create a dynamic workflow run entrypoint.
 *
 * This is a convenience function that resolves the explicitly activated
 * distributed backend. The returned one-shot handle owns that backend and
 * closes it after invocation; call `destroy()` when abandoning the handle.
 * Runtime-cleanup failures reject so teardown can be retried safely before the
 * backend is closed.
 *
 * @example
 * ```typescript
 * // workflow-runner.ts
 * import { createDynamicWorkflowRunEntrypoint } from "veryfront/workflow/worker";
 *
 * const run = await createDynamicWorkflowRunEntrypoint({
 * });
 *
 * const exitCode = await run();
 * if (exitCode !== 0) throw new Error(`Workflow run failed: ${exitCode}`);
 * ```
 */
export interface CreateDynamicWorkflowRunEntrypointOptions {
  /** Enable debug logging */
  debug?: boolean;
}

/** Create a dynamic workflow run entrypoint. */
export async function createDynamicWorkflowRunEntrypoint(
  options: CreateDynamicWorkflowRunEntrypointOptions,
): Promise<WorkflowRunEntrypoint> {
  return await createDynamicWorkflowRunEntrypointWithDependencies(
    options,
    DEFAULT_DYNAMIC_WORKFLOW_RUN_DEPENDENCIES,
  );
}

/** @internal Create a managed dynamic entrypoint with explicit runtime dependencies. */
export async function createDynamicWorkflowRunEntrypointWithDependencies(
  options: CreateDynamicWorkflowRunEntrypointOptions,
  dependencies: DynamicWorkflowRunDependencies,
): Promise<WorkflowRunEntrypoint> {
  const { debug } = captureWorkflowRunEntrypointOptions(
    options,
    "Dynamic workflow run entrypoint",
  );

  const backend = createDistributedWorkflowBackend({
    debug,
  });
  let retainedRuntime: IsolatedWorkflowRuntime | undefined;

  const managedDependencies: DynamicWorkflowRunDependencies = {
    ...dependencies,
    createIsolatedWorkflowRuntime(backend, debug, stepExecutorConfig) {
      const runtime = dependencies.createIsolatedWorkflowRuntime(
        backend,
        debug,
        stepExecutorConfig,
      );
      const trackedRuntime: IsolatedWorkflowRuntime = Object.freeze({
        executor: runtime.executor,
        async destroy(): Promise<void> {
          await runtime.destroy();
          if (retainedRuntime === trackedRuntime) retainedRuntime = undefined;
        },
      });
      retainedRuntime = trackedRuntime;
      return trackedRuntime;
    },
  };

  try {
    await backend.initialize?.();
  } catch (initializationError) {
    try {
      await backend.destroy();
    } catch (cleanupError) {
      throw new AggregateError(
        [initializationError, cleanupError],
        "Dynamic workflow run entrypoint initialization and cleanup failed",
      );
    }
    throw initializationError;
  }

  return createWorkflowRunEntrypointHandle(
    () =>
      runDynamicWorkflowRunWithDependencies(
        { backend, debug },
        managedDependencies,
      ),
    () => destroyOwnedWorkflowRunEntrypointResources(backend, retainedRuntime),
  );
}
