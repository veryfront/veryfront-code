/**
 * Runtime Configuration
 *
 * Combines file-based config (veryfront.config.ts) with runtime environment.
 * This is the primary config type that should be used throughout the application.
 *
 * @module
 */

import type { VeryfrontConfig } from "./types.ts";
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
  defaultLayout: undefined,
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

/**
 * Create RuntimeInfo from RuntimeEnv.
 */
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

/**
 * Merge file config with environment overrides.
 * Environment variables take precedence for certain values.
 */
function mergeConfigWithEnv(fileConfig: VeryfrontConfig, env: RuntimeEnv): VeryfrontConfig {
  return {
    ...fileConfig,

    // Project slug from env takes precedence
    projectSlug: env.projectSlug || fileConfig.projectSlug,

    // Experimental features - env can enable but not disable
    experimental: {
      ...fileConfig.experimental,
      rsc: fileConfig.experimental?.rsc ?? env.experimentalRsc,
    },

    // Cache config - env overrides
    cache: {
      ...fileConfig.cache,
      dir: env.cacheDir || fileConfig.cache?.dir,
      render: {
        ...fileConfig.cache?.render,
        redisUrl: env.redisUrl || fileConfig.cache?.render?.redisUrl,
      },
    },

    // Dev config - port from env
    dev: {
      ...fileConfig.dev,
      port: env.port || fileConfig.dev?.port,
    },

    // Observability - merge with env
    observability: {
      tracing: {
        enabled: env.otelEnabled || fileConfig.observability?.tracing?.enabled,
        endpoint: env.otelEndpoint || fileConfig.observability?.tracing?.endpoint,
        serviceName: env.otelServiceName || fileConfig.observability?.tracing?.serviceName,
        ...fileConfig.observability?.tracing,
      },
      metrics: {
        enabled: env.otelMetricsEnabled || fileConfig.observability?.metrics?.enabled,
        endpoint: env.otelMetricsEndpoint || fileConfig.observability?.metrics?.endpoint,
        ...fileConfig.observability?.metrics,
      },
    },
  };
}

/**
 * Create a RuntimeConfig from file config and environment.
 *
 * @param fileConfig - Configuration from veryfront.config.ts (or defaults)
 * @param env - Runtime environment (defaults to current environment)
 * @returns Complete RuntimeConfig with runtime info
 *
 * @example
 * ```typescript
 * // In application code
 * const config = createRuntimeConfig(loadedConfig);
 *
 * if (config.runtime.isProduction) {
 *   // Production-specific behavior
 * }
 * ```
 */
export function createRuntimeConfig(
  fileConfig: VeryfrontConfig = {},
  env: RuntimeEnv = getRuntimeEnv(),
): RuntimeConfig {
  const mergedConfig = mergeConfigWithEnv(
    { ...DEFAULT_CONFIG, ...fileConfig },
    env,
  );

  return {
    ...mergedConfig,
    runtime: createRuntimeInfo(env),
  };
}

// ============================================================================
// Global Config Singleton
// ============================================================================

let _runtimeConfig: RuntimeConfig | null = null;

/**
 * Initialize the global RuntimeConfig.
 * Should be called once at application startup after loading file config.
 *
 * @param fileConfig - Configuration from veryfront.config.ts
 * @returns Initialized RuntimeConfig
 */
export function initRuntimeConfig(fileConfig: VeryfrontConfig = {}): RuntimeConfig {
  if (_runtimeConfig) return _runtimeConfig;

  _runtimeConfig = createRuntimeConfig(fileConfig);
  return _runtimeConfig;
}

/**
 * Get the global RuntimeConfig.
 * Auto-initializes with defaults if not already initialized.
 *
 * @returns RuntimeConfig
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!_runtimeConfig) {
    return initRuntimeConfig();
  }
  return _runtimeConfig;
}

/**
 * Check if RuntimeConfig has been initialized.
 */
export function isRuntimeConfigInitialized(): boolean {
  return _runtimeConfig !== null;
}

/**
 * Update the global RuntimeConfig with new file config.
 * Useful when config file changes (e.g., HMR).
 *
 * @param fileConfig - New file configuration
 * @returns Updated RuntimeConfig
 */
export function updateRuntimeConfig(fileConfig: VeryfrontConfig): RuntimeConfig {
  _runtimeConfig = createRuntimeConfig(fileConfig);
  return _runtimeConfig;
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a RuntimeConfig for testing without affecting globals.
 *
 * @param overrides - Partial config to merge with defaults
 * @returns New RuntimeConfig for test use
 *
 * @example
 * ```typescript
 * const config = createTestConfig({
 *   experimental: { rsc: true },
 *   runtime: { env: { debug: true } }
 * });
 * ```
 */
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

/**
 * Override the global RuntimeConfig for testing.
 *
 * @param config - Full RuntimeConfig or partial overrides
 * @internal Test use only
 */
export function _setRuntimeConfigForTesting(
  config: Partial<RuntimeConfig> | RuntimeConfig,
): void {
  if ("runtime" in config && config.runtime) {
    _runtimeConfig = config as RuntimeConfig;
  } else {
    _runtimeConfig = createTestConfig(config);
  }
}

/**
 * Reset RuntimeConfig to uninitialized state.
 *
 * @internal Test use only
 */
export function _resetRuntimeConfig(): void {
  _runtimeConfig = null;
}
