import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { initTracing } from "../tracing/index.ts";
import { initMetrics } from "../metrics/index.ts";
import type { AutoInstrumentConfig } from "./types.ts";
import { mergeConfig } from "./configurator.ts";

let initialized = false;

export async function initAutoInstrumentation(
  config: AutoInstrumentConfig = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  if (initialized) {
    logger.debug("[auto-instrument] Already initialized");
    return;
  }

  const finalConfig = mergeConfig(config);

  try {
    await initializeTracing(finalConfig, adapter);
    await initializeMetrics(finalConfig, adapter);

    initialized = true;
    logInitialization(finalConfig);
  } catch (error) {
    logger.warn("[auto-instrument] Failed to initialize auto-instrumentation", error);
    initialized = true;
  }
}

export function isAutoInstrumentEnabled(): boolean {
  return initialized;
}

/**
 * Reset initialization state (for testing only)
 * @internal
 */
export function __resetAutoInstrumentForTests(): void {
  initialized = false;
}

async function initializeTracing(
  config: AutoInstrumentConfig,
  adapter?: RuntimeAdapter,
): Promise<void> {
  if (config.tracing?.enabled) {
    await initTracing(config.tracing, adapter);
  }
}

async function initializeMetrics(
  config: AutoInstrumentConfig,
  adapter?: RuntimeAdapter,
): Promise<void> {
  if (config.metrics?.enabled) {
    await initMetrics(config.metrics, adapter);
  }
}

function logInitialization(config: AutoInstrumentConfig): void {
  logger.info("[auto-instrument] Auto-instrumentation initialized", {
    tracing: config.tracing?.enabled || false,
    metrics: config.metrics?.enabled || false,
    http: config.instrumentHttp,
    fetch: config.instrumentFetch,
    react: config.instrumentReact,
  });
}
