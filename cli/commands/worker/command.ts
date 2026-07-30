/**
 * Worker command - Start workflow run worker
 *
 * Polls the explicitly selected distributed backend for pending/stalled runs
 * as isolated processes. Supports multi-tenant execution: each run runs with
 * its own tenant context captured at workflow creation time.
 */

import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { cliLogger, exitProcess, registerTerminationSignals, showHeader } from "#cli/utils";
import {
  orchestrateExtensions as orchestrateProjectExtensions,
  type OrchestrateOptions,
} from "veryfront/extensions";
import { hasWorkerSupport, type WorkflowBackend } from "../../../src/workflow/backends/types.ts";
import type {
  ManagerStats,
  WorkflowRunManagerConfig,
} from "../../../src/workflow/worker/run-manager.ts";
import type { RunExecutor } from "../../../src/workflow/worker/executors/types.ts";
import type { WorkerArgs } from "./handler.ts";

export interface WorkerOptions extends WorkerArgs {}

interface ExtensionLifecycle {
  teardownAll(): Promise<void>;
}

interface WorkflowWorkerManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  getManagerId(): string;
  getStats(): ManagerStats;
}

interface ProcessExecutorOptions {
  entrypointPath: string;
  cwd: string;
  debug: boolean;
}

interface DistributedWorkflowWorkerResources {
  readonly backend: WorkflowBackend;
  readonly environment: Readonly<Record<string, string>>;
}

export interface StartWorkflowWorkerDependencies {
  orchestrateExtensions?: (
    options: OrchestrateOptions,
  ) => Promise<ExtensionLifecycle>;
  createDistributedWorkflowWorkerResources?: (
    options: { debug?: boolean },
  ) =>
    | DistributedWorkflowWorkerResources
    | Promise<DistributedWorkflowWorkerResources>;
  createProcessRunExecutor?: (
    options: ProcessExecutorOptions,
  ) => RunExecutor | Promise<RunExecutor>;
  createWorkflowRunManager?: (
    options: WorkflowRunManagerConfig,
  ) => WorkflowWorkerManager | Promise<WorkflowWorkerManager>;
}

export interface WorkflowWorkerRuntime {
  getManagerId(): string;
  getStats(): ManagerStats;
  stop(): Promise<void>;
}

interface WorkerCleanupState {
  managerStopped: boolean;
  backendDestroyed: boolean;
  extensionsTornDown: boolean;
}

async function cleanupStartedWorker(
  manager: WorkflowWorkerManager,
  backend: WorkflowBackend,
  extensionLoader: ExtensionLifecycle,
  state: WorkerCleanupState,
): Promise<void> {
  const failures: unknown[] = [];

  if (!state.managerStopped) {
    try {
      await manager.stop();
      state.managerStopped = true;
    } catch (error) {
      failures.push(error);
    }
  }

  if (!state.backendDestroyed) {
    try {
      await backend.destroy();
      state.backendDestroyed = true;
    } catch (error) {
      failures.push(error);
    }
  }

  if (!state.extensionsTornDown) {
    try {
      await extensionLoader.teardownAll();
      state.extensionsTornDown = true;
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Workflow worker cleanup failed");
  }
}

async function rollbackWorkerStartup(
  startupError: unknown,
  manager: WorkflowWorkerManager | undefined,
  executor: RunExecutor | undefined,
  backend: WorkflowBackend | undefined,
  extensionLoader: ExtensionLifecycle,
): Promise<never> {
  const failures: unknown[] = [startupError];
  let managerOwnsExecutor = false;

  if (manager) {
    managerOwnsExecutor = manager.getStats().status !== "idle";
    try {
      await manager.stop();
    } catch (error) {
      failures.push(error);
    }
  }

  if (!managerOwnsExecutor && executor?.destroy) {
    try {
      await executor.destroy();
    } catch (error) {
      failures.push(error);
    }
  }

  if (backend) {
    try {
      await backend.destroy();
    } catch (error) {
      failures.push(error);
    }
  }

  try {
    await extensionLoader.teardownAll();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) throw startupError;
  throw new AggregateError(
    failures,
    "Workflow worker startup failed and rollback was incomplete",
  );
}

/** Activate project extensions and start a provider-neutral workflow worker. */
export async function startWorkflowWorker(
  options: WorkerOptions,
  project: { projectDir: string; config: OrchestrateOptions["config"] },
  dependencies: StartWorkflowWorkerDependencies = {},
): Promise<WorkflowWorkerRuntime> {
  const orchestrateExtensions = dependencies.orchestrateExtensions ??
    orchestrateProjectExtensions;
  const extensionLoader = await orchestrateExtensions({
    projectDir: project.projectDir,
    config: project.config,
    logger: cliLogger,
  });

  let backend: WorkflowBackend | undefined;
  let executor: RunExecutor | undefined;
  let manager: WorkflowWorkerManager | undefined;

  try {
    const createResources = dependencies.createDistributedWorkflowWorkerResources ??
      (await import("../../../src/workflow/backends/distributed.ts"))
        .createDistributedWorkflowWorkerResources;
    const resources = await createResources({ debug: options.debug });
    backend = resources.backend;
    if (!hasWorkerSupport(backend)) {
      throw new TypeError(
        "The activated distributed provider does not implement the atomic workflow worker contract",
      );
    }
    await backend.initialize?.();

    const createExecutor = dependencies.createProcessRunExecutor ??
      (async (executorOptions: ProcessExecutorOptions) => {
        const { ProcessRunExecutor } = await import(
          "../../../src/workflow/worker/executors/process.ts"
        );
        return new ProcessRunExecutor(executorOptions);
      });
    executor = await createExecutor({
      entrypointPath: options.entrypoint ?? "./workflow-run.ts",
      cwd: project.projectDir,
      debug: options.debug,
    });

    const createManager = dependencies.createWorkflowRunManager ??
      (async (managerOptions: WorkflowRunManagerConfig) => {
        const { WorkflowRunManager } = await import(
          "../../../src/workflow/worker/run-manager.ts"
        );
        return new WorkflowRunManager(managerOptions);
      });
    manager = await createManager({
      backend,
      executor,
      pollInterval: options.pollInterval,
      maxConcurrentExecutions: options.concurrency,
      stalledThreshold: options.stalledThreshold,
      env: resources.environment,
      debug: options.debug,
    });
    await manager.start();
  } catch (error) {
    return await rollbackWorkerStartup(
      error,
      manager,
      executor,
      backend,
      extensionLoader,
    );
  }

  if (!manager || !backend) {
    return await rollbackWorkerStartup(
      new Error("Workflow worker startup completed without owned runtime resources"),
      manager,
      executor,
      backend,
      extensionLoader,
    );
  }

  const startedManager = manager;
  const startedBackend = backend;
  const cleanupState: WorkerCleanupState = {
    managerStopped: false,
    backendDestroyed: false,
    extensionsTornDown: false,
  };
  let stopAttempt: Promise<void> | undefined;

  return {
    getManagerId: () => startedManager.getManagerId(),
    getStats: () => startedManager.getStats(),
    stop() {
      if (
        cleanupState.managerStopped &&
        cleanupState.backendDestroyed &&
        cleanupState.extensionsTornDown
      ) {
        return Promise.resolve();
      }
      if (stopAttempt) return stopAttempt;

      const attempt = cleanupStartedWorker(
        startedManager,
        startedBackend,
        extensionLoader,
        cleanupState,
      );
      const trackedAttempt = attempt.finally(() => {
        if (stopAttempt === trackedAttempt) stopAttempt = undefined;
      });
      stopAttempt = trackedAttempt;
      return stopAttempt;
    },
  };
}

export async function workerCommand(options: WorkerOptions): Promise<void> {
  showHeader();

  const projectDir = options.projectDir ?? Deno.cwd();
  await withProjectSourceContext(projectDir, async ({ config }) => {
    cliLogger.info("Starting workflow worker...");
    cliLogger.info("  Backend:     distributed extension");
    cliLogger.info(`  Executor:    ${options.executor}`);
    cliLogger.info(`  Concurrency: ${options.concurrency}`);
    cliLogger.info(`  Poll:        ${options.pollInterval}ms`);
    cliLogger.info(`  Project:     ${projectDir}`);

    const runtime = await startWorkflowWorker(options, { projectDir, config });

    cliLogger.info(
      `Workflow worker started (manager: ${runtime.getManagerId()})`,
    );
    cliLogger.info("Polling for workflow runs...\n");

    let shuttingDown = false;
    const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;

      cliLogger.info(`\nReceived ${signal}, shutting down worker...`);
      let exitCode = 0;
      try {
        await runtime.stop();
        cliLogger.info("Worker stopped.");
      } catch (error) {
        exitCode = 1;
        cliLogger.warn("Workflow worker cleanup failed:", error);
      }

      const stats = runtime.getStats();
      cliLogger.info(
        `  Runs: ${stats.executionsCreated} created, ${stats.executionsCompleted} completed, ${stats.executionsFailed} failed`,
      );
      exitProcess(exitCode);
    };

    registerTerminationSignals((signal) => shutdown(signal));

    // The signal handler owns normal shutdown. Keep the command pending so the
    // CLI's top-level success exit cannot terminate the worker prematurely.
    await new Promise(() => {});
  });
}
