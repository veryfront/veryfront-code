/**
 * Project-scoped environment helpers for cross-runtime applications.
 *
 * Host environment access and the trusted project-snapshot bridge remain
 * internal framework controls and are not exported from this module.
 *
 * @module platform/env
 */

export {
  env,
  type EnvBooleanOptions,
  getEnv,
  getEnvBoolean,
  getEnvNumber,
  getEnvString,
} from "./env.ts";
