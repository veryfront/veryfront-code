/**
 * Configuration loading, validation, and runtime access. Provides project
 * config resolution, environment initialization, and network/port defaults.
 *
 * @module config
 */

export {
  clearConfigCache,
  getCachedConfigSync,
  getConfig,
  type GetConfigOptions,
} from "./loader.ts";
export {
  type ConfigFileExists,
  findVeryfrontConfigFile,
  VERYFRONT_CONFIG_FILES,
  type VeryfrontConfigFile,
  type VeryfrontConfigFileName,
} from "./config-files.ts";
export {
  findHostedConfigIncompatibility,
  formatHostedConfigIncompatibility,
  type HostedConfigIncompatibility,
} from "./hosted-compatibility.ts";
export { defineConfig, defineConfigWithEnv, mergeConfigs } from "./define-config.ts";
export { getApiTokenEnv, isCiEnv, isDenoTestingEnv, isRscExperimentalEnabled } from "./env.ts";

export {
  type EnvironmentConfig,
  getEnvironmentConfig,
  initEnvironmentConfig,
  isEnvironmentConfigInitialized,
} from "./environment-config.ts";

export {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  getRuntimeConfig,
  initRuntimeConfig,
  isRuntimeConfigInitialized,
  type RuntimeConfig,
  type RuntimeInfo,
  updateRuntimeConfig,
} from "./runtime-config.ts";

export {
  findUnknownTopLevelKeys,
  validateVeryfrontConfig,
  type VeryfrontConfig,
  type VeryfrontConfigInput,
  veryfrontConfigSchema,
} from "./schemas/index.ts";

export {
  DEFAULT_CACHE_MAX_SIZE,
  DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  DEFAULT_PORT,
  DEFAULT_PREFETCH_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  type DefaultConfig,
  defaultConfig,
  DURATION_HISTOGRAM_BOUNDARIES_MS,
  PAGE_TRANSITION_DELAY_MS,
  SANDBOX_TIMEOUT_MS,
  SIZE_HISTOGRAM_BOUNDARIES_KB,
  SSR_MAX_BUFFERED_BYTES,
  SSR_TIMEOUT_MS,
} from "./defaults.ts";

export {
  buildIpv4Url,
  buildLocalhostUrl,
  DEV_LOCALHOST_CSP,
  DEV_LOCALHOST_ORIGINS,
  HTTP_DEFAULTS,
  LOCALHOST,
  LOCALHOST_URLS,
} from "./network-defaults.ts";
