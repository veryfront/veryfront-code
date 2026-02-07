/**
 * Worker command - Start workflow job manager
 *
 * Polls Redis for pending/stalled workflow runs and executes them
 * as isolated processes. Supports multi-tenant execution: each job
 * runs with its own tenant context captured at workflow creation time.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess, registerTerminationSignals, showLogo } from "#cli/utils";
import type { WorkerArgs } from "./handler.ts";

export interface WorkerOptions extends WorkerArgs {}

export async function workerCommand(options: WorkerOptions): Promise<void> {
  showLogo();

  const { WorkflowJobManager } = await import(
    "../../../src/workflow/worker/job-manager.ts"
  );
  const { ProcessJobExecutor } = await import(
    "../../../src/workflow/worker/executors/process.ts"
  );
  const { RedisBackend } = await import(
    "../../../src/workflow/backends/redis.ts"
  );

  cliLogger.info("Starting workflow worker...");
  cliLogger.info(`  Redis:       ${options.redisUrl}`);
  cliLogger.info(`  Executor:    ${options.executor}`);
  cliLogger.info(`  Concurrency: ${options.concurrency}`);
  cliLogger.info(`  Poll:        ${options.pollInterval}ms`);

  // Initialize Redis backend
  const backend = new RedisBackend({
    url: options.redisUrl,
    debug: options.debug,
  });

  if (backend.initialize) {
    await backend.initialize();
  }

  // Create job executor
  // The entrypoint script runs inside each spawned process.
  // It reads WORKFLOW_RUN_ID + TENANT_* env vars, discovers workflows
  // from the user's project, and executes the matching one.
  const entrypointPath = options.entrypoint ?? "./workflow-job.ts";

  if (options.executor === "k8s") {
    cliLogger.error(
      "K8s executor requires custom configuration. Use --executor process for local dev, " +
        "or configure K8sJobExecutor programmatically for production.",
    );
    exitProcess(1);
    return;
  }

  const executor = new ProcessJobExecutor({
    entrypointPath,
    env: {
      REDIS_URL: options.redisUrl,
    },
    debug: options.debug,
  });

  // Create and start job manager
  const manager = new WorkflowJobManager({
    backend,
    executor,
    pollInterval: options.pollInterval,
    maxConcurrentJobs: options.concurrency,
    stalledThreshold: options.stalledThreshold,
    debug: options.debug,
  });

  await manager.start();

  cliLogger.info(
    `Workflow worker started (manager: ${manager.getManagerId()})`,
  );
  cliLogger.info("Polling for workflow jobs...\n");

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    cliLogger.info(`\nReceived ${signal}, shutting down worker...`);

    try {
      await manager.stop();
      await backend.destroy();

      const stats = manager.getStats();
      cliLogger.info("Worker stopped.");
      cliLogger.info(
        `  Jobs: ${stats.jobsCreated} created, ${stats.jobsCompleted} completed, ${stats.jobsFailed} failed`,
      );
    } catch (error) {
      cliLogger.warn("Error during shutdown:", error);
    } finally {
      exitProcess(0);
    }
  };

  registerTerminationSignals((signal) => {
    void shutdown(signal);
  });

  // Keep alive
  await new Promise(() => {});
}
