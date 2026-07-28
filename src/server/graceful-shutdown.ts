import { shutdownOTLP } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import { requestTracker } from "./runtime-handler/request-tracker.ts";
import { markServerShuttingDown } from "./shutdown-state.ts";

/** Default drain timeout leaves headroom under Kubernetes' default 30 second grace period. */
export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
/** Cleanup timeout keeps total shutdown below the default 30 second grace period. */
export const DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS = 4_000;
/** Largest delay accepted by JavaScript timers without overflow/clamping. */
export const MAX_SHUTDOWN_TIMEOUT_MS = 2_147_483_647;

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
  /**
   * Releases optional bootstrap resources after the HTTP server closes. It is
   * skipped if stopping the listener fails or exceeds the cleanup deadline.
   */
  dispose?: () => void | Promise<void>;
  /** Logger used for shutdown progress and failures. */
  logger: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: unknown): void;
  };
}

type GracefulShutdownLogger = GracefulProductionShutdownOptions["logger"];

class GracefulShutdownTimeoutError extends Error {
  override name = "GracefulShutdownTimeoutError";

  constructor(description: string) {
    super(`Timed out while trying to ${description}`);
  }
}

type CleanupStepOutcome =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "timeout"; readonly error: GracefulShutdownTimeoutError };

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
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SHUTDOWN_TIMEOUT_MS
    ? parsed
    : fallback;
}

function normalizeShutdownTimeoutMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= 0 && value <= MAX_SHUTDOWN_TIMEOUT_MS
    ? value
    : fallback;
}

async function runCleanupStep(
  description: string,
  action: () => void | Promise<void>,
  logger: GracefulShutdownLogger,
  cleanupDeadlineMs: number,
): Promise<CleanupStepOutcome> {
  let result: void | Promise<void>;
  try {
    result = action();
  } catch (error) {
    logger.warn(`Failed to ${description} during graceful shutdown`, { error });
    return { status: "failed", error };
  }

  if (!result || typeof (result as PromiseLike<void>).then !== "function") {
    return { status: "completed" };
  }

  const actionPromise = Promise.resolve(result);
  const remainingMs = Math.max(0, cleanupDeadlineMs - Date.now());
  if (remainingMs === 0) {
    logger.warn("Graceful shutdown cleanup deadline exceeded", { step: description });
    void actionPromise.catch((error) => {
      logger.warn(`Failed to ${description} after cleanup deadline exceeded`, { error });
    });
    return {
      status: "timeout",
      error: new GracefulShutdownTimeoutError(description),
    };
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
    return outcome;
  } else if (outcome.status === "timeout") {
    logger.warn("Graceful shutdown cleanup deadline exceeded", { step: description });
    return {
      status: "timeout",
      error: new GracefulShutdownTimeoutError(description),
    };
  }
  return outcome;
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
  const cleanupFailures: unknown[] = [];
  const collectCleanupFailure = (outcome: CleanupStepOutcome): CleanupStepOutcome => {
    if (outcome.status !== "completed") cleanupFailures.push(outcome.error);
    return outcome;
  };

  collectCleanupFailure(
    await runCleanupStep(
      "stop request tracking",
      () => dependencies.requestTracker.shutdown(),
      logger,
      cleanupDeadlineMs,
    ),
  );
  collectCleanupFailure(
    await runCleanupStep(
      "abort the production server",
      options.abort,
      logger,
      cleanupDeadlineMs,
    ),
  );
  const stopResult = collectCleanupFailure(
    await runCleanupStep(
      "stop the production server",
      options.stop,
      logger,
      cleanupDeadlineMs,
    ),
  );
  if (options.dispose) {
    if (stopResult.status === "completed") {
      collectCleanupFailure(
        await runCleanupStep(
          "dispose the production bootstrap",
          options.dispose,
          logger,
          cleanupDeadlineMs,
        ),
      );
    } else {
      logger.warn(
        "Skipping production bootstrap disposal because the HTTP server may still be live",
        {
          stopResult: stopResult.status,
        },
      );
    }
  }
  collectCleanupFailure(
    await runCleanupStep(
      "shut down telemetry",
      dependencies.shutdownTelemetry,
      logger,
      cleanupDeadlineMs,
    ),
  );

  if (cleanupFailures.length > 0) {
    logger.warn("Graceful shutdown incomplete", {
      failureCount: cleanupFailures.length,
    });
    throw new AggregateError(
      cleanupFailures,
      `Graceful shutdown failed in ${cleanupFailures.length} cleanup phase${
        cleanupFailures.length === 1 ? "" : "s"
      }`,
    );
  }

  logger.info("Graceful shutdown complete");
  return drained;
}

/**
 * Enter lame-duck mode, mark readiness false, drain tracked requests and SSE
 * response bodies, and stop a production server process.
 *
 * Process owners should share concurrent calls. The function returns `true`
 * when every tracked request drains before the timeout and `false` when cleanup
 * continues after the drain timeout. Required cleanup failures and timeouts are
 * reported afterward in one ordered `AggregateError`, allowing the owner to
 * retry unfinished cleanup or terminate with a failed process status.
 */
export function gracefullyShutdownProductionServer(
  options: GracefulProductionShutdownOptions,
): Promise<boolean> {
  return gracefullyShutdownProductionServerWithDependencies(options, defaultDependencies);
}
