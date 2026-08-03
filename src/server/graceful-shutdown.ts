import { shutdownOTLP } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import { requestTracker } from "./runtime-handler/request-tracker.ts";
import { markServerShuttingDown } from "./shutdown-state.ts";

/** Default drain timeout leaves headroom under Kubernetes' default 30 second grace period. */
export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
/** Cleanup timeout keeps total shutdown below the default 30 second grace period. */
export const DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS = 4_000;

interface GracefulShutdownRequestTracker {
  getInFlightCount(): number;
  waitForDrain(timeoutMs: number): Promise<boolean>;
  shutdown(): void;
}

/**
 * Inputs required to drain and stop a production server process.
 *
 * This lifecycle mutates process-wide readiness, shutdown, and request-tracking
 * state. Use it once from the process signal handler, not for individual server
 * instances or requests.
 */
export interface GracefulProductionShutdownOptions {
  /** Operating-system signal that initiated shutdown. */
  signal: "SIGINT" | "SIGTERM";
  /** Maximum drain time. Defaults to SHUTDOWN_DRAIN_TIMEOUT_MS or 25 seconds. */
  drainTimeoutMs?: number;
  /** Total time allowed for cleanup after draining. Defaults to 4 seconds. */
  cleanupTimeoutMs?: number;
  /** Stops signal-aware background work before the HTTP server closes. */
  abort: () => void;
  /** Stops the production HTTP server. */
  stop: () => Promise<void>;
  /** Releases optional bootstrap resources before the server closes. */
  dispose?: () => void | Promise<void>;
  /** Logger used for shutdown progress and failures. */
  logger: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: unknown): void;
  };
}

type GracefulShutdownLogger = GracefulProductionShutdownOptions["logger"];

interface GracefulProductionShutdownDependencies {
  markServerShuttingDown: () => void;
  setServerInitialized: (ready: boolean) => void;
  requestTracker: GracefulShutdownRequestTracker;
  shutdownTelemetry: () => Promise<void>;
}

const defaultDependencies: GracefulProductionShutdownDependencies = {
  markServerShuttingDown,
  setServerInitialized,
  requestTracker,
  shutdownTelemetry: shutdownOTLP,
};

export function parseShutdownDrainTimeoutMs(raw: string | undefined): number {
  return parseShutdownTimeoutMs(raw, DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS);
}

export function parseShutdownCleanupTimeoutMs(raw: string | undefined): number {
  return parseShutdownTimeoutMs(raw, DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS);
}

function parseShutdownTimeoutMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeShutdownTimeoutMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function runCleanupStep(
  description: string,
  action: () => void | Promise<void>,
  logger: GracefulShutdownLogger,
  cleanupDeadlineMs: number,
): Promise<void> {
  let result: void | Promise<void>;
  try {
    result = action();
  } catch (error) {
    logger.warn(`Failed to ${description} during graceful shutdown`, { error });
    return;
  }

  if (!result || typeof (result as PromiseLike<void>).then !== "function") return;

  const actionPromise = Promise.resolve(result);
  const remainingMs = Math.max(0, cleanupDeadlineMs - Date.now());
  if (remainingMs === 0) {
    logger.warn("Graceful shutdown cleanup deadline exceeded", { step: description });
    void actionPromise.catch((error) => {
      logger.warn(`Failed to ${description} after cleanup deadline exceeded`, { error });
    });
    return;
  }

  type CleanupOutcome =
    | { status: "completed" }
    | { status: "failed"; error: unknown }
    | { status: "timeout" };

  let timeoutId: number | undefined;
  const outcome = await Promise.race<CleanupOutcome>([
    actionPromise.then(
      () => ({ status: "completed" }),
      (error) => ({ status: "failed", error }),
    ),
    new Promise<CleanupOutcome>((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: "timeout" }), remainingMs);
    }),
  ]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (outcome.status === "failed") {
    logger.warn(`Failed to ${description} during graceful shutdown`, { error: outcome.error });
  } else if (outcome.status === "timeout") {
    logger.warn("Graceful shutdown cleanup deadline exceeded", { step: description });
  }
}

/**
 * Stops new agent work, drains tracked requests and SSE response bodies, and then
 * releases server resources.
 */
export async function gracefullyShutdownProductionServerWithDependencies(
  options: GracefulProductionShutdownOptions,
  dependencies: GracefulProductionShutdownDependencies,
): Promise<boolean> {
  const { logger } = options;
  const drainTimeoutMs = normalizeShutdownTimeoutMs(
    options.drainTimeoutMs,
    parseShutdownDrainTimeoutMs(getEnv("SHUTDOWN_DRAIN_TIMEOUT_MS")),
  );
  const cleanupTimeoutMs = normalizeShutdownTimeoutMs(
    options.cleanupTimeoutMs,
    parseShutdownCleanupTimeoutMs(getEnv("SHUTDOWN_CLEANUP_TIMEOUT_MS")),
  );

  logger.info(`Received ${options.signal}, initiating graceful shutdown...`, {
    inFlightRequests: dependencies.requestTracker.getInFlightCount(),
    drainTimeoutMs,
    cleanupTimeoutMs,
  });

  dependencies.markServerShuttingDown();
  dependencies.setServerInitialized(false);
  logger.info("Server marked as not ready, waiting for in-flight requests to drain...");

  let drained = false;
  try {
    drained = await dependencies.requestTracker.waitForDrain(drainTimeoutMs);
  } catch (error) {
    logger.warn("Failed while waiting for in-flight requests to drain", { error });
  }

  if (!drained) {
    logger.warn("Drain timeout exceeded, forcing shutdown", {
      remainingRequests: dependencies.requestTracker.getInFlightCount(),
    });
  }

  const cleanupDeadlineMs = Date.now() + cleanupTimeoutMs;
  await runCleanupStep(
    "stop request tracking",
    () => dependencies.requestTracker.shutdown(),
    logger,
    cleanupDeadlineMs,
  );
  if (options.dispose) {
    await runCleanupStep(
      "dispose the production bootstrap",
      options.dispose,
      logger,
      cleanupDeadlineMs,
    );
  }
  await runCleanupStep(
    "abort the production server",
    options.abort,
    logger,
    cleanupDeadlineMs,
  );
  await runCleanupStep(
    "stop the production server",
    options.stop,
    logger,
    cleanupDeadlineMs,
  );
  await runCleanupStep(
    "shut down telemetry",
    dependencies.shutdownTelemetry,
    logger,
    cleanupDeadlineMs,
  );

  logger.info("Graceful shutdown complete");
  return drained;
}

/**
 * Enter lame-duck mode, mark readiness false, drain tracked requests and SSE
 * response bodies, and stop a production server process.
 *
 * This is a one-shot, process-level lifecycle. Call it once from a SIGINT or
 * SIGTERM handler. The function returns `true` when every tracked request drains
 * before the timeout and `false` when cleanup continues after the timeout.
 */
export function gracefullyShutdownProductionServer(
  options: GracefulProductionShutdownOptions,
): Promise<boolean> {
  return gracefullyShutdownProductionServerWithDependencies(options, defaultDependencies);
}
