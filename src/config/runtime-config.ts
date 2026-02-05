/****
 * Runtime Configuration
 *
 * Combines file-based config (veryfront.config.ts) with runtime environment.
 * This is the primary config type that should be used throughout the application.
 *
 * @module
 */

import type { VeryfrontConfig } from "./schemas/index.ts";
import type { RuntimeEnv } from "./runtime-env.ts";
import { createTestRuntimeEnv, getRuntimeEnv } from "./runtime-env.ts";

/**
 * Runtime-specific configuration derived from environment.
 */
export interface RuntimeInfo {
  /** The runtime environment snapshot */
  env: RuntimeEnv;

  /** True if NODE_ENV is "production" */
  isProduction: boolean;

  /** True if NODE_ENV is "development" */
  isDevelopment: boolean;

  /** True if NODE_ENV is "test" or DENO_TESTING=1 */
  isTest: boolean;

  /** True if running in CI environment */
  isCI: boolean;

  /** True if debug mode is enabled */
  isDebug: boolean;
}

/**
 * Full runtime configuration.
 * Combines user config file with runtime environment.
 */
export interface RuntimeConfig extends VeryfrontConfig {
  /**
   * Runtime-specific values computed from environment.
   * Use this for environment-dependent behavior.
   */
  runtime: RuntimeInfo;
}

/**
 * Default configuration values.
 * Used when no config file is found.
 */
export const DEFAULT_CONFIG: Partial<VeryfrontConfig> = {
  title: "Veryfront App",
  description: "Built with Veryfront",
  experimental: {
    esmLayouts: true,
  },
  router: undefined,
  theme: {
    colors: {
      primary: "#3B82F6",
    },
  },
  build: {
    outDir: "dist",
    trailingSlash: false,
  },
  cache: {
    dir: ".veryfront",
    render: {
      type: "memory",
      maxEntries: 500,
    },
  },
  dev: {
    port: 3001,
    host: "localhost",
    open: false,
  },
};

function createRuntimeInfo(env: RuntimeEnv): RuntimeInfo {
  return {
    env,
    isProduction: env.nodeEnv === "production",
    isDevelopment: env.nodeEnv === "development",
    isTest: env.nodeEnv === "test" || env.denoTesting,
    isCI: env.ci,
    isDebug: env.debug,
  };
}

function mergeConfigWithEnv(fileConfig: VeryfrontConfig, env: RuntimeEnv): VeryfrontConfig {
  return {
    ...fileConfig,

    projectSlug: env.projectSlug || fileConfig.projectSlug,

    experimental: {
      ...fileConfig.experimental,
      rsc: fileConfig.experimental?.rsc ?? env.experimentalRsc,
    },

    cache: {
      ...fileConfig.cache,
      dir: env.cacheDir || fileConfig.cache?.dir,
      render: {
        ...fileConfig.cache?.render,
        redisUrl: env.redisUrl || fileConfig.cache?.render?.redisUrl,
      },
    },

    dev: {
      ...fileConfig.dev,
      port: env.port || fileConfig.dev?.port,
    },

    observability: {
      tracing: {
        ...fileConfig.observability?.tracing,
        enabled: env.otelEnabled || fileConfig.observability?.tracing?.enabled,
        endpoint: env.otelEndpoint || fileConfig.observability?.tracing?.endpoint,
        serviceName: env.otelServiceName || fileConfig.observability?.tracing?.serviceName,
      },
      metrics: {
        ...fileConfig.observability?.metrics,
        enabled: env.otelMetricsEnabled || fileConfig.observability?.metrics?.enabled,
        endpoint: env.otelMetricsEndpoint || fileConfig.observability?.metrics?.endpoint,
      },
    },
  };
}

export function createRuntimeConfig(
  fileConfig: VeryfrontConfig = {},
  env: RuntimeEnv = getRuntimeEnv(),
): RuntimeConfig {
  const mergedConfig = mergeConfigWithEnv({ ...DEFAULT_CONFIG, ...fileConfig }, env);

  return {
    ...mergedConfig,
    runtime: createRuntimeInfo(env),
  };
}

// ============================================================================
// Global Config Singleton
// ============================================================================

let runtimeConfig: RuntimeConfig | null = null;

export function initRuntimeConfig(fileConfig: VeryfrontConfig = {}): RuntimeConfig {
  if (runtimeConfig) return runtimeConfig;

  runtimeConfig = createRuntimeConfig(fileConfig);
  return runtimeConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig ?? initRuntimeConfig();
}

export function isRuntimeConfigInitialized(): boolean {
  return runtimeConfig !== null;
}

export function updateRuntimeConfig(fileConfig: VeryfrontConfig): RuntimeConfig {
  runtimeConfig = createRuntimeConfig(fileConfig);
  return runtimeConfig;
}

// ============================================================================
// Test Utilities
// ============================================================================

export function createTestConfig(
  overrides: Partial<VeryfrontConfig> & {
    runtime?: { env?: Partial<RuntimeEnv> };
  } = {},
): RuntimeConfig {
  const { runtime: runtimeOverrides, ...configOverrides } = overrides;

  const testEnv = createTestRuntimeEnv(runtimeOverrides?.env);
  const fileConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  return createRuntimeConfig(fileConfig, testEnv);
}

export function _setRuntimeConfigForTesting(
  config: Partial<RuntimeConfig> | RuntimeConfig,
): void {
  if ("runtime" in config && config.runtime) {
    runtimeConfig = config as RuntimeConfig;
    return;
  }

  runtimeConfig = createTestConfig(config);
}

export function _resetRuntimeConfig(): void {
  runtimeConfig = null;
}
