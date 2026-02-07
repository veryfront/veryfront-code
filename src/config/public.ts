/**
 * Public configuration API for veryfront/config
 *
 * User-facing exports only. Internal infrastructure (RuntimeConfig, network defaults,
 * histogram boundaries, etc.) is available via #veryfront/config for framework internals.
 */

export { clearConfigCache, getConfig, type GetConfigOptions } from "./loader.ts";

export { defineConfig } from "./define-config.ts";

export { getApiTokenEnv, isCiEnv, isDenoTestingEnv } from "./env.ts";

export {
  findUnknownTopLevelKeys,
  validateVeryfrontConfig,
  type VeryfrontConfig,
  type VeryfrontConfigInput,
  veryfrontConfigSchema,
} from "./schemas/index.ts";

export { DEFAULT_PORT } from "./defaults.ts";
