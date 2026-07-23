import { serverLogger } from "#veryfront/utils";
import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { initTracing } from "../tracing/index.ts";
import { initMetrics } from "../metrics/index.ts";
import type { AutoInstrumentConfig } from "./types.ts";
import { mergeConfig } from "./configurator.ts";
import { classifyTelemetryError } from "../telemetry-safety.ts";

const logger = serverLogger.component("auto-instrument");

let initialized = false;
let initializationPromise: Promise<void> | null = null;

function safeLog(
  level: "debug" | "info" | "warn",
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    logger[level](message, context);
  } catch {
    // Telemetry logging must not affect application execution.
  }
}

/** Initialize automatic instrumentation wrappers. */
export async function initAutoInstrumentation(
  config: AutoInstrumentConfig = {},
  adapter?: ObservabilityRuntimeAdapter,
): Promise<void> {
  if (initialized) {
    safeLog("debug", "Already initialized");
    return;
  }
  if (initializationPromise) return initializationPromise;

  const finalConfig = mergeConfig(config);
  initializationPromise = initializeOnce(finalConfig, adapter);
  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

async function initializeOnce(
  config: AutoInstrumentConfig,
  adapter?: ObservabilityRuntimeAdapter,
): Promise<void> {
  try {
    if (config.tracing?.enabled) {
      await initTracing(config.tracing, adapter);
    }

    if (config.metrics?.enabled) {
      await initMetrics(config.metrics, adapter);
    }

    initialized = true;
    logInitialization(config);
  } catch (error) {
    safeLog("warn", "Failed to initialize auto-instrumentation", {
      failure_category: classifyTelemetryError(error),
    });
  }
}

/** Check whether auto instrumentation is enabled. */
export function isAutoInstrumentEnabled(): boolean {
  return initialized;
}

/**
 * Reset initialization state (for testing only)
 * @internal
 */
export function __resetAutoInstrumentForTests(): void {
  initialized = false;
  initializationPromise = null;
}

function logInitialization(config: AutoInstrumentConfig): void {
  safeLog("info", "Auto-instrumentation initialized", {
    tracing: config.tracing?.enabled ?? false,
    metrics: config.metrics?.enabled ?? false,
    http: config.instrumentHttp,
    fetch: config.instrumentFetch,
    react: config.instrumentReact,
  });
}
