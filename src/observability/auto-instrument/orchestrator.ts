import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { initTracing } from "../tracing/index.ts";
import { initMetrics } from "../metrics/index.ts";
import type { AutoInstrumentConfig } from "./types.ts";
import { mergeConfig } from "./configurator.ts";

const log = logger.component("auto-instrument");

let initialized = false;

export async function initAutoInstrumentation(
  config: AutoInstrumentConfig = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  if (initialized) {
    log.debug("Already initialized");
    return;
  }

  const finalConfig = mergeConfig(config);

  try {
    if (finalConfig.tracing?.enabled) {
      await initTracing(finalConfig.tracing, adapter);
    }

    if (finalConfig.metrics?.enabled) {
      await initMetrics(finalConfig.metrics, adapter);
    }

    logInitialization(finalConfig);
  } catch (error) {
    log.warn("Failed to initialize auto-instrumentation", error);
  } finally {
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

function logInitialization(config: AutoInstrumentConfig): void {
  log.info("Auto-instrumentation initialized", {
    tracing: config.tracing?.enabled ?? false,
    metrics: config.metrics?.enabled ?? false,
    http: config.instrumentHttp,
    fetch: config.instrumentFetch,
    react: config.instrumentReact,
  });
}
