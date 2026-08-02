import { serverLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { initTracing } from "../tracing/index.ts";
import { initMetrics } from "../metrics/index.ts";
import type { AutoInstrumentConfig } from "./types.ts";
import { mergeConfig } from "./configurator.ts";

const logger = serverLogger.component("auto-instrument");

let initialized = false;
let initializationPromise: Promise<void> | null = null;
let lifecycleGeneration = 0;

/** Initialize automatic instrumentation wrappers. */
export function initAutoInstrumentation(
  config: AutoInstrumentConfig = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  if (initializationPromise) return initializationPromise;
  if (initialized) {
    logger.debug("Already initialized");
    return Promise.resolve();
  }

  const finalConfig = mergeConfig(config);
  const generation = lifecycleGeneration;

  const attempt = (async (): Promise<void> => {
    try {
      if (finalConfig.tracing?.enabled) {
        await initTracing(finalConfig.tracing, adapter);
      }

      if (finalConfig.metrics?.enabled) {
        await initMetrics(finalConfig.metrics, adapter);
      }

      if (generation === lifecycleGeneration) logInitialization(finalConfig);
    } catch (error) {
      if (generation === lifecycleGeneration) {
        logger.warn("Failed to initialize auto-instrumentation", error);
      }
    } finally {
      if (generation === lifecycleGeneration) initialized = true;
    }
  })();

  const tracked = attempt.finally(() => {
    if (initializationPromise === tracked) initializationPromise = null;
  });
  initializationPromise = tracked;
  return tracked;
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
  lifecycleGeneration++;
  initialized = false;
  initializationPromise = null;
}

function logInitialization(config: AutoInstrumentConfig): void {
  logger.info("Auto-instrumentation initialized", {
    tracing: config.tracing?.enabled ?? false,
    metrics: config.metrics?.enabled ?? false,
    http: config.instrumentHttp,
    fetch: config.instrumentFetch,
    react: config.instrumentReact,
  });
}
