/****
 * Runtime Configuration
 *
 * Combines file-based config (veryfront.config.ts) with runtime environment.
 * This is the primary config type that should be used throughout the application.
 *
 * @module
 */

import type { VeryfrontConfig } from "./schemas/index.ts";
import type { EnvironmentConfig } from "./environment-config.ts";
import { createTestEnvironmentConfig, getEnvironmentConfig } from "./environment-config.ts";
import { registerRuntimeConfigProvider } from "#veryfront/platform/cloud/context-bridge.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import {
  DEFAULT_DEV_HOST,
  DEFAULT_PORT,
  DEFAULT_PROJECT_DESCRIPTION,
  DEFAULT_PROJECT_TITLE,
  DEFAULT_RENDER_CACHE_MAX_ENTRIES,
} from "./defaults.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { createImmutableConfigSnapshot } from "./immutable-config.ts";

/**
 * Runtime-specific configuration derived from environment.
 */
export interface RuntimeInfo {
  /** The runtime environment snapshot */
  env: EnvironmentConfig;

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
export const DEFAULT_CONFIG: Partial<VeryfrontConfig> = Object.freeze({
  title: DEFAULT_PROJECT_TITLE,
  description: DEFAULT_PROJECT_DESCRIPTION,
  experimental: Object.freeze({
    esmLayouts: true,
  }),
  router: undefined,
  theme: Object.freeze({
    colors: Object.freeze({
      primary: "#3B82F6",
    }),
  }),
  build: Object.freeze({
    outDir: "dist",
    trailingSlash: false,
  }),
  cache: Object.freeze({
    dir: DEFAULT_CACHE_DIR,
    render: Object.freeze({
      type: "memory",
      maxEntries: DEFAULT_RENDER_CACHE_MAX_ENTRIES,
    }),
  }),
  dev: Object.freeze({
    port: DEFAULT_PORT,
    host: DEFAULT_DEV_HOST,
    open: false,
  }),
});

function createRuntimeInfo(env: EnvironmentConfig): RuntimeInfo {
  return Object.freeze({
    env,
    isProduction: env.nodeEnv === "production",
    isDevelopment: env.nodeEnv === "development",
    isTest: env.nodeEnv === "test" || env.denoTesting,
    isCI: env.ci,
    isDebug: env.debug,
  });
}

function snapshotEnvironmentConfig(env: EnvironmentConfig): EnvironmentConfig {
  return Object.isFrozen(env) ? env : Object.freeze({ ...env });
}

function mergeObservabilityConfig(
  fileConfig: VeryfrontConfig,
  env: EnvironmentConfig,
): VeryfrontConfig["observability"] {
  const tracingServiceName = fileConfig.observability?.tracing?.serviceName ||
    env.otelServiceName;

  if (env.proxyMode) {
    return {
      tracing: {
        enabled: env.otelEnabled,
        endpoint: env.otelTracesEndpoint || env.otelEndpoint,
        serviceName: env.otelServiceName,
      },
      metrics: {
        enabled: env.otelMetricsEnabled,
        endpoint: env.otelMetricsEndpoint || env.otelEndpoint,
      },
    };
  }

  return {
    ...fileConfig.observability,
    tracing: {
      ...fileConfig.observability?.tracing,
      enabled: env.otelEnabled || fileConfig.observability?.tracing?.enabled,
      endpoint: env.otelTracesEndpoint || env.otelEndpoint ||
        fileConfig.observability?.tracing?.endpoint,
      serviceName: tracingServiceName,
    },
    metrics: {
      ...fileConfig.observability?.metrics,
      enabled: env.otelMetricsEnabled || fileConfig.observability?.metrics?.enabled,
      endpoint: env.otelMetricsEndpoint || env.otelEndpoint ||
        fileConfig.observability?.metrics?.endpoint,
    },
  };
}

function mergeConfigWithEnv(fileConfig: VeryfrontConfig, env: EnvironmentConfig): VeryfrontConfig {
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
      port: env.portFromEnv === false ? fileConfig.dev?.port ?? env.port : env.port,
    },

    observability: mergeObservabilityConfig(fileConfig, env),
  };
}

function mergeFileConfig(fileConfig: VeryfrontConfig): VeryfrontConfig {
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    experimental: {
      ...DEFAULT_CONFIG.experimental,
      ...fileConfig.experimental,
    },
    theme: {
      ...DEFAULT_CONFIG.theme,
      ...fileConfig.theme,
      colors: {
        ...DEFAULT_CONFIG.theme?.colors,
        ...fileConfig.theme?.colors,
      },
    },
    build: {
      ...DEFAULT_CONFIG.build,
      ...fileConfig.build,
      esbuild: fileConfig.build?.esbuild
        ? {
          ...DEFAULT_CONFIG.build?.esbuild,
          ...fileConfig.build.esbuild,
        }
        : DEFAULT_CONFIG.build?.esbuild,
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...fileConfig.cache,
      bundleManifest: fileConfig.cache?.bundleManifest
        ? {
          ...DEFAULT_CONFIG.cache?.bundleManifest,
          ...fileConfig.cache.bundleManifest,
        }
        : DEFAULT_CONFIG.cache?.bundleManifest,
      render: {
        ...DEFAULT_CONFIG.cache?.render,
        ...fileConfig.cache?.render,
      },
      queryParams: fileConfig.cache?.queryParams
        ? {
          ...DEFAULT_CONFIG.cache?.queryParams,
          ...fileConfig.cache.queryParams,
        }
        : DEFAULT_CONFIG.cache?.queryParams,
    },
    dev: {
      ...DEFAULT_CONFIG.dev,
      ...fileConfig.dev,
    },
  };
}

/** Merge validated project configuration with a host environment snapshot. */
export function createRuntimeConfig(
  fileConfig: VeryfrontConfig = {},
  env: EnvironmentConfig = getEnvironmentConfig(),
): RuntimeConfig {
  const envSnapshot = snapshotEnvironmentConfig(env);
  const mergedConfig = mergeConfigWithEnv(mergeFileConfig(fileConfig), envSnapshot);
  const configSnapshot = createImmutableConfigSnapshot(mergedConfig);

  return Object.freeze({
    ...configSnapshot,
    runtime: createRuntimeInfo(envSnapshot),
  });
}

// ============================================================================
// Global Config Singleton
// ============================================================================

let runtimeConfig: RuntimeConfig | null = null;

const runtimeConfigBridgeProvider = Object.freeze({
  getConfig: () => getRuntimeConfig(),
  isInitialized: () => runtimeConfig !== null,
});

function ensureRuntimeConfigProvider(): void {
  registerRuntimeConfigProvider(runtimeConfigBridgeProvider);
}

ensureRuntimeConfigProvider();

/** Initialize the process-wide runtime configuration once. */
export function initRuntimeConfig(fileConfig: VeryfrontConfig = {}): RuntimeConfig {
  ensureRuntimeConfigProvider();
  if (runtimeConfig) return runtimeConfig;

  runtimeConfig = createRuntimeConfig(fileConfig);
  return runtimeConfig;
}

/** Return the initialized runtime configuration, creating defaults when needed. */
export function getRuntimeConfig(): RuntimeConfig {
  ensureRuntimeConfigProvider();
  return runtimeConfig ?? initRuntimeConfig();
}

/** Return whether the process-wide runtime configuration is initialized. */
export function isRuntimeConfigInitialized(): boolean {
  ensureRuntimeConfigProvider();
  return runtimeConfig !== null;
}

/** Replace the process-wide runtime configuration with a newly merged snapshot. */
export function updateRuntimeConfig(fileConfig: VeryfrontConfig): RuntimeConfig {
  ensureRuntimeConfigProvider();
  runtimeConfig = createRuntimeConfig(fileConfig);
  return runtimeConfig;
}

// ============================================================================
// Test Utilities
// ============================================================================

export function createTestConfig(
  overrides: Partial<VeryfrontConfig> & {
    runtime?: { env?: Partial<EnvironmentConfig> };
  } = {},
): RuntimeConfig {
  const { runtime: runtimeOverrides, ...configOverrides } = overrides;

  const testEnv = createTestEnvironmentConfig(runtimeOverrides?.env);
  const fileConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  return createRuntimeConfig(fileConfig, testEnv);
}

export function _setRuntimeConfigForTesting(
  config: Partial<RuntimeConfig> | RuntimeConfig,
): void {
  ensureRuntimeConfigProvider();
  if ("runtime" in config && config.runtime) {
    runtimeConfig = config as RuntimeConfig;
    return;
  }

  runtimeConfig = createTestConfig(config);
}

export function _resetRuntimeConfig(): void {
  ensureRuntimeConfigProvider();
  runtimeConfig = null;
}

registerProcessStateReset("runtime config", _resetRuntimeConfig);
