/**
 * Workflow run entrypoint
 *
 * Runs inside an ephemeral run execution container.
 * Executes a single workflow run in complete isolation.
 *
 * Environment variables:
 * - WORKFLOW_RUN_ID: The workflow run to execute
 * - RUN_EXECUTION_ID: Immutable execution identity assigned by the run manager
 * - TENANT_PROJECT_SLUG: Tenant's project slug
 * - TENANT_TOKEN: Tenant's API token
 * - TENANT_PROJECT_ID: Tenant's project ID
 * - TENANT_PRODUCTION_MODE: Whether running in production mode
 * - TENANT_RELEASE_ID: Current release ID (optional)
 *
 * Exit codes:
 * - 0: Workflow completed successfully
 * - 1: Workflow failed
 * - 2: Configuration error
 * - 3: Workflow not found
 */

import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { createDistributedWorkflowBackend } from "../backends/distributed.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import {
  captureWorkflowDefinitions as captureCanonicalWorkflowDefinitions,
} from "../executor/workflow-definition-snapshot.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES } from "../limits.ts";
import type { WorkflowDefinition } from "../types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import {
  acquireRunExecutionLock,
  captureExactWorkflowEntrypointRecord,
  captureWorkflowRunEntrypointOptions,
  createIsolatedWorkflowRuntime,
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
  type WorkflowRunEntrypoint,
} from "./shared.ts";

const logger = baseLogger.component("workflow-run-entrypoint");
const RUN_ENTRYPOINT_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "backend",
  "executor",
  "debug",
]);
const STATIC_ENTRYPOINT_OPTION_KEYS: ReadonlySet<string> = new Set(["workflows", "debug"]);
const ENTRYPOINT_WORKFLOW_KEYS: ReadonlySet<string> = new Set(["definition", "id", "version"]);

/**
 * Configuration for the workflow run entrypoint.
 */
export interface WorkflowRunEntrypointConfig {
  /** Pre-initialized borrowed backend for workflow persistence. */
  backend: WorkflowBackend;

  /** Borrowed workflow executor whose lifecycle remains with the caller. */
  executor: WorkflowExecutor;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Exit codes for the workflow run entrypoint.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  WORKFLOW_FAILED: 1,
  CONFIG_ERROR: 2,
  NOT_FOUND: 3,
} as const;

function captureWorkflowRunConfig(
  value: unknown,
): Readonly<
  Required<Pick<WorkflowRunEntrypointConfig, "backend" | "executor">> & {
    debug: boolean;
  }
> {
  const fields = captureExactWorkflowEntrypointRecord(
    value,
    "Workflow run entrypoint config",
    RUN_ENTRYPOINT_CONFIG_KEYS,
    ["backend", "executor"],
  );
  const backend = fields.backend;
  if (typeof backend !== "object" || backend === null || isProxyWithoutHooks(backend)) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint backend must be a non-Proxy object",
    });
  }
  const executor = fields.executor;
  if (typeof executor !== "object" || executor === null || isProxyWithoutHooks(executor)) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint executor must be a non-Proxy object",
    });
  }
  const debug = fields.debug;
  if (debug !== undefined && typeof debug !== "boolean") {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint debug must be a boolean",
    });
  }
  return Object.freeze({
    backend: backend as WorkflowBackend,
    executor: executor as WorkflowExecutor,
    debug: debug ?? false,
  });
}

/**
 * Run the workflow run entrypoint
 *
 * This function is the main entrypoint for isolated workflow execution.
 * It should be called from your container's main script.
 *
 * @example
 * ```typescript
 * // workflow-runner.ts - Container entrypoint
 * import { createDistributedWorkflowBackend, WorkflowClient } from "veryfront/workflow";
 * import { runWorkflowRun } from "veryfront/workflow/worker";
 * import { workflows } from "./workflows.ts";
 *
 * // Activate a DistributedRuntimeProvider extension before creating the backend.
 * const backend = createDistributedWorkflowBackend({});
 * const client = new WorkflowClient({
 *   backend,
 *   approval: { expirationCheckInterval: 0 },
 * });
 * let exitCode: number;
 * try {
 *   await client.initialize();
 *   for (const wf of workflows) client.register(wf);
 *   exitCode = await runWorkflowRun({ backend, executor: client.getExecutor() });
 * } finally {
 *   await client.destroy();
 * }
 * if (exitCode !== 0) throw new Error(`Workflow run failed: ${exitCode}`);
 * ```
 */
export async function runWorkflowRun(config: WorkflowRunEntrypointConfig): Promise<number> {
  const { backend, executor, debug } = captureWorkflowRunConfig(config);

  // Get workflow run ID from environment
  const runId = getEnv("WORKFLOW_RUN_ID");
  if (!runId) {
    logger.error("Missing WORKFLOW_RUN_ID environment variable");
    return EXIT_CODES.CONFIG_ERROR;
  }
  let expectedWorkerId: string;
  try {
    expectedWorkerId = getRunExecutionWorkerId();
  } catch (error) {
    logger.error("Invalid managed workflow execution identity:", error);
    return EXIT_CODES.CONFIG_ERROR;
  }

  if (debug) {
    logger.info(`Starting execution for run: ${runId}`);
  }

  let lockLease: RunExecutionLockLease | undefined;
  let startupLockId: string | undefined;
  try {
    lockLease = await acquireRunExecutionLock(backend, runId, expectedWorkerId);
    startupLockId = lockLease?.lockId;
  } catch (error) {
    logger.error("Could not acquire isolated workflow execution lock:", error);
    return EXIT_CODES.WORKFLOW_FAILED;
  }

  try {
    let run = await backend.getRun(runId);
    if (!run) {
      logger.error(`Workflow run not found: ${runId}`);
      return EXIT_CODES.NOT_FOUND;
    }

    requireWorkflowSourceIntegrationPolicy(run);
    run = await hydrateRunContextEnv(
      backend,
      runId,
      run,
      expectedWorkerId,
      startupLockId,
    );

    // Persisted run ownership is authoritative; child-process environment
    // variables cannot replace it.
    const tenant = run._tenant;

    if (debug) {
      logger.info(`Executing workflow: ${run.workflowId}`);
      logger.info(`Tenant: ${tenant?.projectSlug ?? "none"}`);
    }

    // Execute workflow and determine exit code based on final status
    const executeWorkflow = async (): Promise<number> => {
      await lockLease?.stop();
      await executor.resume(runId, undefined, expectedWorkerId, startupLockId);

      return getFinalRunExitCode(
        logger,
        EXIT_CODES,
        runId,
        await backend.getRun(runId),
        debug,
      );
    };

    // Wrapper that handles execution errors
    const safeExecute = async (): Promise<number> => {
      try {
        return await executeWorkflow();
      } catch (error) {
        return await failRunExecution(
          backend,
          logger,
          EXIT_CODES,
          runId,
          error,
          expectedWorkerId,
          startupLockId,
        );
      }
    };

    return await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => tenant ? runWithTenantContext(tenant, safeExecute) : safeExecute(),
    );
  } catch (error) {
    try {
      await lockLease?.stop();
    } catch (heartbeatError) {
      logger.error("Lost isolated workflow startup lock:", heartbeatError);
    }
    return await failRunExecution(
      backend,
      logger,
      EXIT_CODES,
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
 * Create a simple workflow run entrypoint script.
 *
 * This is a convenience function that creates the entire entrypoint with the
 * explicitly activated distributed backend and executor setup. The returned
 * one-shot handle owns those resources and closes them after invocation; call
 * `destroy()` when abandoning a handle without invoking it.
 *
 * @example
 * ```typescript
 * // workflow-runner.ts
 * import { createWorkflowRunEntrypoint } from "veryfront/workflow/worker";
 * import { workflows } from "./workflows.ts";
 *
 * const run = await createWorkflowRunEntrypoint({
 *   workflows,
 * });
 *
 * const exitCode = await run();
 * if (exitCode !== 0) throw new Error(`Workflow run failed: ${exitCode}`);
 * ```
 */
export interface CreateWorkflowRunEntrypointOptions {
  /** Non-empty workflow batch captured and validated before backend resolution. */
  workflows: Array<{ definition: WorkflowDefinition }>;

  /** Enable debug logging */
  debug?: boolean;
}

function captureEntrypointWorkflowDefinitions(
  options: Readonly<Record<string, unknown>>,
): WorkflowDefinition[] {
  const workflows = options.workflows;
  if (
    ((typeof workflows === "object" && workflows !== null) ||
      typeof workflows === "function") && isProxyWithoutHooks(workflows)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows must be a non-Proxy array",
    });
  }
  if (!Array.isArray(workflows)) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows must be an array",
    });
  }

  let keys: PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(workflows);
    lengthDescriptor = Object.getOwnPropertyDescriptor(workflows, "length");
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows could not be inspected",
      cause,
    });
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows have an invalid length",
    });
  }
  if (length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Workflow run entrypoint workflows cannot contain more than ${MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES} entries`,
    });
  }
  if (length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows must contain at least one workflow",
    });
  }
  if (keys.length !== length + 1) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow run entrypoint workflows must be dense and contain no custom properties",
    });
  }

  const definitions: WorkflowDefinition[] = [];
  for (let index = 0; index < length; index++) {
    let workflowDescriptor: PropertyDescriptor | undefined;
    try {
      workflowDescriptor = Object.getOwnPropertyDescriptor(workflows, String(index));
    } catch (cause) {
      throw INVALID_ARGUMENT.create({
        detail: `Workflow run entrypoint workflow at index ${index} could not be inspected`,
        cause,
      });
    }
    if (
      !workflowDescriptor || workflowDescriptor.enumerable !== true ||
      !("value" in workflowDescriptor)
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Workflow run entrypoint workflow at index ${index} must be an enumerable own data property`,
      });
    }
    const wrapper = captureExactWorkflowEntrypointRecord(
      workflowDescriptor.value,
      `Workflow run entrypoint workflow at index ${index}`,
      ENTRYPOINT_WORKFLOW_KEYS,
    );
    if (!Object.hasOwn(wrapper, "definition")) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Workflow run entrypoint workflow at index ${index} must contain an own definition data property`,
      });
    }
    definitions.push(wrapper.definition as WorkflowDefinition);
  }
  return captureCanonicalWorkflowDefinitions(definitions);
}

/** Create a workflow run entrypoint. */
export async function createWorkflowRunEntrypoint(
  options: CreateWorkflowRunEntrypointOptions,
): Promise<WorkflowRunEntrypoint> {
  const captured = captureWorkflowRunEntrypointOptions(
    options,
    "Workflow run entrypoint",
    STATIC_ENTRYPOINT_OPTION_KEYS,
    ["workflows"],
  );
  const definitions = captureEntrypointWorkflowDefinitions(captured.options);
  const debug = captured.debug;

  const backend = createDistributedWorkflowBackend({
    debug,
  });

  let runtime: IsolatedWorkflowRuntime | undefined;
  try {
    runtime = createIsolatedWorkflowRuntime(
      backend,
      debug,
      {
        agentRegistry,
        toolRegistry,
      },
    );
    runtime.executor.registerAll(definitions);
    await backend.initialize?.();
  } catch (initializationError) {
    try {
      await destroyOwnedWorkflowRunEntrypointResources(backend, runtime);
    } catch (cleanupError) {
      throw new AggregateError(
        [initializationError, cleanupError],
        "Workflow run entrypoint initialization and cleanup failed",
      );
    }
    throw initializationError;
  }

  const initializedRuntime = runtime;
  return createWorkflowRunEntrypointHandle(
    () =>
      runWorkflowRun({
        backend,
        executor: initializedRuntime.executor,
        debug,
      }),
    () => destroyOwnedWorkflowRunEntrypointResources(backend, initializedRuntime),
  );
}
